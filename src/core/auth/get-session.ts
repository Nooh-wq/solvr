// src/core/auth/get-session.ts
//
// B5 (Z-post / core-auth) — the server-side companion to
// src/middleware.ts's cookie verification. Reads the JWT the
// middleware forwarded on the request, re-verifies it (belt and
// braces), and returns a SessionContext ready to thread into
// withSessionContext (B4).
//
// ### Why the double-verify
//
// Middleware runs at the edge/proxy layer; downstream Server
// Components / Route Handlers / Server Actions run separately.
// Trusting the middleware's decision alone means one of two failure
// modes lets a forged cookie through:
//
//   1. **Configuration**: the matcher config missed a route, so
//      middleware never ran for the request. The handler still
//      receives the cookie and, without re-verify, blindly trusts it.
//
//   2. **Bypass**: an attacker with direct network access to the
//      Node handler (misconfigured reverse proxy, container escape
//      from a co-tenant) crafts a request without the middleware
//      layer in the path.
//
// The `x-stralis-session-verified: 1` marker is what tells us the
// middleware DID run. Verifying the JWT ourselves closes both holes
// — if middleware skipped the route, we still catch a forged
// cookie. If middleware ran, the marker tells us we're on the
// happy path.
//
// The unverified-but-JWT-present case (JWT header without the "1"
// marker) is a specific attack signal or misconfiguration — the
// JSDoc on `getSessionContext` covers the branch.

import type { SessionContext } from "./types";
import { verifySessionToken } from "./tokens";

/** Header name middleware writes the raw session JWT to. */
export const SESSION_JWT_HEADER = "x-stralis-session-jwt";
/** Header name middleware sets to "1" after a successful cookie verify. */
export const SESSION_VERIFIED_HEADER = "x-stralis-session-verified";

/**
 * The minimum shape we need to read forwarded headers. Structurally
 * satisfied by NextRequest, plain Request, or any manual mock.
 */
export type HeadersLike = { headers: Pick<Headers, "get"> };

/**
 * Resolves the current request's SessionContext by re-verifying the
 * JWT that `src/middleware.ts` forwarded on `x-stralis-session-jwt`.
 * Returns `null` for unauthenticated requests and for any verify
 * failure (invalid signature, wrong alg, expired, malformed,
 * cross-purpose).
 *
 * ### Role hydration
 * The session cookie carries `subjectId` + `subjectKind` + `tenantId`
 * — it does NOT carry role. Role comes from the wrapper's Role table
 * via the `mapRoleNameToRlsRole` mapper (B1). This function therefore
 * returns a context with `role: ""` — the "not yet resolved" value
 * from B2's `RlsRole` union — and callers hydrate before running any
 * RLS-scoped query.
 *
 * The `""` role is fail-closed under RLS: policies of the form
 * `app_current_role() = 'SUPER_ADMIN'` evaluate to NULL against a
 * nullif()-collapsed empty string → treated as false → row excluded.
 * A caller that forgets to hydrate sees zero rows rather than
 * accidentally over-permitting — matches Phase A's grep-verified
 * safety net.
 *
 * ### Verification bypass warning
 * If the JWT header is present without the `x-stralis-session-verified: 1`
 * marker, one of two things happened:
 *   - Middleware wasn't deployed to this route (matcher misconfigured).
 *   - Someone bypassed edge middleware and hit the handler directly with
 *     a forged cookie.
 * Either way, we still re-verify — if the JWT is valid, the call
 * succeeds. But we log a warning so the signal is visible. Never a
 * silent branch.
 */
export async function getSessionContext(
  request: HeadersLike
): Promise<SessionContext | null> {
  const jwt = request.headers.get(SESSION_JWT_HEADER);
  if (!jwt) return null;

  const verifiedMarker = request.headers.get(SESSION_VERIFIED_HEADER);
  if (verifiedMarker !== "1") {
    // See JSDoc "Verification bypass warning". Fall through to the
    // real verify below — we still trust our own JWT check.
    // eslint-disable-next-line no-console
    console.warn(
      "[core-auth] session JWT header present without verification marker — middleware misconfiguration or bypass attempt"
    );
  }

  const decoded = await verifySessionToken(jwt);
  if (!decoded) return null;
  // subjectKind is undefined for old-shape (Z1.8a grace-period) cookies.
  // Those are rejected here rather than downstream in the wrapper — the
  // core-auth boundary requires a fully-typed actor.kind. Legacy
  // resolution stays in src/lib/auth.ts::getSessionUser until §7.15
  // removal (2026-07-14), which is the natural end of that path.
  if (decoded.subjectKind === undefined) return null;

  return {
    tenantId: decoded.tenantId,
    actor: { kind: decoded.subjectKind, id: decoded.subjectId },
    role: "", // unresolved — see JSDoc "Role hydration"
    sessionId: decoded.sessionId,
  };
}
