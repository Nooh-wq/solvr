"use server";

import { z } from "zod";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { withRls } from "@/lib/db";
import {
  createSessionCookie,
  destroySessionCookie,
  signPasswordResetToken,
  verifyPasswordResetToken,
  verifyInviteToken,
  signOtpSessionToken,
  verifyOtpSessionToken,
} from "@/lib/session";
import { getCurrentTenant } from "@/lib/current-tenant";
import { checkRateLimitWithIp } from "@/lib/rate-limit";
import {
  sendRegistrationPendingEmail,
  sendRegistrationApprovedEmail,
  sendNewRegistrationAdminNotice,
  sendPasswordResetEmail,
  sendLoginOtpEmail,
} from "@/lib/email/events";
import { notify } from "@/lib/notifications";

const REDIRECT_BY_ROLE: Record<string, string> = {
  CLIENT: "/portal",
  AGENT: "/agent",
  ADMIN: "/admin",
  SUPER_ADMIN: "/admin/super",
};

function siteUrl() {
  return process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
}

const registerSchema = z.object({
  name: z.string().min(1).max(120),
  email: z.string().email(),
  password: z.string().min(8).max(72),
  company: z.string().max(120).optional(),
});

/**
 * Email flow design §"Registration Approval Gate": new users start PENDING
 * and can't log in until an admin of *this* tenant approves them (never
 * Stralis on a client tenant's behalf — approval is scoped by tenantId same
 * as everything else). Exception: if the registrant's email domain already
 * has an ACTIVE user in this tenant, auto-approve — same company, already
 * trusted once.
 */
export async function registerClient(input: z.infer<typeof registerSchema>) {
  const data = registerSchema.parse(input);
  const tenant = await getCurrentTenant();

  const rateLimit = await checkRateLimitWithIp(`register:${tenant.id}`, 20, 10, 60_000);
  if (!rateLimit.allowed) return { error: "Too many registration attempts. Try again shortly." };

  const passwordHash = await bcrypt.hash(data.password, 10);
  const domain = data.email.split("@")[1]?.toLowerCase();

  // No session yet — establish RLS scope from the resolved host tenant alone
  // (same pattern as getSessionUser(); see src/lib/auth.ts).
  type TxResult =
    | { failed: true; message: string }
    | { failed: false; email: string; autoApproved: boolean; admins: { id: string; email: string }[]; branding: Awaited<ReturnType<typeof getCurrentTenant>>["branding"] };

  const result: TxResult = await withRls({ tenantId: tenant.id, userId: null }, async (tx) => {
    const existing = await tx.user.findUnique({
      where: { tenantId_email: { tenantId: tenant.id, email: data.email } },
    });
    if (existing) return { failed: true, message: "An account with this email already exists." };

    const domainApproved = domain
      ? await tx.user.findFirst({
          where: { tenantId: tenant.id, status: "ACTIVE", email: { endsWith: `@${domain}`, mode: "insensitive" } },
        })
      : null;

    const user = await tx.user.create({
      data: {
        tenantId: tenant.id,
        passwordHash,
        name: data.name,
        email: data.email,
        company: data.company,
        role: "CLIENT",
        status: domainApproved ? "ACTIVE" : "PENDING",
      },
    });

    const admins = domainApproved
      ? []
      : await tx.user.findMany({ where: { tenantId: tenant.id, role: { in: ["ADMIN", "SUPER_ADMIN"] }, status: "ACTIVE" } });

    if (admins.length > 0) {
      await notify(
        tx,
        ...admins.map((a) => ({
          tenantId: tenant.id,
          userId: a.id,
          type: "REGISTRATION_PENDING" as const,
          title: `New registration awaiting approval: ${data.name}`,
          body: data.email,
        }))
      );
    }

    const branding = await tx.tenantBranding.findUnique({ where: { tenantId: tenant.id } });

    return { failed: false, email: user.email, autoApproved: Boolean(domainApproved), admins, branding };
  });

  if (result.failed) return { error: result.message };

  // Sent after the transaction commits — email delivery never blocks/rolls back the mutation.
  if (result.autoApproved) {
    await sendRegistrationApprovedEmail(result.email, result.branding);
  } else {
    await sendRegistrationPendingEmail(result.email, result.branding);
    await Promise.all(
      result.admins.map((a) => sendNewRegistrationAdminNotice(a.email, { name: data.name, email: data.email, company: data.company ?? null }, result.branding))
    );
  }

  return { ok: true as const, autoApproved: result.autoApproved };
}

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// A real bcrypt hash to compare against when the email doesn't exist, so the
// "no such user" path spends the same ~time as the "wrong password" path.
// Without this, an attacker can measure response time to enumerate which
// emails have accounts (the missing-user path would return instantly, skipping
// the expensive hash). Computed once at module load.
const DUMMY_PASSWORD_HASH = bcrypt.hashSync("timing-attack-equalizer", 10);

