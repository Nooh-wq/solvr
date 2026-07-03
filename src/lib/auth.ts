import { cache } from "react";
import { prisma, withRls } from "@/lib/db";
import { getSessionPayload, getImpersonationPayload } from "@/lib/session";
import type { Role } from "@/generated/prisma";

export type SessionUser = {
  id: string;
  tenantId: string;
  email: string;
  name: string;
  role: Role;
  avatarUrl: string | null;
  /** Set when a SUPER_ADMIN is impersonating this tenant — see src/actions/super.ts. */
  isImpersonating?: boolean;
};

/**
 * Resolves the current app-level user from the session cookie. Returns null
 * when unauthenticated.
 *
 * If an impersonation cookie is also present and the real user is a
 * SUPER_ADMIN belonging to the INTERNAL host tenant, the returned session's
 * tenantId/role are overridden to the impersonated tenant/ADMIN — this is
 * the one choke point every server action's requireSession() flows through,
 * so impersonation is enforced app-wide rather than needing every action to
 * know about it individually. `id`/`email`/`name` stay the real super
 * admin's, so every audit-logged mutation made while impersonating still
 * attributes correctly to the real actor, not a tenant user that doesn't exist.
 */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const payload = await getSessionPayload();
  if (!payload) return null;

  // The JWT's tenantId (signed by us at login, not attacker-controlled)
  // establishes RLS scope for this one lookup — the DB hasn't told us the
  // caller's role yet, so this is the one query that can't wait for
  // requireSession() to know it. The users-table policy only checks tenantId.
  const dbUser = await withRls({ tenantId: payload.tenantId, userId: payload.userId }, (tx) =>
    tx.user.findUnique({ where: { id: payload.userId } })
  );
  if (!dbUser || dbUser.status !== "ACTIVE" || dbUser.tenantId !== payload.tenantId) return null;

  // Invalidate any session whose token was issued before the user's last
  // password change (compared in whole seconds, matching the JWT `iat`
  // granularity). changeMyPassword() re-issues the acting session's cookie, so
  // this logs out *other* sessions — a stolen/leaked session dies the moment
  // the real user changes their password, closing the stateless-JWT gap.
  if (dbUser.passwordChangedAt && payload.iat !== undefined) {
    if (payload.iat < Math.floor(dbUser.passwordChangedAt.getTime() / 1000)) return null;
  }

  // tenants is a public-read table (see rls_policies.sql), so this doesn't
  // need withRls — a suspended tenant's users are signed out immediately,
  // not just blocked from new logins (see src/actions/auth.ts's login()).
  const tenant = await prisma.tenant.findUnique({ where: { id: dbUser.tenantId } });
  if (!tenant || tenant.status === "SUSPENDED") return null;

  const baseSession: SessionUser = {
    id: dbUser.id,
    tenantId: dbUser.tenantId,
    email: dbUser.email,
    name: dbUser.name,
    role: dbUser.role,
    avatarUrl: dbUser.avatarUrl,
  };

  const impersonation = await getImpersonationPayload();
  if (!impersonation) return baseSession;

  // Only a real SUPER_ADMIN at the INTERNAL host tenant can impersonate —
  // a stale/forged cookie for anyone else is silently ignored (not an
  // error) rather than breaking the page; startImpersonation() is the only
  // place this cookie gets set, and it already enforces this.
  if (dbUser.role !== "SUPER_ADMIN" || tenant.type !== "INTERNAL") return baseSession;
  if (impersonation.impersonatorUserId !== dbUser.id) return baseSession;

  const targetTenant = await prisma.tenant.findUnique({ where: { id: impersonation.targetTenantId } });
  if (!targetTenant || targetTenant.status === "SUSPENDED") return baseSession;

  return {
    ...baseSession,
    tenantId: targetTenant.id,
    role: "ADMIN",
    isImpersonating: true,
  };
});

export function roleAtLeast(role: Role, min: Role): boolean {
  const order: Role[] = ["CLIENT", "AGENT", "ADMIN", "SUPER_ADMIN"];
  return order.indexOf(role) >= order.indexOf(min);
}

/** Throws if there is no session or the session's tenant/role doesn't match. Use at the top of every server action. */
export async function requireSession(opts?: { minRole?: Role; tenantId?: string }): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new Error("UNAUTHENTICATED");
  if (opts?.tenantId && user.tenantId !== opts.tenantId) throw new Error("TENANT_MISMATCH");
  if (opts?.minRole && !roleAtLeast(user.role, opts.minRole)) throw new Error("FORBIDDEN");
  return user;
}
