"use server";

import { z } from "zod";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { randomUUID } from "node:crypto";
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
import { passwordSchema } from "@/lib/validation/password";
import {
  sendRegistrationPendingEmail,
  sendRegistrationApprovedEmail,
  sendNewRegistrationAdminNotice,
  sendPasswordResetEmail,
  sendLoginOtpEmail,
} from "@/lib/email/events";
import { notify } from "@/lib/notifications";
import { recordLoginActivity } from "@/lib/login-activity";
import { createUserSession } from "@/lib/user-session";
import { REDIRECT_BY_ROLE } from "@/lib/redirect-by-role";
import { matchCompanyByEmail } from "@/lib/company-match";
import {
  systemContext,
  createEndUser,
  getEndUser,
  getTeamMemberWithRoleName,
  listTeamMembers,
} from "@/lib/shared-platform";

function siteUrl() {
  return process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
}

function wrapperRoleNameToUserRole(name: string): "CLIENT" | "AGENT" | "ADMIN" | "SUPER_ADMIN" {
  if (name === "Super Admin") return "SUPER_ADMIN";
  if (name === "Admin") return "ADMIN";
  if (name === "Agent") return "AGENT";
  return "AGENT";
}

const registerSchema = z.object({
  name: z.string().min(1).max(120),
  email: z.string().email(),
  password: passwordSchema,
  company: z.string().max(120).optional(),
});

type RegisterResult = { error: string } | { ok: true; otpToken: string };

/**
 * Step 1 of registration: creates an UNVERIFIED account and emails a 6-digit
 * code to confirm the address is real, before it ever reaches an admin's
 * approval queue or the domain-auto-approval check.
 *
 * Z1.5b: wrapper EndUser is created for the new registrant. No legacy user.
 */
export async function registerClient(input: z.infer<typeof registerSchema>): Promise<RegisterResult> {
  const parsed = registerSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const data = parsed.data;

  const tenant = await getCurrentTenant();

  const rateLimit = await checkRateLimitWithIp(`register:${tenant.id}`, 20, 10, 60_000);
  if (!rateLimit.allowed) return { error: "Too many registration attempts. Try again shortly." };

  const passwordHash = await bcrypt.hash(data.password, 10);
  const ctx = systemContext(tenant.id);

  // Check if EndUser or TeamMember with this email already exists in tenant.
  const existing = await withRls({ tenantId: tenant.id, userId: null }, async (tx) => {
    const eu = await tx.endUser.findFirst({ where: { tenantId: tenant.id, email: data.email } });
    if (eu) return true;
    const tm = await tx.teamMember.findFirst({ where: { tenantId: tenant.id, email: data.email } });
    return !!tm;
  });
  if (existing) return { error: "An account with this email already exists." };

  const organizationId = await matchCompanyByEmail(tenant.id, data.email);
  const subjectId = randomUUID();

  // Create wrapper EndUser first (post-tx pattern would race with the OTP
  // insert below). Since createEndUser opens its own tx internally, run
  // it up front then do credentials + lifecycle + OTP in a single tx.
  await createEndUser(ctx, {
    id: subjectId,
    email: data.email,
    name: data.name,
    organizationId,
  });

  const result = await withRls({ tenantId: tenant.id, userId: null }, async (tx) => {
    await tx.authCredential.create({
      data: {
        tenantId: tenant.id,
        subjectEndUserId: subjectId,
        passwordHash,
      },
    });
    await tx.endUserLifecycle.create({
      data: { tenantId: tenant.id, subjectId, status: "UNVERIFIED" },
    });

    // OTP row: RLS policy on login_otps requires app.user_id to match the
    // row's dual-FK subject. Set it before insert since this tx started with
    // userId: null.
    await tx.$executeRaw`SELECT set_config('app.user_id', ${subjectId}, true)`;
    const code = generateOtpCode();
    const codeHash = await bcrypt.hash(code, 10);
    await tx.loginOtp.create({
      data: {
        tenantId: tenant.id,
        endUserId: subjectId,
        codeHash,
        expiresAt: new Date(Date.now() + OTP_DURATION_MS),
      },
    });

    const branding = await tx.tenantBranding.findUnique({ where: { tenantId: tenant.id } });
    return { userId: subjectId, email: data.email, code, branding };
  });

  await sendLoginOtpEmail(result.email, result.code, result.branding);
  const otpToken = await signOtpSessionToken({ userId: result.userId, tenantId: tenant.id });
  return { ok: true, otpToken };
}

