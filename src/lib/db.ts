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
  role?: "CLIENT" | "AGENT" | "ADMIN" | "SUPER_ADMIN";
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
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${ctx.tenantId}, true)`;
    await tx.$executeRaw`SELECT set_config('app.user_id', ${ctx.userId ?? ""}, true)`;
    await tx.$executeRaw`SELECT set_config('app.role', ${ctx.role ?? ""}, true)`;
    return fn(tx);
  });
}
