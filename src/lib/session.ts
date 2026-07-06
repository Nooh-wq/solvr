import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import type { NextRequest } from "next/server";

const COOKIE_NAME = "stralis_session";
const IMPERSONATION_COOKIE_NAME = "stralis_impersonation";
const SESSION_DURATION_SECONDS = 60 * 60 * 24 * 7; // 7 days
const IMPERSONATION_DURATION_SECONDS = 60 * 60; // 1 hour — impersonation sessions are short-lived on purpose

// The dev placeholder shipped in the repo's .env. If this ever reaches a
// production deploy, anyone who's read the repo can forge session cookies —
// so refuse to boot with it (or with a too-short secret) when NODE_ENV is
// production. In dev it's allowed so `npm run dev` works out of the box.
const DEV_PLACEHOLDER_SECRET = "dev-only-secret-change-before-any-real-deployment-7f3a9c2e";

function getSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is not set");
  if (process.env.NODE_ENV === "production") {
    if (secret === DEV_PLACEHOLDER_SECRET) {
      throw new Error("SESSION_SECRET is still the dev placeholder — set a strong, unique secret before deploying.");
    }
    if (secret.length < 32) {
      throw new Error("SESSION_SECRET is too short for production — use at least 32 random characters.");
    }
  }
  return new TextEncoder().encode(secret);
}

export type SessionPayload = {
  userId: string;
  tenantId: string;
  /** JWT issued-at (seconds since epoch). Used to invalidate sessions issued before a password change — see getSessionUser(). */
  iat?: number;
};

export async function signSessionToken(payload: SessionPayload): Promise<string> {
  return new SignJWT({ ...payload, purpose: "session" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DURATION_SECONDS}s`)
    .sign(getSecret());
}

export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    if (typeof payload.userId !== "string" || typeof payload.tenantId !== "string") return null;
    // Session and password-reset tokens share the same {userId, tenantId}
    // shape — without this check, a leaked reset-link token could be pasted
    // in as a session cookie value and log the attacker in directly, without
    // ever needing to know (or reset) the password. Tokens signed before this
    // check existed have no `purpose` claim at all, so those still verify.
    if (payload.purpose !== undefined && payload.purpose !== "session") return null;
    return { userId: payload.userId, tenantId: payload.tenantId, iat: payload.iat };
  } catch {
    return null;
  }
}

/** Sets the session cookie. Call from a Server Action only (cookies() is writable there). */
export async function createSessionCookie(payload: SessionPayload) {
  const token = await signSessionToken(payload);
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DURATION_SECONDS,
  });
}

export async function destroySessionCookie() {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
}

/** Reads + verifies the session from a Server Component / Server Action context. */
export async function getSessionPayload(): Promise<SessionPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}

/** Edge-safe read for middleware, which can't use next/headers' cookies(). */
export async function getSessionPayloadFromRequest(request: NextRequest): Promise<SessionPayload | null> {
  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}

export const SESSION_COOKIE_NAME = COOKIE_NAME;

// ---------------------------------------------------------------------------
// Impersonation (TRD §5.4 "Impersonation (audited)") — a second, separate
// cookie layered on top of the real session. The real session cookie is
// never overwritten, so "stop impersonating" always has a clean identity to
// fall back to. See src/lib/auth.ts's getSessionUser() for how this overrides
// the effective tenantId/role app-wide, and src/actions/super.ts for the
// audit-logged start/stop actions.
// ---------------------------------------------------------------------------

export type ImpersonationPayload = {
  impersonatorUserId: string;
  targetTenantId: string;
};

async function signImpersonationToken(payload: ImpersonationPayload): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${IMPERSONATION_DURATION_SECONDS}s`)
    .sign(getSecret());
}

async function verifyImpersonationToken(token: string): Promise<ImpersonationPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    if (typeof payload.impersonatorUserId !== "string" || typeof payload.targetTenantId !== "string") return null;
    return { impersonatorUserId: payload.impersonatorUserId, targetTenantId: payload.targetTenantId };
  } catch {
    return null;
  }
}

export async function createImpersonationCookie(payload: ImpersonationPayload) {
  const token = await signImpersonationToken(payload);
  const cookieStore = await cookies();
  cookieStore.set(IMPERSONATION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: IMPERSONATION_DURATION_SECONDS,
  });
}

export async function destroyImpersonationCookie() {
  const cookieStore = await cookies();
  cookieStore.delete(IMPERSONATION_COOKIE_NAME);
}

export async function getImpersonationPayload(): Promise<ImpersonationPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(IMPERSONATION_COOKIE_NAME)?.value;
  if (!token) return null;
  return verifyImpersonationToken(token);
}

// ---------------------------------------------------------------------------
// Password reset — a short-lived, single-use link token (not a cookie). Emailed
// as `${siteUrl}/auth/reset/confirm?token=...`; see actions/auth.ts's
// requestPasswordReset()/confirmPasswordReset().
//
// "Single-use" is enforced without a database token table: confirmPasswordReset
// sets User.passwordChangedAt = now() when it succeeds, and getSessionUser()
// already rejects any JWT (session OR reset) whose `iat` predates
// passwordChangedAt. So the moment one reset link is used, that same
// (still-unexpired) token — and any other outstanding reset link for that
// user, since all of them predate the change — is rejected on the next
// attempt. See confirmPasswordReset() for the explicit check.
// ---------------------------------------------------------------------------

const PASSWORD_RESET_DURATION_SECONDS = 60 * 30; // 30 minutes

export type PasswordResetTokenPayload = {
  userId: string;
  tenantId: string;
  iat?: number;
};

