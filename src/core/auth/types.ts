// src/core/auth/types.ts
//
// B2 (Z-post / core-auth) — the type surface for `src/core/auth`.
// Pure types; zero runtime code and zero non-type imports.
//
// Types live in their own file so any consumer that only needs a shape
// (Prisma layer, action-layer helpers, Support-side platform code, the
// coming API-key layer, RSC boundaries) can `import type { ... }` from
// here without pulling in jose, next/headers, or the whole runtime
// verifier chain. Same discipline as Z1.8: a Set B split where the
// runtime module (`tokens.ts`, `adapter.ts` — B3 and B4) never re-exports
// from a barrel that would drag in Prisma or Edge-unsafe deps.
//
// Prior art / mirrored shapes:
//   - SessionPayload / DecodedSessionPayload: src/lib/session.ts (Z1.8a
//     Set B). Kept byte-identical here — B6 will migrate the runtime
//     to consume from this file; nothing changes about the JWT wire
//     format.
//   - ImpersonationPayload: src/lib/session.ts §5.4. Shipped verbatim
//     per the Phase A tightening decision — `startedAt` filed as a
//     future compliance-surface item, not added here.
//   - Purpose-token payloads: mirrored from Support's per-token
//     Payload types in src/lib/session.ts. Kept in a single mapped
//     type (PurposePayloads) so a new purpose can only be added by
//     touching both the union and the payload map — TypeScript blocks
//     drift.

// ---------------------------------------------------------------------------
// RLS roles + actor kinds
// ---------------------------------------------------------------------------

/**
 * The value the app_runtime session writes to the `app.role` Postgres GUC,
 * consumed by every RLS policy via `app_current_role()` in
 * prisma/rls_policies.sql. Six-way union:
 *   - CLIENT / AGENT / ADMIN / SUPER_ADMIN — staff+end-user tiers used by
 *     the app-layer permission checks AND the SQL policies.
 *   - GUEST                                — bound to a single ticket via
 *     `app.guest_ticket_id`; excluded from every tenant-wide clause on
 *     purpose.
 *   - ""                                    — the "no role established
 *     yet" state. `app_current_role()` uses `nullif(..., '')` (see
 *     prisma/rls_policies.sql:33), so empty string and "unset" are
 *     behaviourally identical: policies of the form
 *     `app_current_role() = 'SUPER_ADMIN'` evaluate to NULL → treated as
 *     false by RLS → row excluded. Formalising "" as a value here
 *     documents that "not yet resolved" is a legitimate on-the-wire
 *     state, not a bug.
 */
export type RlsRole = "CLIENT" | "AGENT" | "ADMIN" | "SUPER_ADMIN" | "GUEST" | "";

/**
 * The identity kind behind a session. Distinct from RlsRole because the
 * identity ("who is this") and the RLS tier ("what may they see")
 * evolve independently — an impersonating SUPER_ADMIN is still a
 * TEAM_MEMBER identity, and a SYSTEM caller (Inngest cron, seed script)
 * may run at any RLS tier depending on the job it's driving.
 */
export type ActorKind = "TEAM_MEMBER" | "END_USER" | "GUEST" | "SYSTEM";

/** An identified subject at the auth boundary. */
export type Actor = { kind: ActorKind; id: string };

// ---------------------------------------------------------------------------
// SessionContext — the discriminated union
// ---------------------------------------------------------------------------

/**
 * The auth context a request runs under. Constructed at the middleware
 * boundary and threaded through to the `withRls` adapter (B4).
 *
 * Discriminated on `role` (not `actor.kind`) because `role` is what the
 * RLS layer sees and what most callers branch on. Two variants:
 *
 * ### GUEST variant
 *   - `role: "GUEST"`, `actor.kind: "GUEST"`, `guestTicketId: string`
 *     REQUIRED.
 *   - `guestTicketId` is required because the `tickets` /
 *     `ticket_guests` / `messages` RLS policies (prisma/rls_policies.sql
 *     §guest-scope) bind visibility to
 *     `id = app_current_guest_ticket_id()` — with no ticket id, a guest
 *     session can see nothing at all. Making the field required at the
 *     type level prevents the "guest session accidentally constructed
 *     without a ticket binding" bug at compile time, before the request
 *     ever reaches the DB.
 *
 * ### Non-GUEST variant
 *   - `role: "CLIENT" | "AGENT" | "ADMIN" | "SUPER_ADMIN" | ""`,
 *     `actor.kind: "TEAM_MEMBER" | "END_USER" | "SYSTEM"`,
 *     `guestTicketId: never`.
 *   - Forbidding `guestTicketId` on non-GUEST variants prevents the
 *     inverse bug: a staff or client session accidentally carrying a
 *     ticket binding that could (if a future policy is misauthored)
 *     narrow their visibility to a single ticket. Guest-scoped state
 *     stays on guest-scoped sessions — enforced at compile time.
 *
 * `sessionId` is the UserSession row id (M21.3); undefined for
 * SYSTEM/guest contexts where no UserSession row exists.
 */
export type SessionContext =
  | {
      tenantId: string;
      actor: { kind: "GUEST"; id: string };
      role: "GUEST";
      guestTicketId: string;
      sessionId?: string;
    }
  | {
      tenantId: string;
      actor: { kind: "TEAM_MEMBER" | "END_USER" | "SYSTEM"; id: string };
      role: Exclude<RlsRole, "GUEST">;
      /**
       * Compile-time forbidden on non-GUEST variants. Attempting to set
       * this on, say, an AGENT session is a type error — see the
       * variant-level JSDoc for the reasoning.
       */
      guestTicketId?: never;
      sessionId?: string;
    };

// ---------------------------------------------------------------------------
// Session cookie payload (post-Z1.8 Set B)
// ---------------------------------------------------------------------------

