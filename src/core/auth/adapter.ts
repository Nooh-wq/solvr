// src/core/auth/adapter.ts
//
// B4 (Z-post / core-auth) — the withRls bridge. Threads a
// SessionContext through a Postgres transaction, setting the four
// `app.*` GUCs in a single round-trip so RLS policies in
// prisma/rls_policies.sql can enforce tenant / user / role / guest-
// ticket scope on every downstream query.
//
// This is B4's replacement for `src/lib/db.ts::withRls`. B6's cutover
// migrates callsites in the token-I/O paths off `withRls` and onto
// `withSessionContext`; the rest follow in B7. Wire behaviour is
// byte-identical to Support's current withRls — same single SELECT
// with four set_config() calls, same maxWait/timeout budget, same
// empty-string convention for unset GUCs (confirmed safe by Phase A's
// grep: nullif() at the rls_policies.sql helper layer collapses ""
// to NULL, so every existing policy behaves identically for both).
//
// Layering note: this module accepts the Prisma client as an
// explicit parameter rather than importing a shared singleton. See
// the "3-arg signature" section of B4's chat report for the reasoning
// — TL;DR: keeps the core/ layer free of app-runtime imports and
// makes the mock-based unit tests trivially hermetic.
//
// The Phase A adapter (B5 middleware) constructs a SessionContext
// once at the request boundary and threads it into this function
// per Prisma operation; that split is what makes future callers
// (Support-side platform code, M7 API-key surface) able to reuse
// the same transactional wrapper without re-implementing the GUC
// projection rules.

import type { PrismaClient } from "@/generated/prisma";
import type { SessionContext } from "./types";

/**
 * The narrow interface this adapter uses from the Prisma runtime.
 * Exposed as a type so tests can pass a mock without importing the
 * whole generated client. Production callers pass their `PrismaClient`
 * singleton directly — the mismatch is safe because `PrismaClient`
 * structurally satisfies `TransactionalPrisma`.
 */
export type TransactionalPrisma = Pick<PrismaClient, "$transaction">;

/**
 * The transaction-scoped Prisma client the callback receives. Matches
 * the shape `src/lib/db.ts::withRls` exposes today so B6's cutover is
 * a rename, not an API break.
 */
export type SessionTx = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

/**
 * The four Postgres GUC values `withSessionContext` writes on every
 * transaction. Exported so the runtime projection is unit-testable
 * without spinning up a transaction — see `projectContextToGucValues`.
 */
export type GucValues = {
  tenantId: string;
  userId: string;
  role: string;
  guestTicketId: string;
};

/**
 * Pure projection from a SessionContext to the four wire values that
 * end up in `set_config('app.*', ..., true)` inside the transaction.
 *
 * Discriminated-union handling: on the GUEST variant `guestTicketId`
 * is a required string; on the non-GUEST variant it's forbidden at
 * the type level. The projection collapses the two variants to a
 * uniform four-string tuple by substituting "" on the non-GUEST
 * branch. Downstream, `app_current_guest_ticket_id()` uses
 * `nullif(current_setting('app.guest_ticket_id', true), '')`
 * (prisma/rls_policies.sql:37) so "" and unset are behaviourally
 * identical for every policy.
 */
export function projectContextToGucValues(ctx: SessionContext): GucValues {
  return {
    tenantId: ctx.tenantId,
    userId: ctx.actor.id,
    // The non-GUEST variant's role is Exclude<RlsRole, "GUEST"> which
    // already includes "" for the "not yet resolved" tier — pass
    // through directly. The GUEST variant is exactly "GUEST".
    role: ctx.role,
    guestTicketId: ctx.role === "GUEST" ? ctx.guestTicketId : "",
  };
}

/**
 * Transaction options — mirror `src/lib/db.ts::withRls`'s budget.
 *
 * Defaults (maxWait 2s / timeout 5s) are too tight once requests
 * queue on the pooled connection budget: a caller waiting for a free
 * connection would give up after 2s and throw "Unable to start a
 * transaction in the given time" (P2028) even when it would have
 * succeeded moments later. These give real headroom without masking
 * a genuinely stuck query.
 */
export const TRANSACTION_OPTIONS = {
  maxWait: 15_000,
  timeout: 20_000,
} as const;

/**
 * Runs `fn` inside a Postgres transaction with the four `app.*` GUCs
 * set from `ctx`. Every downstream query on the transaction-scoped
 * `tx` sees the correct RLS scope; queries on the enclosing
 * `PrismaClient` don't (they run on their own connection with no
 * GUCs set, so RLS returns nothing to non-BYPASSRLS callers — a
 * fail-closed default, not a leak).
 *
 * ### Single-round-trip discipline
 * All four `set_config()` calls happen in one SELECT statement, not
 * four sequential `$executeRaw` calls. Reasoning inherited from
 * Support's withRls:
 *
 *   - Every additional round-trip lengthens the window a transaction
 *     holds its pooled connection open just for setup.
 *   - Under a small connection budget across regions (Neon's pooler,
 *     PGlite local dev), that widens the collision window enough that
 *     concurrent requests time out with P2028 before their work
 *     starts.
 *   - One SELECT with four comma-separated `set_config(..., true)`
 *     calls is idiomatic Postgres and costs a single network hop.
 *
 * The `true` third arg to `set_config` scopes each GUC to the
 * current transaction — no leakage into pooled connection reuse.
 *
 * ### Empty-string convention
 * `guestTicketId` on non-GUEST sessions is projected to "" (see
 * `projectContextToGucValues`). Phase A's grep confirmed every RLS
 * policy consumes these GUCs via helpers that `nullif(..., '')`,
 * so "" and NULL are behaviourally identical. Documented at
 * `prisma/rls_policies.sql:25-37`.
 */
export async function withSessionContext<T>(
  prisma: TransactionalPrisma,
  ctx: SessionContext,
  fn: (tx: SessionTx) => Promise<T>
): Promise<T> {
  const { tenantId, userId, role, guestTicketId } = projectContextToGucValues(ctx);
  return prisma.$transaction(
    async (tx) => {
      await (tx as SessionTx).$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true), set_config('app.user_id', ${userId}, true), set_config('app.role', ${role}, true), set_config('app.guest_ticket_id', ${guestTicketId}, true)`;
      return fn(tx as SessionTx);
    },
    TRANSACTION_OPTIONS
  );
}