type VerifyRegistrationOtpResult = { error: string } | { ok: true; redirectTo: string } | { ok: true; pending: true };

const verifyOtpSchema = z.object({
  otpToken: z.string().min(1),
  code: z.string().min(6).max(6),
});

/**
 * Step 2 of registration: verifies the emailed code, then applies the
 * approval-gate logic — auto-approve if the email's domain already has an
 * ACTIVE user in this tenant, otherwise PENDING.
 */
export async function verifyRegistrationOtp(input: z.infer<typeof verifyOtpSchema>): Promise<VerifyRegistrationOtpResult> {
  const parsed = verifyOtpSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const data = parsed.data;

  const payload = await verifyOtpSessionToken(data.otpToken);
  if (!payload) return { error: "This verification session has expired — please register again." };

  const rateLimit = await checkRateLimitWithIp(`register-otp-verify:${payload.userId}`, 8, 15, 60_000);
  if (!rateLimit.allowed) {
    return { error: `Too many attempts. Try again in ${Math.ceil(rateLimit.retryAfterMs / 1000)}s.` };
  }

  type TxResult =
    | { failed: true; message: string }
    | {
        failed: false;
        autoApproved: boolean;
        email: string;
        name: string;
        admins: { id: string; email: string }[];
        branding: Awaited<ReturnType<typeof getCurrentTenant>>["branding"];
      };

  const result: TxResult = await withRls({ tenantId: payload.tenantId, userId: payload.userId }, async (tx) => {
    const otp = await tx.loginOtp.findFirst({
      where: {
        endUserId: payload.userId,
        tenantId: payload.tenantId,
        consumedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: "desc" },
    });
    if (!otp) return { failed: true, message: "This code has expired — please register again." };

    const valid = await bcrypt.compare(data.code, otp.codeHash);
    if (!valid) return { failed: true, message: "Incorrect code. Please try again." };

    // Read EndUser identity + lifecycle status.
    const endUser = await tx.endUser.findFirst({
      where: { id: payload.userId, tenantId: payload.tenantId },
    });
    const lifecycle = await tx.endUserLifecycle.findUnique({ where: { subjectId: payload.userId } });
    if (!endUser || lifecycle?.status !== "UNVERIFIED") {
      return { failed: true, message: "This registration is no longer valid — please register again." };
    }

    await tx.loginOtp.update({ where: { id: otp.id }, data: { consumedAt: new Date() } });

    // Domain-auto-approval: any other ACTIVE EndUser or TeamMember in this
    // tenant with a matching email domain triggers auto-approve.
    const domain = endUser.email.split("@")[1]?.toLowerCase();
    let domainApproved = false;
    if (domain) {
      const [euMatch, tmMatch] = await Promise.all([
        tx.endUser.findFirst({
          where: { tenantId: payload.tenantId, email: { endsWith: `@${domain}`, mode: "insensitive" } },
        }),
        tx.teamMember.findFirst({
          where: { tenantId: payload.tenantId, email: { endsWith: `@${domain}`, mode: "insensitive" } },
        }),
      ]);
      domainApproved = !!(euMatch || tmMatch);
    }

    const nextStatus = domainApproved ? "ACTIVE" as const : "PENDING" as const;
    const approvedAt = domainApproved ? new Date() : null;
    await tx.endUserLifecycle.upsert({
      where: { subjectId: endUser.id },
      create: { subjectId: endUser.id, tenantId: payload.tenantId, status: nextStatus, approvedAt },
      update: { status: nextStatus, approvedAt },
    });

    // Admin recipients for the "new registration awaiting approval" notice.
    const admins = domainApproved
      ? []
      : await tx.teamMember.findMany({
          where: {
            tenantId: payload.tenantId,
            role: { name: { in: ["Admin", "Super Admin"] } },
          },
          select: { id: true, email: true },
        });

    if (admins.length > 0) {
      await notify(
        tx,
        ...admins.map((a) => ({
          tenantId: payload.tenantId,
          userId: a.id,
          type: "REGISTRATION_PENDING" as const,
          title: `New registration awaiting approval: ${endUser.name ?? endUser.email}`,
          body: endUser.email,
        }))
      );
    }

    const branding = await tx.tenantBranding.findUnique({ where: { tenantId: payload.tenantId } });
    return {
      failed: false,
      autoApproved: domainApproved,
      email: endUser.email,
      name: endUser.name ?? endUser.email,
      admins,
      branding,
    };
  });

  if (result.failed) return { error: result.message };

  if (result.autoApproved) {
    await sendRegistrationApprovedEmail(result.email, result.branding);
    const sessionId = await createUserSession({
      subjectId: payload.userId,
      subjectKind: "END_USER",
      tenantId: payload.tenantId,
    });
    await createSessionCookie({
      subjectId: payload.userId,
      subjectKind: "END_USER",
      tenantId: payload.tenantId,
      sessionId,
    });
    await recordLoginActivity({
      tenantId: payload.tenantId,
      subjectId: payload.userId,
      subjectKind: "END_USER",
    });
    return { ok: true, redirectTo: REDIRECT_BY_ROLE.CLIENT };
  }

  await sendRegistrationPendingEmail(result.email, result.branding);
  await Promise.all(
    result.admins.map((a) => sendNewRegistrationAdminNotice(a.email, { name: result.name, email: result.email, company: null }, result.branding))
  );
  return { ok: true, pending: true };
}

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const DUMMY_PASSWORD_HASH = bcrypt.hashSync("timing-attack-equalizer", 10);