export async function login(input: z.infer<typeof loginSchema>) {
  const data = loginSchema.parse(input);
  const tenant = await getCurrentTenant();
  if (tenant.status === "SUSPENDED") return { error: "This workspace is currently suspended." };

  // Per tenant+email AND per IP — stops both "one attacker hammering one
  // account" and "one attacker spraying many accounts from one IP".
  const rateLimitKey = `login:${tenant.id}:${data.email.toLowerCase()}`;
  const rateLimit = await checkRateLimitWithIp(rateLimitKey, 5, 20, 60_000);
  if (!rateLimit.allowed) {
    return { error: `Too many attempts. Try again in ${Math.ceil(rateLimit.retryAfterMs / 1000)}s.` };
  }

  const dbUser = await withRls({ tenantId: tenant.id, userId: null }, (tx) =>
    tx.user.findUnique({ where: { tenantId_email: { tenantId: tenant.id, email: data.email } } })
  );

  // Always run a bcrypt compare — against the real hash if the user exists, or
  // a dummy hash if not — so response timing doesn't reveal whether the email
  // is registered (user-enumeration defense). The generic error message is the
  // same for "no such user" and "wrong password".
  const valid = await bcrypt.compare(data.password, dbUser?.passwordHash ?? DUMMY_PASSWORD_HASH);
  if (!dbUser || !valid) return { error: "Invalid email or password." };

  // Password is correct, so it's safe to be specific about *why* login is
  // blocked (this isn't an enumeration risk once the password has already
  // been proven correct).
  if (dbUser.status === "PENDING") return { error: "Your account is still awaiting admin approval." };
  if (dbUser.status === "REJECTED") return { error: "Your registration request was not approved." };
  if (dbUser.status === "SUSPENDED") return { error: "This account has been deactivated." };
  // Practically unreachable (an INVITED account's passwordHash is a random
  // placeholder nobody could ever type — see inviteUser()), kept for
  // defense-in-depth rather than checked before the password comparison
  // above: front-loading it would let an attacker learn "this email has a
  // live invite" from a wrong-password guess alone, which is exactly the
  // enumeration risk this whole "reveal the reason only once the password's
  // already proven correct" ordering exists to avoid.
  if (dbUser.status === "INVITED") return { error: "Please accept your invite email first to set up your account." };

  await createSessionCookie({ userId: dbUser.id, tenantId: dbUser.tenantId });
  return { ok: true, redirectTo: REDIRECT_BY_ROLE[dbUser.role] };
}

export async function logout() {
  await destroySessionCookie();
}

const resetSchema = z.object({ email: z.string().email() });

