// src/lib/session.ts
//
// B6.1 (Z-post / core-auth migration) — Support-side session module.
// Post-B6.1 this file is a **thin adapter** over `src/core/auth/*`:
//   - Types re-export from `@/core/auth/types`.
//   - Session sign/verify re-export from `@/core/auth/tokens`.
//   - Purpose-token sign/verify are one-line wrappers over core's
//     generic `signPurposeToken<P>` / `verifyPurposeToken<P>`.
//   - Cookie R/W (write cookie, read cookie by key) stays here — cross-app
//     cookie-domain policy is deferred to §7.19 (future work), so the
//     cookie layer remains Support-owned.
//
// Callers of this module keep working unchanged. B7's per-surface sweep
// then migrates callers off `@/lib/session` directly onto
// `@/core/auth/*` at their own pace.
//
// Sequencing decisions preserved here:
//   - Impersonation-verify runs a **grace-period wrapper** that accepts
//     both `purpose === undefined` (legacy tokens signed before B6.1)
//     and `purpose === "impersonation"` (post-B6.1 tokens). Removal
//     target: deploy timestamp + 24 hours. See boundary doc §7.17.
//   - `SESSION_DURATION_SECONDS` re-exports from
//     `PURPOSE_TTL_SECONDS.session` (single source of truth, per D-1.b).

import { jwtVerify } from "jose";
import { cookies } from "next/headers";
import type { NextRequest } from "next/server";

import {
  signSessionToken as coreSignSessionToken,
  verifySessionToken as coreVerifySessionToken,
  signPurposeToken,
  verifyPurposeToken,
  PURPOSE_TTL_SECONDS,
} from "@/core/auth/tokens";
import { getSecret } from "@/core/auth/secret";

// ---------------------------------------------------------------------------
// Types — re-export from core (A)
// ---------------------------------------------------------------------------
export type {
  SubjectKind,
  SessionPayload,
  DecodedSessionPayload,
  ImpersonationPayload,
  PasswordResetTokenPayload,
  EmailChangeTokenPayload,
  DataExportTokenPayload,
  InviteTokenPayload,
  OtpSessionTokenPayload,
  TenantSignupTokenPayload,
  CsatTokenPayload,
  AnalyticsShareTokenPayload,
} from "@/core/auth/types";

import type {
  SessionPayload,
  ImpersonationPayload,
  PasswordResetTokenPayload,
  EmailChangeTokenPayload,
  DataExportTokenPayload,
  InviteTokenPayload,
  OtpSessionTokenPayload,
  TenantSignupTokenPayload,
  CsatTokenPayload,
  AnalyticsShareTokenPayload,
} from "@/core/auth/types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const COOKIE_NAME = "stralis_session";
const IMPERSONATION_COOKIE_NAME = "stralis_impersonation";

/**
 * Session cookie lifetime. D-1.b: re-export from core so there's a
 * single source of truth (`PURPOSE_TTL_SECONDS.session`). Callers
 * (notably `src/lib/user-session.ts` for the UserSession row's
 * expiresAt) continue to import from here — B7 will migrate those
 * callers to core directly if we want to.
 */
export const SESSION_DURATION_SECONDS = PURPOSE_TTL_SECONDS.session;

/** Impersonation cookie lifetime — 1 hour, short-lived on purpose. */
const IMPERSONATION_DURATION_SECONDS = PURPOSE_TTL_SECONDS.impersonation;

// ---------------------------------------------------------------------------
// Session sign/verify — re-export from core (A)
// ---------------------------------------------------------------------------
export { signSessionToken, verifySessionToken } from "@/core/auth/tokens";

// ---------------------------------------------------------------------------
// Session cookie R/W (C — cookie halves stay in Support)
// ---------------------------------------------------------------------------

/**
 * Sets the session cookie. Call from a Server Action only (cookies() is
 * writable there).
 *
 * `sessionId` must be an existing UserSession row (see
 * @/lib/user-session's createUserSession — kept in a separate module so
 * middleware's Edge runtime doesn't try to import Prisma).
 */
export async function createSessionCookie(payload: SessionPayload) {
  const token = await coreSignSessionToken(payload);
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
export async function getSessionPayload() {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;
  return coreVerifySessionToken(token);
}

/** Edge-safe read for middleware, which can't use next/headers' cookies(). */
export async function getSessionPayloadFromRequest(request: NextRequest) {
  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (!token) return null;
  return coreVerifySessionToken(token);
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

/**
 * Grace-period impersonation-verify. B6.1 tightens the sign side to
 * always emit `purpose === "impersonation"` (via core's
 * `signPurposeToken`), but Support kept issuing pre-claim tokens up
 * to the moment of deploy. For 1× impersonation TTL (1 hour) after
 * deploy, legacy tokens still show up on the wire — accepting both
 * shapes keeps them working.
 *
 * Alg allow-list stays `["HS256"]` and every other verify check is
 * strict; only the purpose claim is loosened.
 *
 * Removal target: deploy timestamp + 24 hours (24× the TTL — no
 * in-flight legacy tokens possible). Boundary doc §7.17 tracks the
 * follow-up commit.
 */
/** @internal — exported only so B6.1's grace-period tests can exercise it
 * without mocking next/headers's non-configurable cookies() export.
 * Not part of Support's public API surface. */
export async function _verifyImpersonationTokenGrace(
  token: string
): Promise<ImpersonationPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret(), {
      algorithms: ["HS256"],
    });
    // Loosened purpose gate — see JSDoc / §7.17.
    if (
      payload.purpose !== undefined &&
      payload.purpose !== "impersonation"
    ) {
      return null;
    }
    if (
      typeof payload.impersonatorUserId !== "string" ||
      typeof payload.targetTenantId !== "string"
    ) {
      return null;
    }
    return {
      impersonatorUserId: payload.impersonatorUserId,
      targetTenantId: payload.targetTenantId,
    };
  } catch {
    return null;
  }
}