export async function login(input: z.infer<typeof loginSchema>) {
  const data = loginSchema.parse(input);
  const tenant = await getCurrentTenant();
  if (tenant.status === "SUSPENDED") return { error: "This workspace is currently suspended." };

  const rateLimitKey = `login:${tenant.id}:${data.email.toLowerCase()}`;
  const rateLimit = await checkRateLimitWithIp(rateLimitKey, 5, 20, 60_000);
  if (!rateLimit.allowed) {
    return { error: `Too many attempts. Try again in ${Math.ceil(rateLimit.retryAfterMs / 1000)}s.` };
  }

  // Z1.5b: identity from wrapper (EndUser + TeamMember), password from
  // auth_credentials, status from lifecycle. All reads share one RLS tx.
  const lookup = await withRls({ tenantId: tenant.id, userId: null }, async (tx) => {
    const endUser = await tx.endUser.findFirst({
      where: { tenantId: tenant.id, email: data.email },
    });
    const teamMember = endUser
      ? null
      : await tx.teamMember.findFirst({
          where: { tenantId: tenant.id, email: data.email },
          include: { role: { select: { name: true } } },
        });
    if (!endUser && !teamMember) return null;

    const isStaff = !!teamMember;
    const subjectId = endUser?.id ?? teamMember!.id;
    const creds = await tx.authCredential.findFirst({
      where: isStaff
        ? { tenantId: tenant.id, subjectTeamMemberId: subjectId }
        : { tenantId: tenant.id, subjectEndUserId: subjectId },
    });
    const lifecycle = isStaff
      ? await tx.teamMemberLifecycle.findUnique({ where: { subjectId } })
      : await tx.endUserLifecycle.findUnique({ where: { subjectId } });
    return {
      subjectId,
      email: endUser?.email ?? teamMember!.email,
      isStaff,
      roleName: teamMember?.role.name ?? null,
      creds,
      lifecycle,
    };
  });

  const valid = await bcrypt.compare(data.password, lookup?.creds?.passwordHash ?? DUMMY_PASSWORD_HASH);
  if (!lookup || !lookup.creds || !valid) return { error: "Invalid email or password." };

  const status = lookup.lifecycle?.status;
  if (!status) return { error: "This account is not yet ready — please contact support." };

  if (status === "UNVERIFIED") return { error: "Please verify your email first — check your inbox for the code, or register again to get a new one." };
  if (status === "PENDING") return { error: "Your account is still awaiting admin approval." };
  if (status === "REJECTED") return { error: "Your registration request was not approved." };
  if (status === "SUSPENDED") return { error: "This account has been deactivated." };
  if (status === "INVITED") return { error: "Please accept your invite email first to set up your account." };

  const role = lookup.isStaff ? wrapperRoleNameToUserRole(lookup.roleName!) : "CLIENT";
  const subjectKind = lookup.isStaff ? "TEAM_MEMBER" : "END_USER";
  const sessionId = await createUserSession({
    subjectId: lookup.subjectId,
    subjectKind,
    tenantId: tenant.id,
  });
  await createSessionCookie({
    subjectId: lookup.subjectId,
    subjectKind,
    tenantId: tenant.id,
    sessionId,
  });
  // M21.3 — append-only login history. Fire-and-forget so a slow write
  // doesn't stall the login response; failure here is silently swallowed
  // since it must never block a valid credential from signing in.
  await recordLoginActivity({
    tenantId: tenant.id,
    subjectId: lookup.subjectId,
    subjectKind,
  });
  return { ok: true, redirectTo: REDIRECT_BY_ROLE[role] };
}