/** Subject kind that ever appears in a session cookie. */
export type SubjectKind = "END_USER" | "TEAM_MEMBER";

/**
 * The signed session-cookie payload (Z1.8a Set B — subject-neutral, no
 * legacy `userId` claim). Kept structurally identical to
 * `src/lib/session.ts::SessionPayload` so B6's cutover is a rename, not
 * a wire-format change.
 */
export type SessionPayload = {
  subjectId: string;
  subjectKind: SubjectKind;
  tenantId: string;
  /**
   * M21.3 — id of the UserSession row this cookie references. Missing
   * or expired rows invalidate the cookie (see getSessionUser).
   */
  sessionId: string;
  /** JWT issued-at (seconds since epoch). Compared to passwordChangedAt for session invalidation. */
  iat?: number;
};

/**
 * The decoded shape returned by `verifySessionToken`. Wider than
 * `SessionPayload` on two fields to accommodate the Z1.8a 7-day grace
 * period for old-shape cookies:
 *   - `subjectKind` may be undefined (old-shape `{userId, tenantId}`
 *     cookies didn't carry it; wrapper dual-lookup resolves).
 *   - `sessionId` may be undefined (pre-M21.3 cookies had no session row).
 *
 * Both undefined-states are rejected downstream by `getSessionUser`; they
 * exist here only so `verifySessionToken` can return a decoded shape
 * without throwing on legacy cookies. Removal target: Z1.8a deploy + 7d
 * (see boundary doc §7.15).
 */
export type DecodedSessionPayload = {
  subjectId: string;
  subjectKind: SubjectKind | undefined;
  tenantId: string;
  sessionId: string | undefined;
  iat?: number;
};

// ---------------------------------------------------------------------------
// Purpose tokens
// ---------------------------------------------------------------------------

/**
 * Every JWT this codebase mints carries a `purpose` claim. Ten values
 * today, one per issuance surface. The union is exported so callers can
 * exhaustively switch on it; `verifyPurposeToken` (B3) will use it to
 * gate cross-purpose confusion (a leaked reset-link JWT posted as a
 * session cookie must not verify).
 *
 * Kept a plain union (not a const-enum) so the type is fully erased at
 * runtime and consumers can use string literals directly.
 */
export type TokenPurpose =
  | "session"
  | "impersonation"
  | "password-reset"
  | "email-change"
  | "data-export"
  | "invite"
  | "otp-verify"
  | "tenant-signup"
  | "csat"
  | "analytics_share";

/**
 * Impersonation cookie payload. Shipped verbatim per Phase A tightening
 * decision — `startedAt` is filed as a follow-up under a broader
 * "impersonation auditability" item and deliberately not added here to
 * keep the Support-side migration surface small.
 */
export type ImpersonationPayload = {
  impersonatorUserId: string;
  targetTenantId: string;
};

// Per-purpose payload shapes. Mirror src/lib/session.ts's individual
// Payload types byte-for-byte so B3's runtime port is a mechanical move.

/** Password reset link. See src/lib/session.ts §password-reset. */
export type PasswordResetTokenPayload = {
  userId: string;
  tenantId: string;
  iat?: number;
};

/** M21.2 email-change confirmation link. */
export type EmailChangeTokenPayload = {
  userId: string;
  tenantId: string;
  newEmail: string;
  iat?: number;
};

/** M21.6 data-export download token. */
export type DataExportTokenPayload = {
  requestId: string;
  tenantId: string;
  subjectId: string;
};

/** Team-invite email link. */
export type InviteTokenPayload = { userId: string; tenantId: string };

/** First-login OTP wrapper token (holds identity between password-set and OTP-verify). */
export type OtpSessionTokenPayload = { userId: string; tenantId: string };

/**
 * Tenant self-signup token. Carries the full signup payload so no
 * Tenant/User rows exist until OTP verification succeeds — see
 * src/lib/session.ts §tenant-signup for the rationale.
 */
export type TenantSignupTokenPayload = {
  tenantName: string;
  slug: string;
  adminName: string;
  adminEmail: string;
  /** bcrypt-hashed by the caller; plaintext is never signed. */
  passwordHash: string;
  /** bcrypt hash of the 6-digit OTP. */
  codeHash: string;
};

/** CSAT rating link, emailed on ticket → RESOLVED transition. */
export type CsatTokenPayload = { ticketId: string; tenantId: string };

/** M13 gap 2 — read-only analytics share link. */
export type AnalyticsShareTokenPayload = {
  tenantId: string;
  filters: Record<string, unknown>;
};

/**
 * The per-purpose payload map. Adding a new `TokenPurpose` without a
 * corresponding entry here is a type error — this is what enforces
 * that the purpose union and the runtime verifier stay in lockstep.
 *
 * `session` and `impersonation` intentionally use their existing named
 * types (SessionPayload / ImpersonationPayload) rather than being
 * re-declared inline so consumers can name those shapes independently.
 */
export type PurposePayloads = {
  session: SessionPayload;
  impersonation: ImpersonationPayload;
  "password-reset": PasswordResetTokenPayload;
  "email-change": EmailChangeTokenPayload;
  "data-export": DataExportTokenPayload;
  invite: InviteTokenPayload;
  "otp-verify": OtpSessionTokenPayload;
  "tenant-signup": TenantSignupTokenPayload;
  csat: CsatTokenPayload;
  analytics_share: AnalyticsShareTokenPayload;
};

/**
 * Helper: given a purpose, project to its payload. B3's
 * `verifyPurposeToken<P>(token, purpose: P)` will use this to return a
 * precisely-typed payload without runtime discrimination overhead.
 */
export type PurposePayload<P extends TokenPurpose> = PurposePayloads[P];
