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
import { passwordSchema } from "@/lib/validation/password";
import {
  sendRegistrationPendingEmail,
  sendRegistrationApprovedEmail,
  sendNewRegistrationAdminNotice,
  sendPasswordResetEmail,
  sendLoginOtpEmail,
} from "@/lib/email/events";
import { notify } from "@/lib/notifications";
import { REDIRECT_BY_ROLE } from "@/lib/redirect-by-role";

function siteUrl() {
  return process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
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
 * approval queue or the domain-auto-approval check (verifyRegistrationOtp
 * does both of those, step 2). Mirrors the invite flow's two-step shape
 * (acceptInvite -> verifyLoginOtp) and reuses the same LoginOtp/OTP-session-
 * token infrastructure.
 */
export async function registerClient(input: z.infer<typeof registerSchema>): Promise<RegisterResult> {
  // safeParse (not .parse) so a password-complexity failure surfaces its
  // specific message — a thrown error from a Server Action gets redacted by
  // Next.js in production (see inviteUser()'s comment in actions/admin.ts).
  const parsed = registerSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const data = parsed.data;

  const tenant = await getCurrentTenant();

  const rateLimit = await checkRateLimitWithIp(`register:${tenant.id}`, 20, 10, 60_000);
  if (!rateLimit.allowed) return { error: "Too many registration attempts. Try again shortly." };

  const passwordHash = await bcrypt.hash(data.password, 10);

  type TxResult = { failed: true; message: string } | { failed: false; userId: string; email: string; code: string; branding: Awaited<ReturnType<typeof getCurrentTenant>>["branding"] };

  // No session yet — establish RLS scope from the resolved host tenant alone
  // (same pattern as getSessionUser(); see src/lib/auth.ts).
  const result: TxResult = await withRls({ tenantId: tenant.id, userId: null }, async (tx) => {
    const existing = await tx.user.findUnique({
      where: { tenantId_email: { tenantId: tenant.id, email: data.email } },
    });
    if (existing) return { failed: true, message: "An account with this email already exists." };

    const user = await tx.user.create({
      data: {
        tenantId: tenant.id,
        passwordHash,
        name: data.name,
        email: data.email,
        company: data.company,
        role: "CLIENT",
        status: "UNVERIFIED",
      },
    });

    // login_otp_insert's RLS policy requires app.user_id to match the row's
    // userId — this transaction started with userId: null (no session exists
    // yet, unlike acceptInvite() which already has a real invited userId from
    // the token), so it has to be updated to the just-created user's id
    // before inserting their OTP row, the same way withRls() itself sets it
    // at the start of a transaction.
    await tx.$executeRaw`SELECT set_config('app.user_id', ${user.id}, true)`;

    // The plaintext code only ever exists transiently in this closure — never
    // stored, only its bcrypt hash is (verifyRegistrationOtp compares against that).
    const code = generateOtpCode();
    const codeHash = await bcrypt.hash(code, 10);
    await tx.loginOtp.create({
      data: { tenantId: tenant.id, userId: user.id, codeHash, expiresAt: new Date(Date.now() + OTP_DURATION_MS) },
    });

    const branding = await tx.tenantBranding.findUnique({ where: { tenantId: tenant.id } });
    return { failed: false, userId: user.id, email: user.email, code, branding };
  });

  if (result.failed) return { error: result.message };

  await sendLoginOtpEmail(result.email, result.code, result.branding);

  const otpToken = await signOtpSessionToken({ userId: result.userId, tenantId: tenant.id });
  return { ok: true, otpToken };
}

type VerifyRegistrationOtpResult = { error: string } | { ok: true; redirectTo: string } | { ok: true; pending: true };

/**
 * Step 2 of registration: verifies the emailed code, then applies the same
 * approval-gate logic registerClient() used to apply immediately (email
 * flow design §"Registration Approval Gate") — auto-approve if the email's
 * domain already has an ACTIVE user in this tenant (same company, already
 * trusted once), otherwise PENDING until an admin of *this* tenant approves
 * (never Stralis on a client tenant's behalf). Auto-approved users are logged
 * straight in, same as verifyLoginOtp() does for an accepted invite.
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
        role: string;
        name: string;
        company: string | null;
        admins: { id: string; email: string }[];
        branding: Awaited<ReturnType<typeof getCurrentTenant>>["branding"];
      };

  const result: TxResult = await withRls({ tenantId: payload.tenantId, userId: payload.userId }, async (tx) => {
    const otp = await tx.loginOtp.findFirst({
      where: { userId: payload.userId, tenantId: payload.tenantId, consumedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
    });
    if (!otp) return { failed: true, message: "This code has expired — please register again." };

    const valid = await bcrypt.compare(data.code, otp.codeHash);
    if (!valid) return { failed: true, message: "Incorrect code. Please try again." };

    const user = await tx.user.findFirst({ where: { id: payload.userId, tenantId: payload.tenantId, status: "UNVERIFIED" } });
    if (!user) return { failed: true, message: "This registration is no longer valid — please register again." };

    await tx.loginOtp.update({ where: { id: otp.id }, data: { consumedAt: new Date() } });

    const domain = user.email.split("@")[1]?.toLowerCase();
    const domainApproved = domain
      ? await tx.user.findFirst({
          where: { tenantId: payload.tenantId, status: "ACTIVE", email: { endsWith: `@${domain}`, mode: "insensitive" } },
        })
      : null;

    const updated = await tx.user.update({ where: { id: user.id }, data: { status: domainApproved ? "ACTIVE" : "PENDING" } });

    const admins = domainApproved
      ? []
      : await tx.user.findMany({ where: { tenantId: payload.tenantId, role: { in: ["ADMIN", "SUPER_ADMIN"] }, status: "ACTIVE" } });

    if (admins.length > 0) {
      await notify(
        tx,
        ...admins.map((a) => ({
          tenantId: payload.tenantId,
          userId: a.id,
          type: "REGISTRATION_PENDING" as const,
          title: `New registration awaiting approval: ${updated.name}`,
          body: updated.email,
        }))
      );
    }

    const branding = await tx.tenantBranding.findUnique({ where: { tenantId: payload.tenantId } });
    return {
      failed: false,
      autoApproved: Boolean(domainApproved),
      email: updated.email,
      role: updated.role,
      name: updated.name,
      company: updated.company,
      admins,
      branding,
    };
  });

  if (result.failed) return { error: result.message };

  if (result.autoApproved) {
    await sendRegistrationApprovedEmail(result.email, result.branding);
    await createSessionCookie({ userId: payload.userId, tenantId: payload.tenantId });
    return { ok: true, redirectTo: REDIRECT_BY_ROLE[result.role] };
  }

  await sendRegistrationPendingEmail(result.email, result.branding);
  await Promise.all(
    result.admins.map((a) => sendNewRegistrationAdminNotice(a.email, { name: result.name, email: result.email, company: result.company }, result.branding))
  );
  return { ok: true, pending: true };
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
  if (dbUser.status === "UNVERIFIED") return { error: "Please verify your email first — check your inbox for the code, or register again to get a new one." };
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
  newPassword: passwordSchema,
});

type ConfirmPasswordResetResult = { error: string } | { ok: true; redirectTo: string };

/** Consumes a password-reset link token: validates it, sets the new password, and logs the user in. Single-use via passwordChangedAt (see session.ts's comment on signPasswordResetToken). */
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
  password: passwordSchema,
});

type AcceptInviteResult = { error: string } | { ok: true; otpToken: string };

/** Step 1: consumes the emailed invite link, sets the invitee's own password, and emails a one-time code for step 2 (verifyLoginOtp). */
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