export async function logout() {
  await destroySessionCookie();
}

const resetSchema = z.object({ email: z.string().email() });

/**
 * Password-reset request. Always returns { ok: true } regardless of whether
 * the email exists — this is standard defense against user enumeration.
 */
export async function requestPasswordReset(input: z.infer<typeof resetSchema>): Promise<{ ok: true }> {
  const data = resetSchema.parse(input);
  const tenant = await getCurrentTenant();

  const rateLimit = await checkRateLimitWithIp(`reset:${tenant.id}:${data.email.toLowerCase()}`, 3, 10, 60_000);
  if (!rateLimit.allowed) return { ok: true };

  const { subject, isActive, branding } = await withRls({ tenantId: tenant.id, userId: null }, async (tx) => {
    const endUser = await tx.endUser.findFirst({
      where: { tenantId: tenant.id, email: data.email },
    });
    const teamMember = endUser
      ? null
      : await tx.teamMember.findFirst({
          where: { tenantId: tenant.id, email: data.email },
        });
    const subject = endUser
      ? { id: endUser.id, email: endUser.email, isStaff: false }
      : teamMember
        ? { id: teamMember.id, email: teamMember.email, isStaff: true }
        : null;
    const lifecycle = subject
      ? subject.isStaff
        ? await tx.teamMemberLifecycle.findUnique({ where: { subjectId: subject.id } })
        : await tx.endUserLifecycle.findUnique({ where: { subjectId: subject.id } })
      : null;
    const branding = await tx.tenantBranding.findUnique({ where: { tenantId: tenant.id } });
    return { subject, isActive: lifecycle?.status === "ACTIVE", branding };
  });

  if (subject && isActive) {
    const token = await signPasswordResetToken({ userId: subject.id, tenantId: tenant.id });
    const resetUrl = `${siteUrl()}/auth/reset/confirm?token=${encodeURIComponent(token)}`;
    await sendPasswordResetEmail(subject.email, resetUrl, branding);
  }

  return { ok: true };
}

const confirmResetSchema = z.object({
  token: z.string().min(1),
  newPassword: passwordSchema,
});

type ConfirmPasswordResetResult = { error: string } | { ok: true; redirectTo: string };

