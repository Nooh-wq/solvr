"use server";

import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma, withRls } from "@/lib/db";
import {
  tenantSignupSchema,
  verifyTenantSignupSchema,
} from "@/lib/validation/signup";
import { signTenantSignupToken, verifyTenantSignupToken, createSessionCookie } from "@/lib/session";
import { createUserSession } from "@/lib/user-session";
import { recordLoginActivity } from "@/lib/login-activity";
import { sendLoginOtpEmail } from "@/lib/email/events";
import { checkRateLimitWithIp } from "@/lib/rate-limit";
import {
  systemContext,
  seedStandardRoles,
  getRoleByName,
  createTeamMember,
  getOrCreateDefaultGroup,
  assignTeamMemberToGroup,
} from "@/lib/shared-platform";
import { randomUUID } from "node:crypto";

// Default seed data for a brand-new client tenant. Kept in sync with
// super.ts's createTenant() so the two paths produce identical starting
// state — a tenant provisioned by a Stralis operator vs. self-signup
// should be indistinguishable once created.
const DEFAULT_CATEGORIES = ["Technical", "Billing", "General", "Other"];

function generateOtpCode() {
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");
}

export type StartTenantSignupResult =
  | { ok: true; otpToken: string; email: string }
  | { ok: false; error: string; field?: "slug" | "adminEmail" };

/**
 * Zendesk-style workspace signup, step 1: validate the form, verify the
 * slug + email are still available, and email a 6-digit code. Tenant + user
 * are deliberately NOT created here — creating them upfront would leave
 * orphan rows (and burn the slug forever) every time someone drops off
 * between the form and OTP verification. Instead the whole payload rides
 * on a signed, short-lived JWT until step 2 verifies the code.
 */
export async function startTenantSignup(input: z.infer<typeof tenantSignupSchema>): Promise<StartTenantSignupResult> {
  const parsed = tenantSignupSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const data = parsed.data;

  // Rate-limit by IP so a scripted attacker can't burn through slugs or
  // spray verification emails at arbitrary addresses. Deliberately loose
  // (10 per minute) — real users only signup once.
  const rl = await checkRateLimitWithIp("tenant-signup", 10, 10, 60_000);
  if (!rl.allowed) return { ok: false, error: "Too many signup attempts. Try again shortly." };

  // Uniqueness checks need to see across ALL tenants, but the users table's
  // tenant_isolation RLS policy would restrict a scoped session to its own
  // tenant only. We open the pre-signup transaction as role SUPER_ADMIN
  // (same established pattern the CSAT verify path uses to read tickets
  // that a token has proven access to) — this is the only elevation on
  // this public endpoint, tightly wrapped around the two checks.
  const hostTenant = await prisma.tenant.findUnique({ where: { slug: "stralis" } });
  if (!hostTenant) return { ok: false, error: "Signup unavailable — please contact support." };

  const uniqueness = await withRls(
    { tenantId: hostTenant.id, userId: null, role: "SUPER_ADMIN" },
    async (tx) => ({
      slugTaken: await tx.tenant.findUnique({ where: { slug: data.slug } }),
      // Z1.5b: email uniqueness now checks wrapper tables (team_members +
      // end_users) cross-tenant under SUPER_ADMIN scope. Legacy users table
      // is gone.
      emailTaken:
        (await tx.teamMember.findFirst({ where: { email: data.adminEmail } })) ??
        (await tx.endUser.findFirst({ where: { email: data.adminEmail } })),
    })
  );
  if (uniqueness.slugTaken) return { ok: false, error: "That workspace URL is taken — pick another.", field: "slug" };
  if (uniqueness.emailTaken) return { ok: false, error: "An account with this email already exists — log in instead.", field: "adminEmail" };

  const passwordHash = await bcrypt.hash(data.password, 10);
  const code = generateOtpCode();
  const codeHash = await bcrypt.hash(code, 10);

  const otpToken = await signTenantSignupToken({
    tenantName: data.tenantName,
    slug: data.slug,
    adminName: data.adminName,
    adminEmail: data.adminEmail,
    passwordHash,
    codeHash,
  });

  // No branding row exists yet — email uses the host tenant's default
  // "Solvr" branding, same as any other pre-tenant email.
  await sendLoginOtpEmail(data.adminEmail, code, null);

  return { ok: true, otpToken, email: data.adminEmail };
}

export type VerifyTenantSignupResult =
  | { ok: true; redirectTo: string }
  | { ok: false; error: string };

/**
 * Signup step 2: verifies the OTP code, then creates the Tenant, its
 * default branding/chatbot/categories, and the SUPER_ADMIN owner user in
 * one transaction. On success, a real session cookie is set and the
 * caller is redirected into their brand-new admin panel.
 */
