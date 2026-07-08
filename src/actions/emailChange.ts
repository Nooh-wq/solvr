"use server";

// M21.2 — password-gated email change.
//
// Two actions:
//   * requestEmailChange({ newEmail, currentPassword }) — session-guarded.
//     Verifies the password, rate-limits like login, stores the target in
//     AuthCredential.pendingEmail, emails a confirmation link to the NEW
//     address and a fraud alert to the OLD one.
//   * confirmEmailChange({ token }) — public. Verifies the JWT, matches the
//     newEmail against pendingEmail (single-use enforcement), writes the
//     wrapper email, clears pendingEmail, bumps passwordChangedAt to
//     invalidate every session (the getSessionUser iat check does the rest),
//     and emails both addresses that the change landed.

import bcrypt from "bcryptjs";
import { z } from "zod";
import { withRls } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { checkRateLimitWithIp } from "@/lib/rate-limit";
import { getCurrentTenant } from "@/lib/current-tenant";
import { signEmailChangeToken, verifyEmailChangeToken } from "@/lib/session";
import {
  systemContext,
  getEndUser,
  getTeamMember,
  updateEndUser,
  updateTeamMember,
} from "@/lib/shared-platform";
import {
  sendEmailChangeConfirmation,
  sendEmailChangeAlert,
  sendEmailChangedNotice,
} from "@/lib/email/events";

function siteUrl() {
  return process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
}

const requestSchema = z.object({
  newEmail: z.string().email().max(200),
  currentPassword: z.string().min(1),
});

type RequestResult = { ok: true } | { error: string };

export async function requestEmailChange(input: z.infer<typeof requestSchema>): Promise<RequestResult> {
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const data = parsed.data;
  const newEmail = data.newEmail.trim().toLowerCase();

  const session = await requireSession();

  // Same shape as login/reset: identity bucket + IP bucket. Prevents a
  // credentials-stuffing attacker from grinding through pw guesses against
  // one victim as well as a broad IP spraying attack.
  const rate = await checkRateLimitWithIp(
    `email-change:${session.tenantId}:${session.subjectId}`,
    5,
    20,
    60_000
  );
  if (!rate.allowed) return { error: "Too many attempts. Try again shortly." };

  const isStaff = session.role !== "CLIENT";
  const ctx = systemContext(session.tenantId);
  const [currentSubject, tenant] = await Promise.all([
    isStaff ? getTeamMember(ctx, session.subjectId) : getEndUser(ctx, session.subjectId),
    getCurrentTenant(),
  ]);
  if (!currentSubject) return { error: "Account not found." };
  if (currentSubject.email.toLowerCase() === newEmail) {
    return { error: "That's already your current email." };
  }

  const result = await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const subjectField = isStaff ? "subjectTeamMemberId" : "subjectEndUserId";
      const cred = await tx.authCredential.findFirst({
        where: { tenantId: session.tenantId, [subjectField]: session.subjectId },
      });
      if (!cred) return { error: "Account not found." as const };

      const valid = await bcrypt.compare(data.currentPassword, cred.passwordHash);
      // Deliberately generic: don't distinguish wrong-password from no-cred
      // so the rate limit is the only externally observable signal.
      if (!valid) return { error: "Current password is incorrect." as const };

      // Uniqueness check inside the tx: the target must not collide with any
      // other subject's authoritative email in this tenant. (We ignore rows
      // that happen to *hold* the target as pendingEmail — a race where two
      // people try to grab the same address gets resolved at confirm time
      // when updateEndUser/updateTeamMember hit the wrapper's unique index.)
      const conflictEndUser = await tx.endUser.findFirst({
        where: { tenantId: session.tenantId, email: newEmail, NOT: { id: session.subjectId } },
        select: { id: true },
      });
      const conflictTeamMember = conflictEndUser
        ? null
        : await tx.teamMember.findFirst({
            where: { tenantId: session.tenantId, email: newEmail, NOT: { id: session.subjectId } },
            select: { id: true },
          });
      if (conflictEndUser || conflictTeamMember) {
        return { error: "That email is already in use." as const };
      }

      await tx.authCredential.update({
        where: { id: cred.id },
        data: { pendingEmail: newEmail, pendingEmailRequestedAt: new Date() },
      });
      return { ok: true as const };
    }
  );

  if ("error" in result) return { error: result.error ?? "Couldn't request change." };

  const token = await signEmailChangeToken({
    userId: session.subjectId,
    tenantId: session.tenantId,
    newEmail,
  });
  const confirmUrl = `${siteUrl()}/auth/email-change/confirm?token=${encodeURIComponent(token)}`;
  // Fire-and-forget in parallel — both should send, but if one bounces we
  // don't want to leave the pendingEmail set with no link out.
  await Promise.all([
    sendEmailChangeConfirmation(newEmail, confirmUrl, tenant.branding ?? null),
    sendEmailChangeAlert(currentSubject.email, newEmail, tenant.branding ?? null),
  ]);
  return { ok: true };
}