/** Consumes a password-reset link token: validates it, sets the new password, and logs the user in. */
export async function confirmPasswordReset(
  input: z.infer<typeof confirmResetSchema>
): Promise<ConfirmPasswordResetResult> {
  const parsed = confirmResetSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const data = parsed.data;

  const rateLimit = await checkRateLimitWithIp(`reset-confirm:${data.token.slice(0, 16)}`, 10, 20, 60_000);
  if (!rateLimit.allowed) return { error: "Too many attempts. Try again shortly." };

  const payload = await verifyPasswordResetToken(data.token);
  if (!payload) return { error: "This reset link is invalid or has expired." };

  type TxResult = { failed: true; message: string } | { failed: false; role: "CLIENT" | "AGENT" | "ADMIN" | "SUPER_ADMIN"; isStaff: boolean };

  const result: TxResult = await withRls({ tenantId: payload.tenantId, userId: payload.userId }, async (tx) => {
    // Try TeamMember first, fall back to EndUser (same subject id in either).
    const teamMember = await tx.teamMember.findFirst({
      where: { id: payload.userId, tenantId: payload.tenantId },
      include: { role: { select: { name: true } } },
    });
    const endUser = teamMember
      ? null
      : await tx.endUser.findFirst({
          where: { id: payload.userId, tenantId: payload.tenantId },
        });
    if (!teamMember && !endUser) return { failed: true, message: "This reset link is invalid or has expired." };

    const isStaff = !!teamMember;
    const subjectField = isStaff ? "subjectTeamMemberId" : "subjectEndUserId";
    const lifecycle = isStaff
      ? await tx.teamMemberLifecycle.findUnique({ where: { subjectId: payload.userId } })
      : await tx.endUserLifecycle.findUnique({ where: { subjectId: payload.userId } });
    if (lifecycle?.status !== "ACTIVE") return { failed: true, message: "This reset link is invalid or has expired." };

    const cred = await tx.authCredential.findFirst({
      where: { tenantId: payload.tenantId, [subjectField]: payload.userId },
    });
    if (cred?.passwordChangedAt && (payload.iat ?? 0) < Math.floor(cred.passwordChangedAt.getTime() / 1000)) {
      return { failed: true, message: "This reset link has already been used." };
    }

    const passwordHash = await bcrypt.hash(data.newPassword, 10);
    const now = new Date();
    await tx.authCredential.updateMany({
      where: { tenantId: payload.tenantId, [subjectField]: payload.userId },
      data: { passwordHash, passwordChangedAt: now },
    });
    const role: "CLIENT" | "AGENT" | "ADMIN" | "SUPER_ADMIN" = isStaff
      ? wrapperRoleNameToUserRole(teamMember!.role.name)
      : "CLIENT";
    return { failed: false, role, isStaff };
  });

  if (result.failed) return { error: result.message };

  const subjectKind = result.isStaff ? "TEAM_MEMBER" : "END_USER";
  const sessionId = await createUserSession({
    subjectId: payload.userId,
    subjectKind,
    tenantId: payload.tenantId,
  });
  await createSessionCookie({
    subjectId: payload.userId,
    subjectKind,
    tenantId: payload.tenantId,
    sessionId,
  });
  await recordLoginActivity({
    tenantId: payload.tenantId,
    subjectId: payload.userId,
    subjectKind,
  });
  return { ok: true as const, redirectTo: REDIRECT_BY_ROLE[result.role] };
}

// ---------------------------------------------------------------------------
// Invite accept + first-login OTP
// ---------------------------------------------------------------------------

const OTP_DURATION_MS = 10 * 60 * 1000;

function generateOtpCode() {
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");
}

const acceptInviteSchema = z.object({
  token: z.string().min(1),
  password: passwordSchema,
});

type AcceptInviteResult = { error: string } | { ok: true; otpToken: string };

export async function acceptInvite(input: z.infer<typeof acceptInviteSchema>): Promise<AcceptInviteResult> {
  const parsed = acceptInviteSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const data = parsed.data;

  const rateLimit = await checkRateLimitWithIp(`invite-accept:${data.token.slice(0, 16)}`, 10, 20, 60_000);
  if (!rateLimit.allowed) return { error: "Too many attempts. Try again shortly." };

  const payload = await verifyInviteToken(data.token);
  if (!payload) return { error: "This invite link is invalid or has expired." };

  type TxResult =
    | { failed: true; message: string }
    | { failed: false; email: string; code: string; branding: Awaited<ReturnType<typeof getCurrentTenant>>["branding"] };

  const result: TxResult = await withRls({ tenantId: payload.tenantId, userId: payload.userId }, async (tx) => {
    // Identify subject kind + status via lifecycle.
    const [teamMember, endUser] = await Promise.all([
      tx.teamMember.findFirst({ where: { id: payload.userId, tenantId: payload.tenantId } }),
      tx.endUser.findFirst({ where: { id: payload.userId, tenantId: payload.tenantId } }),
    ]);
    if (!teamMember && !endUser) {
      return { failed: true, message: "This invite has already been used or is no longer valid." };
    }
    const isStaff = !!teamMember;
    const email = teamMember?.email ?? endUser!.email;
    const lifecycle = isStaff
      ? await tx.teamMemberLifecycle.findUnique({ where: { subjectId: payload.userId } })
      : await tx.endUserLifecycle.findUnique({ where: { subjectId: payload.userId } });
    if (lifecycle?.status !== "INVITED") {
      return { failed: true, message: "This invite has already been used or is no longer valid." };
    }

    const passwordHash = await bcrypt.hash(data.password, 10);
    const now = new Date();
    const subjectField = isStaff ? "subjectTeamMemberId" : "subjectEndUserId";
    await tx.authCredential.updateMany({
      where: { tenantId: payload.tenantId, [subjectField]: payload.userId },
      data: { passwordHash, passwordChangedAt: now },
    });
    const lifecycleData = { tenantId: payload.tenantId, status: "ACTIVE" as const };
    if (isStaff) {
      await tx.teamMemberLifecycle.upsert({
        where: { subjectId: payload.userId },
        create: { subjectId: payload.userId, ...lifecycleData },
        update: lifecycleData,
      });
    } else {
      await tx.endUserLifecycle.upsert({
        where: { subjectId: payload.userId },
        create: { subjectId: payload.userId, ...lifecycleData },
        update: lifecycleData,
      });
    }

    const code = generateOtpCode();
    const codeHash = await bcrypt.hash(code, 10);
    const otpSubject = isStaff ? { teamMemberId: payload.userId } : { endUserId: payload.userId };
    await tx.loginOtp.create({
      data: {
        tenantId: payload.tenantId,
        ...otpSubject,
        codeHash,
        expiresAt: new Date(Date.now() + OTP_DURATION_MS),
      },
    });

    const branding = await tx.tenantBranding.findUnique({ where: { tenantId: payload.tenantId } });
    return { failed: false, email, code, branding };
  });

  if (result.failed) return { error: result.message };

  await sendLoginOtpEmail(result.email, result.code, result.branding);
  const otpToken = await signOtpSessionToken({ userId: payload.userId, tenantId: payload.tenantId });
  return { ok: true, otpToken };
}

