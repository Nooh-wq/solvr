// src/core/auth/tokens.ts
//
// B3 (Z-post / core-auth) — the runtime JWT surface: two functions for
// the session cookie (sign / verify) and two generic functions for every
// purpose-scoped token (sign / verify). Callers in B6 and B7 will drop
// their direct `jose` imports and consume these instead so:
//
//   1. The `algorithms: ["HS256"]` allow-list is enforced in one place
//      (both verifiers below) — closes the classic `alg: "none"` /
//      alg-confusion attack surface. Support's current code omits the
//      option and relies on jose defaulting to the header's `alg`, which
//      is the pre-hardening default.
//
//   2. The `purpose` claim is required on every purpose-token verify.
//      Support's current per-token verifiers each duplicate the check;
//      centralising it means adding a new purpose (M7 API-key, some
//      future magic-link) can't accidentally ship without the guard.
//
//   3. Per-purpose TTLs live in a single `PURPOSE_TTL_SECONDS` map so
//      a caller can't drift from Support's canonical durations by
//      copy-pasting a wrong constant.
//
// Wire format is byte-identical to src/lib/session.ts's per-token
// `SignJWT(...).setProtectedHeader({ alg: "HS256" }).setIssuedAt().
//  setExpirationTime(...).sign(getSecret())`. Existing in-flight
// tokens continue to verify. See boundary doc §7.16 for the
// analytics_share casing decision.

import { SignJWT, jwtVerify } from "jose";
import { getSecret } from "./secret";
import type {
  DecodedSessionPayload,
  PurposePayloads,
  SessionPayload,
  SubjectKind,
  TokenPurpose,
} from "./types";

/**
 * Canonical TTL per purpose. Values mirror the per-token
 * `*_DURATION_SECONDS` constants in src/lib/session.ts. Overridable
 * via `signPurposeToken(_, _, { ttlSeconds })` for tests or one-off
 * short-lived variants.
 */
export const PURPOSE_TTL_SECONDS: Readonly<Record<TokenPurpose, number>> = {
  session: 60 * 60 * 24 * 7, // 7 days
  impersonation: 60 * 60, // 1 hour
  "password-reset": 60 * 30, // 30 min
  "email-change": 60 * 60 * 24, // 24 hours
  "data-export": 60 * 60 * 72, // 72 hours
  invite: 60 * 60 * 24 * 7, // 7 days
  "otp-verify": 60 * 15, // 15 min
  "tenant-signup": 60 * 15, // 15 min
  csat: 60 * 60 * 24 * 30, // 30 days
  analytics_share: 60 * 60 * 24 * 30, // 30 days
  "mfa-challenge": 60 * 5, // 5 min — carries no session authority, just a
  // "we already checked the password" handoff to the code-verify step
  "mfa-enrollment": 60 * 15, // 15 min — user needs time to install an
  // authenticator app if they don't already have one
};

// ---------------------------------------------------------------------------
// Session cookie — signSessionToken / verifySessionToken
// ---------------------------------------------------------------------------

/**
 * Signs the session JWT that gets set as the `stralis_session` cookie.
 * Wire format matches src/lib/session.ts::signSessionToken byte-for-byte
 * — same claims, same algorithm, same TTL. B6's cutover is a rename.
 */