/** Always returns { ok: true } regardless of whether the email exists, is pending/rejected/suspended, etc. — the response must not let a caller distinguish "no such account" from "email sent" (user enumeration). */
export async function requestPasswordReset(input: z.infer<typeof resetSchema>) {
  const data = resetSchema.parse(input);
  const tenant = await getCurrentTenant();

  const rateLimit = await checkRateLimitWithIp(`reset:${tenant.id}:${data.email.toLowerCase()}`, 3, 10, 60_000);
  if (!rateLimit.allowed) return { ok: true }; // don't reveal rate-limiting to a potential enumerator either

  const { user, branding } = await withRls({ tenantId: tenant.id, userId: null }, async (tx) => {
    const user = await tx.user.findUnique({
      where: { tenantId_email: { tenantId: tenant.id, email: data.email } },
    });
    const branding = await tx.tenantBranding.findUnique({ where: { tenantId: tenant.id } });
    return { user, branding };
  });

  // Only ACTIVE accounts get a link — PENDING/REJECTED/SUSPENDED silently get
  // nothing (still returns { ok: true } either way, so this isn't observable).
  if (user && user.status === "ACTIVE") {
    const token = await signPasswordResetToken({ userId: user.id, tenantId: tenant.id });
    const resetUrl = `${siteUrl()}/auth/reset/confirm?token=${encodeURIComponent(token)}`;
    await sendPasswordResetEmail(user.email, resetUrl, branding);
  }

  return { ok: true };
}

const confirmResetSchema = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(8).max(72),
});

type ConfirmPasswordResetResult = { error: string } | { ok: true; redirectTo: string };

/** Consumes a password-reset link token: validates it, sets the new password, and logs the user in. Single-use via passwordChangedAt (see session.ts's comment on signPasswordResetToken). */
export async function confirmPasswordReset(
  input: z.infer<typeof confirmResetSchema>
): Promise<ConfirmPasswordResetResult> {
  const data = confirmResetSchema.parse(input);

  const rateLimit = await checkRateLimitWithIp(`reset-confirm:${data.token.slice(0, 16)}`, 10, 20, 60_000);
  if (!rateLimit.allowed) return { error: "Too many attempts. Try again shortly." };

  const payload = await verifyPasswordResetToken(data.token);
  if (!payload) return { error: "This reset link is invalid or has expired." };

  type TxResult = { failed: true; message: string } | { failed: false; role: string };

  const result: TxResult = await withRls({ tenantId: payload.tenantId, userId: payload.userId }, async (tx) => {
    const user = await tx.user.findFirst({ where: { id: payload.userId, tenantId: payload.tenantId } });
    if (!user || user.status !== "ACTIVE") return { failed: true, message: "This reset link is invalid or has expired." };

    // Single-use enforcement: reject if this token predates a password change
    // that already happened (either from this same link being used once
    // already, or from an unrelated password change since the link was sent).
    if (user.passwordChangedAt && (payload.iat ?? 0) < Math.floor(user.passwordChangedAt.getTime() / 1000)) {
      return { failed: true, message: "This reset link has already been used." };
    }

    const passwordHash = await bcrypt.hash(data.newPassword, 10);
    await tx.user.update({ where: { id: user.id }, data: { passwordHash, passwordChangedAt: new Date() } });
    return { failed: false, role: user.role };
  });

  if (result.failed) return { error: result.message };

  await createSessionCookie({ userId: payload.userId, tenantId: payload.tenantId });
  return { ok: true as const, redirectTo: REDIRECT_BY_ROLE[result.role] };
}

// ---------------------------------------------------------------------------
// Invite accept + first-login OTP (Team > Invite — see actions/admin.ts's
// inviteUser()). Two steps, chained by a short-lived JWT the client holds
// between them (see lib/session.ts for why); no session cookie exists until
// verifyLoginOtp() succeeds at the very end.
// ---------------------------------------------------------------------------

const OTP_DURATION_MS = 10 * 60 * 1000; // 10 minutes

function generateOtpCode() {
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");
}

const acceptInviteSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8).max(72),
});

type AcceptInviteResult = { error: string } | { ok: true; otpToken: string };