type VerifyOtpResult = { error: string } | { ok: true; redirectTo: string };

export async function verifyLoginOtp(input: z.infer<typeof verifyOtpSchema>): Promise<VerifyOtpResult> {
  const data = verifyOtpSchema.parse(input);

  const payload = await verifyOtpSessionToken(data.otpToken);
  if (!payload) return { error: "This verification session has expired — please start over." };

  const rateLimit = await checkRateLimitWithIp(`otp-verify:${payload.userId}`, 8, 15, 60_000);
  if (!rateLimit.allowed) {
    return { error: `Too many attempts. Try again in ${Math.ceil(rateLimit.retryAfterMs / 1000)}s.` };
  }

  type TxResult = { failed: true; message: string } | { failed: false; role: "CLIENT" | "AGENT" | "ADMIN" | "SUPER_ADMIN"; isStaff: boolean };

  const result: TxResult = await withRls({ tenantId: payload.tenantId, userId: payload.userId }, async (tx) => {
    const otp = await tx.loginOtp.findFirst({
      where: {
        OR: [
          { endUserId: payload.userId },
          { teamMemberId: payload.userId },
        ],
        tenantId: payload.tenantId,
        consumedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: "desc" },
    });
    if (!otp) return { failed: true, message: "This code has expired — request a new invite link." };

    const valid = await bcrypt.compare(data.code, otp.codeHash);
    if (!valid) return { failed: true, message: "Incorrect code. Please try again." };

    await tx.loginOtp.update({ where: { id: otp.id }, data: { consumedAt: new Date() } });

    // Derive role by which subject column the OTP was scoped to.
    const isStaff = !!otp.teamMemberId;
    if (isStaff) {
      const tm = await tx.teamMember.findFirst({
        where: { id: payload.userId, tenantId: payload.tenantId },
        include: { role: { select: { name: true } } },
      });
      if (!tm) return { failed: true, message: "This verification session is no longer valid." };
      return { failed: false, role: wrapperRoleNameToUserRole(tm.role.name), isStaff: true };
    }
    return { failed: false, role: "CLIENT" as const, isStaff: false };
  });

  if (result.failed) return { error: result.message };

  const subjectKind = result.isStaff ? "TEAM_MEMBER" : "END_USER";
  const sessionId = await createUserSession({
    subjectId: payload.userId,
    subjectKind,
    tenantId: payload.tenantId,
  });
  await createSessionCookie({
    subjectId: payload.userId,
    subjectKind,
    tenantId: payload.tenantId,
    sessionId,
  });
  await recordLoginActivity({
    tenantId: payload.tenantId,
    subjectId: payload.userId,
    subjectKind,
  });
  return { ok: true, redirectTo: REDIRECT_BY_ROLE[result.role] };
}