const confirmSchema = z.object({ token: z.string().min(1) });

type ConfirmResult = { ok: true; redirectTo: string } | { error: string };

export async function confirmEmailChange(input: z.infer<typeof confirmSchema>): Promise<ConfirmResult> {
  const parsed = confirmSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid link." };

  const rate = await checkRateLimitWithIp(
    `email-change-confirm:${parsed.data.token.slice(0, 16)}`,
    10,
    20,
    60_000
  );
  if (!rate.allowed) return { error: "Too many attempts. Try again shortly." };

  const payload = await verifyEmailChangeToken(parsed.data.token);
  if (!payload) return { error: "This link is invalid or has expired." };

  const ctx = systemContext(payload.tenantId);
  const tenant = await getCurrentTenant();

  const result = await withRls(
    { tenantId: payload.tenantId, userId: payload.userId, role: "SUPER_ADMIN" },
    async (tx) => {
      // Find the credential row and confirm pendingEmail still matches — a
      // superseding request would have overwritten it, and a repeat click
      // finds it cleared.
      const cred = await tx.authCredential.findFirst({
        where: {
          tenantId: payload.tenantId,
          OR: [
            { subjectEndUserId: payload.userId },
            { subjectTeamMemberId: payload.userId },
          ],
        },
      });
      if (!cred) return { failed: true, message: "This link is invalid or has expired." as const };
      if (cred.pendingEmail !== payload.newEmail) {
        return { failed: true, message: "This link is no longer valid." as const };
      }

      const isStaff = cred.subjectTeamMemberId != null;

      // Clear the pending column and bump passwordChangedAt so every existing
      // session's JWT (iat < now) is rejected on next getSessionUser().
      const now = new Date();
      await tx.authCredential.update({
        where: { id: cred.id },
        data: { pendingEmail: null, pendingEmailRequestedAt: null, passwordChangedAt: now },
      });

      return { failed: false as const, isStaff };
    }
  );

  if (result.failed) return { error: result.message };

  // Wrapper writes happen outside the withRls tx — updateEndUser /
  // updateTeamMember have their own tx and RLS setup. Read the old email
  // for the notice before we swap.
  const oldSubject = result.isStaff
    ? await getTeamMember(ctx, payload.userId)
    : await getEndUser(ctx, payload.userId);
  if (!oldSubject) return { error: "Account not found." };
  const oldEmail = oldSubject.email;

  try {
    if (result.isStaff) {
      await updateTeamMember(ctx, payload.userId, { email: payload.newEmail });
    } else {
      await updateEndUser(ctx, payload.userId, { email: payload.newEmail });
    }
  } catch {
    return { error: "That email is already in use." };
  }

  await Promise.all([
    sendEmailChangedNotice(oldEmail, oldEmail, payload.newEmail, tenant.branding ?? null),
    sendEmailChangedNotice(payload.newEmail, oldEmail, payload.newEmail, tenant.branding ?? null),
  ]);

  // Don't call destroySessionCookie() here — this action is invoked from a
  // Server Component (the confirm page), which can only *read* cookies. The
  // passwordChangedAt bump above is what actually kills every session (the
  // getSessionUser iat check drops the JWT on next request); the browser
  // hitting /auth/login will fall through cleanly to the sign-in prompt.
  return { ok: true, redirectTo: "/auth/login?emailChanged=1" };
}