export async function signPasswordResetToken(payload: { userId: string; tenantId: string }): Promise<string> {
  return new SignJWT({ ...payload, purpose: "password-reset" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${PASSWORD_RESET_DURATION_SECONDS}s`)
    .sign(getSecret());
}

export async function verifyPasswordResetToken(token: string): Promise<PasswordResetTokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    if (payload.purpose !== "password-reset") return null;
    if (typeof payload.userId !== "string" || typeof payload.tenantId !== "string") return null;
    return { userId: payload.userId, tenantId: payload.tenantId, iat: payload.iat };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Invite accept + first-login OTP (Team > Invite — see actions/admin.ts's
// inviteUser() / actions/auth.ts's acceptInvite()/verifyLoginOtp()).
//
// Two short-lived stateless JWTs chain the flow together without ever
// needing a real session cookie until the very end:
//   invite token (7 days, emailed)      -> acceptInvite() verifies it, sets
//                                          the user's own password, mints...
//   otp-verify token (15 min, in-memory) -> ...which the client holds while
//                                          entering the emailed code;
//                                          verifyLoginOtp() checks it against
//                                          LoginOtp (the one piece of actual
//                                          server-side state in this flow,
//                                          since a code has to be matched
//                                          against a value already sent out,
//                                          unlike a signature-verified JWT)
//                                          and only THEN creates the real
//                                          session cookie.
// ---------------------------------------------------------------------------

const INVITE_DURATION_SECONDS = 60 * 60 * 24 * 7; // 7 days — same reasoning as a session's own lifetime
const OTP_SESSION_DURATION_SECONDS = 60 * 15; // 15 minutes to read the email and type in the code

export type InviteTokenPayload = { userId: string; tenantId: string };

export async function signInviteToken(payload: InviteTokenPayload): Promise<string> {
  return new SignJWT({ ...payload, purpose: "invite" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${INVITE_DURATION_SECONDS}s`)
    .sign(getSecret());
}

export async function verifyInviteToken(token: string): Promise<InviteTokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    if (payload.purpose !== "invite") return null;
    if (typeof payload.userId !== "string" || typeof payload.tenantId !== "string") return null;
    return { userId: payload.userId, tenantId: payload.tenantId };
  } catch {
    return null;
  }
}

export type OtpSessionTokenPayload = { userId: string; tenantId: string };

export async function signOtpSessionToken(payload: OtpSessionTokenPayload): Promise<string> {
  return new SignJWT({ ...payload, purpose: "otp-verify" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${OTP_SESSION_DURATION_SECONDS}s`)
    .sign(getSecret());
}

export async function verifyOtpSessionToken(token: string): Promise<OtpSessionTokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    if (payload.purpose !== "otp-verify") return null;
    if (typeof payload.userId !== "string" || typeof payload.tenantId !== "string") return null;
    return { userId: payload.userId, tenantId: payload.tenantId };
  } catch {
    return null;
  }
}

// Tenant signup (Zendesk-style — anyone can register a new workspace).
// Distinct from OtpSessionToken above because tenant + user rows are
// deliberately NOT created until the OTP is verified: creating them
// upfront would leave orphan Tenants (with reserved slugs blocking future
// signups) every time someone drops off after the form. Instead the
// entire signup payload is carried in the JWT — signed by us, opaque to
// the client, only redeemable together with the emailed code.
export type TenantSignupTokenPayload = {
  tenantName: string;
  slug: string;
  adminName: string;
  adminEmail: string;
  // Already bcrypt-hashed by the caller (we never sign the plaintext).
  passwordHash: string;
  // bcrypt hash of the 6-digit OTP code. Kept in the JWT rather than a
  // LoginOtp row so verification is stateless (no user exists yet).
  codeHash: string;
};

export async function signTenantSignupToken(payload: TenantSignupTokenPayload): Promise<string> {
  return new SignJWT({ ...payload, purpose: "tenant-signup" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${OTP_SESSION_DURATION_SECONDS}s`)
    .sign(getSecret());
}

export async function verifyTenantSignupToken(token: string): Promise<TenantSignupTokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    if (payload.purpose !== "tenant-signup") return null;
    if (
      typeof payload.tenantName !== "string" ||
      typeof payload.slug !== "string" ||
      typeof payload.adminName !== "string" ||
      typeof payload.adminEmail !== "string" ||
      typeof payload.passwordHash !== "string" ||
      typeof payload.codeHash !== "string"
    ) {
      return null;
    }
    return {
      tenantName: payload.tenantName,
      slug: payload.slug,
      adminName: payload.adminName,
      adminEmail: payload.adminEmail,
      passwordHash: payload.passwordHash,
      codeHash: payload.codeHash,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// CSAT rating link (actions/csat.ts's submitCsatRating(), emailed from
// updateTicket() the moment a ticket is newly marked Resolved). Long-lived
// and effectively single-purpose rather than single-use: resubmitting the
// same link just overwrites the one SurveyResponse row for that ticket
// (unique on ticketId), so there's no server-side revocation state to track
// like the guest-ticket-access token hash — a plain signed JWT is enough.
// ---------------------------------------------------------------------------

const CSAT_DURATION_SECONDS = 60 * 60 * 24 * 30; // 30 days — low-stakes, no reason to be stingy

export type CsatTokenPayload = { ticketId: string; tenantId: string };

export async function signCsatToken(payload: CsatTokenPayload): Promise<string> {
  return new SignJWT({ ...payload, purpose: "csat" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${CSAT_DURATION_SECONDS}s`)
    .sign(getSecret());
}

export async function verifyCsatToken(token: string): Promise<CsatTokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    if (payload.purpose !== "csat") return null;
    if (typeof payload.ticketId !== "string" || typeof payload.tenantId !== "string") return null;
    return { ticketId: payload.ticketId, tenantId: payload.tenantId };
  } catch {
    return null;
  }
}