export async function verifyTenantSignup(input: z.infer<typeof verifyTenantSignupSchema>): Promise<VerifyTenantSignupResult> {
  const parsed = verifyTenantSignupSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };

  const payload = await verifyTenantSignupToken(parsed.data.otpToken);
  if (!payload) return { ok: false, error: "This signup session has expired — please start over." };

  const rl = await checkRateLimitWithIp(`tenant-signup-verify:${payload.adminEmail}`, 8, 15, 60_000);
  if (!rl.allowed) return { ok: false, error: `Too many attempts. Try again in ${Math.ceil(rl.retryAfterMs / 1000)}s.` };

  const codeOk = await bcrypt.compare(parsed.data.code, payload.codeHash);
  if (!codeOk) return { ok: false, error: "Incorrect code. Please try again." };

  const hostTenant = await prisma.tenant.findUnique({ where: { slug: "stralis" } });
  if (!hostTenant) return { ok: false, error: "Signup unavailable — please contact support." };

  // Same SUPER_ADMIN elevation as step 1's uniqueness check (see the
  // comment there). Slug/email could have been taken between step 1 and
  // step 2 (small race window between the JWT being issued and this call),
  // so re-check inside the transaction — the second signer loses cleanly
  // with a clear error instead of hitting a raw unique-constraint
  // violation from Postgres.
  const created = await withRls(
    { tenantId: hostTenant.id, userId: null, role: "SUPER_ADMIN" },
    async (tx) => {
      const slugTaken = await tx.tenant.findUnique({ where: { slug: payload.slug } });
      if (slugTaken) throw new Error("SLUG_TAKEN");
      // Z1.5b: cross-tenant email uniqueness on wrapper tables.
      const emailTaken =
        (await tx.teamMember.findFirst({ where: { email: payload.adminEmail } })) ??
        (await tx.endUser.findFirst({ where: { email: payload.adminEmail } }));
      if (emailTaken) throw new Error("EMAIL_TAKEN");

      const tenant = await tx.tenant.create({
        data: {
          name: payload.tenantName,
          slug: payload.slug,
          type: "CLIENT",
          status: "TRIAL",
          branding: { create: { productName: payload.tenantName } },
          chatbotConfig: { create: {} },
        },
      });

      for (const name of DEFAULT_CATEGORIES) {
        await tx.category.create({ data: { tenantId: tenant.id, name } });
      }

      // Z1.5b: allocate the subject id up-front so credentials + lifecycle
      // + audit-log rows all reference the same id the wrapper TeamMember
      // will get post-tx. Same shape as super.ts::createTenant.
      const subjectId = randomUUID();
      const now = new Date();
      await tx.authCredential.create({
        data: {
          tenantId: tenant.id,
          subjectTeamMemberId: subjectId,
          passwordHash: payload.passwordHash,
        },
      });
      await tx.teamMemberLifecycle.create({
        data: {
          tenantId: tenant.id,
          subjectId,
          status: "ACTIVE",
          approvedAt: now,
          lastActiveAt: now,
        },
      });

      await tx.auditLog.create({
        // Newly created tenant's SUPER_ADMIN is always staff → TeamMember.
        data: {
          tenantId: tenant.id,
          actorTeamMemberId: subjectId,
          action: "TENANT_CREATED",
          toValue: tenant.name,
        },
      });

      return { tenantId: tenant.id, userId: subjectId };
    }
  ).catch((e) => {
    if (e instanceof Error && e.message === "SLUG_TAKEN") return { failed: "SLUG_TAKEN" as const };
    if (e instanceof Error && e.message === "EMAIL_TAKEN") return { failed: "EMAIL_TAKEN" as const };
    throw e;
  });

  if ("failed" in created) {
    return {
      ok: false,
      error:
        created.failed === "SLUG_TAKEN"
          ? "That workspace URL was just claimed by someone else. Please start over with a different one."
          : "An account with this email was just created elsewhere. Log in instead.",
    };
  }

  // Z1.5b: wrapper provisioning happens post-tx. Seeds standard roles +
  // default group, then materializes the wrapper TeamMember at the same
  // subjectId that the credentials + lifecycle rows already reference.
  const ctx = systemContext(created.tenantId);
  await seedStandardRoles(ctx);
  const superAdminRole = await getRoleByName(ctx, "Super Admin");
  if (!superAdminRole) throw new Error("STANDARD_ROLES_NOT_SEEDED");
  const defaultGroup = await getOrCreateDefaultGroup(ctx);
  const adminTeamMember = await createTeamMember(ctx, {
    id: created.userId,
    email: payload.adminEmail,
    name: payload.adminName,
    roleId: superAdminRole.id,
  });
  await assignTeamMemberToGroup(ctx, adminTeamMember.id, defaultGroup.id);

  // Tenant signup creates the initial SUPER_ADMIN — always a TEAM_MEMBER.
  const sessionId = await createUserSession({
    subjectId: created.userId,
    subjectKind: "TEAM_MEMBER",
    tenantId: created.tenantId,
  });
  await createSessionCookie({
    subjectId: created.userId,
    subjectKind: "TEAM_MEMBER",
    tenantId: created.tenantId,
    sessionId,
  });
  await recordLoginActivity({
    tenantId: created.tenantId,
    subjectId: created.userId,
    subjectKind: "TEAM_MEMBER",
  });
  return { ok: true, redirectTo: "/admin" };
}
