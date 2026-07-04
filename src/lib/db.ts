import { PrismaClient } from "@/generated/prisma";

declare global {
  var __prisma: PrismaClient | undefined;
}

// The app runtime connects as `app_runtime` (no BYPASSRLS — see
// scripts/create-app-runtime-role.mjs), not the `postgres` role used for
// migrations. Postgres skips RLS entirely for table owners/superusers
// regardless of "enable row level security", so connecting as the right
// role is what actually makes the RLS policies a backstop rather than
// decoration. Falls back to DATABASE_URL if APP_DATABASE_URL isn't set
// (e.g. local PGlite dev, which has no meaningful RLS bypass distinction).
const runtimeUrl = process.env.APP_DATABASE_URL ?? process.env.DATABASE_URL;

// Singleton across hot reloads in dev.
export const prisma =
  globalThis.__prisma ?? new PrismaClient({ datasources: { db: { url: runtimeUrl } } });
if (process.env.NODE_ENV !== "production") globalThis.__prisma = prisma;

export type RlsContext = {
  tenantId: string;
  userId: string | null;
  // Optional: the `users` table policy doesn't check role, so
  // getSessionUser() can establish tenant scope from the session JWT alone,
  // before the DB has told us the caller's role.
  role?: "CLIENT" | "AGENT" | "ADMIN" | "SUPER_ADMIN" | "GUEST";
  // Required (and only meaningful) when role is "GUEST" — the one ticket a
  // guest-invite link grants access to. RLS policies for tickets/messages
  // exclude GUEST from their normal tenant-wide/own-ticket clauses and
  // instead check this against the row's ticketId, so a guest session never
  // inherits the same tenant-wide visibility a real CLIENT/AGENT session
  // gets just by tenantId matching. See prisma/rls_policies.sql and
  // lib/guest-access.ts.
  guestTicketId?: string;
};

/**
 * Runs `fn` inside a transaction with Postgres session vars set so RLS
 * policies (app.tenant_id / app.user_id / app.role) scope every query.
 * This is the hard backstop behind the app-layer tenant/role checks in
 * each server action — never call prisma directly for tenant data.
 */
export async function withRls<T>(
  ctx: RlsContext,
  fn: (tx: Omit<PrismaClient, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends">) => Promise<T>
): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      // All four RLS session vars are set in a single round-trip. Doing them
      // as sequential $executeRaw calls multiplies how long each connection
      // is held open just for setup — under the pooler's limited connection
      // budget that widens the window for concurrent requests to collide and
      // time out (P2028). set_config(..., true) scopes each to this tx.
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${ctx.tenantId}, true), set_config('app.user_id', ${ctx.userId ?? ""}, true), set_config('app.role', ${ctx.role ?? ""}, true), set_config('app.guest_ticket_id', ${ctx.guestTicketId ?? ""}, true)`;
      return fn(tx);
    },
    {
      // Defaults (maxWait 2s / timeout 5s) are too tight once requests queue on
      // a small pooled connection budget across regions: a caller waiting for a
      // free connection would give up after 2s and throw "Unable to start a
      // transaction in the given time" (P2028) even though it would have
      // succeeded moments later. These give real headroom without masking a
      // genuinely stuck query.
      maxWait: 15_000,
      timeout: 20_000,
    }
  );
}