export async function createImpersonationCookie(payload: ImpersonationPayload) {
  // Post-B6.1: always emits purpose="impersonation" via core.
  // signImpersonationToken (Support-internal, never set a claim) is
  // gone.
  const token = await signPurposeToken("impersonation", payload);
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

export async function getImpersonationPayload() {
  const cookieStore = await cookies();
  const token = cookieStore.get(IMPERSONATION_COOKIE_NAME)?.value;
  if (!token) return null;
  return _verifyImpersonationTokenGrace(token);
}

// ---------------------------------------------------------------------------
// Purpose tokens — thin wrappers over core's generic sign/verify (A)
// ---------------------------------------------------------------------------

// Password reset — 30-minute link. Single-use enforced downstream via
// User.passwordChangedAt (see actions/auth.ts confirmPasswordReset).
export async function signPasswordResetToken(payload: {
  userId: string;
  tenantId: string;
}): Promise<string> {
  return signPurposeToken("password-reset", payload);
}
export async function verifyPasswordResetToken(
  token: string
): Promise<PasswordResetTokenPayload | null> {
  return verifyPurposeToken(token, "password-reset");
}

// Email-change confirmation — 24h link. Single-use via AuthCredential.pendingEmail.
export async function signEmailChangeToken(payload: {
  userId: string;
  tenantId: string;
  newEmail: string;
}): Promise<string> {
  return signPurposeToken("email-change", payload);
}
export async function verifyEmailChangeToken(
  token: string
): Promise<EmailChangeTokenPayload | null> {
  return verifyPurposeToken(token, "email-change");
}

// Data-export download — 72h link.
export async function signDataExportToken(
  payload: DataExportTokenPayload
): Promise<string> {
  return signPurposeToken("data-export", payload);
}
export async function verifyDataExportToken(
  token: string
): Promise<DataExportTokenPayload | null> {
  return verifyPurposeToken(token, "data-export");
}

// Invite accept — 7-day emailed link.
export async function signInviteToken(
  payload: InviteTokenPayload
): Promise<string> {
  return signPurposeToken("invite", payload);
}
export async function verifyInviteToken(
  token: string
): Promise<InviteTokenPayload | null> {
  return verifyPurposeToken(token, "invite");
}

// OTP-verify wrapper — 15 min. Carries identity between password-set and OTP entry.
export async function signOtpSessionToken(
  payload: OtpSessionTokenPayload
): Promise<string> {
  return signPurposeToken("otp-verify", payload);
}
export async function verifyOtpSessionToken(
  token: string
): Promise<OtpSessionTokenPayload | null> {
  return verifyPurposeToken(token, "otp-verify");
}

// Tenant self-signup — 15 min. Carries the full signup payload so
// no Tenant/User rows exist until OTP verification succeeds.
export async function signTenantSignupToken(
  payload: TenantSignupTokenPayload
): Promise<string> {
  return signPurposeToken("tenant-signup", payload);
}
export async function verifyTenantSignupToken(
  token: string
): Promise<TenantSignupTokenPayload | null> {
  return verifyPurposeToken(token, "tenant-signup");
}

// CSAT rating link — 30 days. Resubmission overwrites the one
// SurveyResponse row per ticketId.
export async function signCsatToken(payload: CsatTokenPayload): Promise<string> {
  return signPurposeToken("csat", payload);
}
export async function verifyCsatToken(
  token: string
): Promise<CsatTokenPayload | null> {
  return verifyPurposeToken(token, "csat");
}

// M13 gap 2 — read-only analytics share tokens. 30 days.
// Casing note: `analytics_share` uses snake_case where every other
// purpose uses kebab-case. Preserved verbatim to avoid invalidating
// live share links. See boundary doc §7.16.
export async function signAnalyticsShareToken(
  payload: AnalyticsShareTokenPayload
): Promise<string> {
  return signPurposeToken("analytics_share", payload);
}
export async function verifyAnalyticsShareToken(
  token: string
): Promise<AnalyticsShareTokenPayload | null> {
  return verifyPurposeToken(token, "analytics_share");
}