export async function signSessionToken(payload: SessionPayload): Promise<string> {
  return new SignJWT({
    subjectId: payload.subjectId,
    subjectKind: payload.subjectKind,
    tenantId: payload.tenantId,
    sessionId: payload.sessionId,
    purpose: "session",
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${PURPOSE_TTL_SECONDS.session}s`)
    .sign(getSecret());
}

/**
 * Verifies a session JWT and returns its decoded payload, or `null` on
 * any failure (invalid signature, wrong algorithm, wrong purpose,
 * expired, malformed).
 *
 * Three hardening properties, each a specific attack this closes:
 *
 *   1. `algorithms: ["HS256"]` — restricts the verifier to the exact
 *      algorithm we sign with. Blocks the historical `alg: "none"`
 *      forgery (accepted-because-header-says-so) and the RS256/HS256
 *      confusion where an attacker signs with the public key of an
 *      asymmetric algorithm the verifier accidentally accepts.
 *      Defense-in-depth: jose defaults are already strict, but the
 *      explicit allow-list is what a security review will look for.
 *
 *   2. `purpose === "session"` — a leaked password-reset or CSAT link
 *      token could otherwise be pasted in as a session cookie and log
 *      the attacker in as the token's subject. Kept lenient for
 *      `purpose === undefined` because tokens minted before the claim
 *      existed have no `purpose` (see the corresponding leniency in
 *      Support's verifier, preserved for the Set B grace window).
 *
 *   3. Dual-shape decode (new-shape vs old-shape) — Z1.8a's 7-day
 *      grace period lets pre-Set-B cookies keep their session until
 *      2026-07-14. Grace-period removal tracked in boundary doc
 *      §7.15. Today: 2026-07-09, so still active.
 */
export async function verifySessionToken(
  token: string
): Promise<DecodedSessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret(), {
      algorithms: ["HS256"],
    });

    // Purpose gate — see JSDoc invariant 2.
    if (payload.purpose !== undefined && payload.purpose !== "session") {
      return null;
    }
    if (typeof payload.tenantId !== "string") return null;

    const sessionId =
      typeof payload.sessionId === "string" ? payload.sessionId : undefined;

    // New-shape (Z1.8a onwards) — Set B.
    if (
      typeof payload.subjectId === "string" &&
      typeof payload.subjectKind === "string"
    ) {
      if (
        payload.subjectKind !== "END_USER" &&
        payload.subjectKind !== "TEAM_MEMBER"
      ) {
        return null;
      }
      return {
        subjectId: payload.subjectId,
        subjectKind: payload.subjectKind as SubjectKind,
        tenantId: payload.tenantId,
        sessionId,
        iat: payload.iat,
      };
    }

    // Old-shape grace-period fall-through — legacy `{userId, tenantId}`
    // cookies. Resolved by getSessionUser via wrapper dual-lookup.
    // Removal target: 2026-07-14 (boundary doc §7.15).
    if (typeof payload.userId === "string") {
      return {
        subjectId: payload.userId,
        subjectKind: undefined,
        tenantId: payload.tenantId,
        sessionId,
        iat: payload.iat,
      };
    }

    return null;
  } catch {
    // Signature/algorithm/expiry/malformed — all collapse to null so
    // callers don't need per-branch try/catch. The specific error
    // never carries actionable info for the caller anyway (only
    // "reject this request").
    return null;
  }
}

// ---------------------------------------------------------------------------
// Purpose tokens — signPurposeToken / verifyPurposeToken
// ---------------------------------------------------------------------------

/**
 * Signs a purpose-scoped JWT. The `purpose` claim is set from the
 * `purpose` argument, not from the payload — a caller can't
 * accidentally issue an off-label token by shaping the payload wrong.
 *
 * TTL defaults to `PURPOSE_TTL_SECONDS[purpose]`. Callers can override
 * via `opts.ttlSeconds` — used mostly by tests, but also a legitimate
 * escape hatch (a one-off short-lived preview link, say). No lower/
 * upper bound is enforced; the security review of any override lives
 * at the callsite where the intent is visible.
 */
export async function signPurposeToken<P extends TokenPurpose>(
  purpose: P,
  data: PurposePayloads[P],
  opts?: { ttlSeconds?: number }
): Promise<string> {
  const ttl = opts?.ttlSeconds ?? PURPOSE_TTL_SECONDS[purpose];
  return new SignJWT({ ...(data as Record<string, unknown>), purpose })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${ttl}s`)
    .sign(getSecret());
}

/**
 * Verifies a purpose-scoped JWT and returns its decoded payload, or
 * `null` on any failure. Contract:
 *
 *   - `algorithms: ["HS256"]` — same defense-in-depth allow-list as
 *     `verifySessionToken`. Same reasoning: closes alg-confusion.
 *
 *   - `payload.purpose === expectedPurpose` REQUIRED. Missing claim
 *     or wrong value → null. Closes the "leaked reset-link JWT
 *     posted as an invite token" cross-purpose-confusion attack.
 *     Stricter than `verifySessionToken`'s "missing is OK" leniency
 *     because purpose tokens post-date the claim's introduction —
 *     there's no grace-period concern.
 *
 * Return type is precisely typed via the `PurposePayloads` mapped type
 * from B2: `verifyPurposeToken("csat", ...)` returns
 * `Promise<CsatTokenPayload | null>` with no runtime discriminator
 * check needed at the callsite.
 *
 * Payload-shape validation lives at the callsite for now: this
 * verifier confirms the signature, algorithm, purpose, and expiry,
 * but doesn't per-field-typecheck the payload data. B7's per-callsite
 * migration is a natural place to layer in a zod schema per purpose
 * without complicating the shared verifier.
 */
export async function verifyPurposeToken<P extends TokenPurpose>(
  token: string,
  expectedPurpose: P
): Promise<PurposePayloads[P] | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret(), {
      algorithms: ["HS256"],
    });
    if (payload.purpose !== expectedPurpose) return null;
    // Strip the purpose claim before returning so callers see the
    // clean payload shape defined in B2's PurposePayloads map, not a
    // widened `{ ...data, purpose }` union with a redundant field.
    const { purpose: _purpose, iat: _iat, exp: _exp, ...data } = payload;
    return { ...data, iat: payload.iat } as unknown as PurposePayloads[P];
  } catch {
    return null;
  }
}