/** Step 1: consumes the emailed invite link, sets the invitee's own password, and emails a one-time code for step 2 (verifyLoginOtp). */
export async function acceptInvite(input: z.infer<typeof acceptInviteSchema>): Promise<AcceptInviteResult> {
  const data = acceptInviteSchema.parse(input);

  const rateLimit = await checkRateLimitWithIp(`invite-accept:${data.token.slice(0, 16)}`, 10, 20, 60_000);
  if (!rateLimit.allowed) return { error: "Too many attempts. Try again shortly." };

  const payload = await verifyInviteToken(data.token);
  if (!payload) return { error: "This invite link is invalid or has expired." };

  type TxResult =
    | { failed: true; message: string }
    | { failed: false; email: string; code: string; branding: Awaited<ReturnType<typeof getCurrentTenant>>["branding"] };

  const result: TxResult = await withRls({ tenantId: payload.tenantId, userId: payload.userId }, async (tx) => {
    const user = await tx.user.findFirst({ where: { id: payload.userId, tenantId: payload.tenantId } });
    if (!user || user.status !== "INVITED") {
      return { failed: true, message: "This invite has already been used or is no longer valid." };
    }

    const passwordHash = await bcrypt.hash(data.password, 10);
    await tx.user.update({
      where: { id: user.id },
      data: { passwordHash, status: "ACTIVE", passwordChangedAt: new Date() },
    });

    // The plaintext code only ever exists transiently in this closure — never
    // stored, only its bcrypt hash is (verifyLoginOtp compares against that).
    const code = generateOtpCode();
    const codeHash = await bcrypt.hash(code, 10);
    await tx.loginOtp.create({
      data: {
        tenantId: payload.tenantId,
        userId: user.id,
        codeHash,
        expiresAt: new Date(Date.now() + OTP_DURATION_MS),
      },
    });

    const branding = await tx.tenantBranding.findUnique({ where: { tenantId: payload.tenantId } });
    return { failed: false, email: user.email, code, branding };
  });

  if (result.failed) return { error: result.message };

  await sendLoginOtpEmail(result.email, result.code, result.branding);

  const otpToken = await signOtpSessionToken({ userId: payload.userId, tenantId: payload.tenantId });
  return { ok: true, otpToken };
}

const verifyOtpSchema = z.object({
  otpToken: z.string().min(1),
  code: z.string().min(6).max(6),
});

type VerifyOtpResult = { error: string } | { ok: true; redirectTo: string };

/** Step 2: verifies the emailed code and, only now, actually creates the session. */
export async function verifyLoginOtp(input: z.infer<typeof verifyOtpSchema>): Promise<VerifyOtpResult> {
  const data = verifyOtpSchema.parse(input);

  const payload = await verifyOtpSessionToken(data.otpToken);
  if (!payload) return { error: "This verification session has expired — please start over." };

  const rateLimit = await checkRateLimitWithIp(`otp-verify:${payload.userId}`, 8, 15, 60_000);
  if (!rateLimit.allowed) {
    return { error: `Too many attempts. Try again in ${Math.ceil(rateLimit.retryAfterMs / 1000)}s.` };
  }

  type TxResult = { failed: true; message: string } | { failed: false; role: string };

  const result: TxResult = await withRls({ tenantId: payload.tenantId, userId: payload.userId }, async (tx) => {
    const otp = await tx.loginOtp.findFirst({
      where: { userId: payload.userId, tenantId: payload.tenantId, consumedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
    });
    if (!otp) return { failed: true, message: "This code has expired — request a new invite link." };

    const valid = await bcrypt.compare(data.code, otp.codeHash);
    if (!valid) return { failed: true, message: "Incorrect code. Please try again." };

    await tx.loginOtp.update({ where: { id: otp.id }, data: { consumedAt: new Date() } });
    const user = await tx.user.findUniqueOrThrow({ where: { id: payload.userId } });
    return { failed: false, role: user.role };
  });

  if (result.failed) return { error: result.message };

  await createSessionCookie({ userId: payload.userId, tenantId: payload.tenantId });
  return { ok: true, redirectTo: REDIRECT_BY_ROLE[result.role] };
}
