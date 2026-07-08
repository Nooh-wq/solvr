import { cache } from "react";
import { prisma, withRls } from "@/lib/db";
import { getSessionPayload, getImpersonationPayload } from "@/lib/session";
import {
  systemContext,
  getEndUser,
  getTeamMemberWithRoleName,
  listGroupsForTeamMember,
} from "@/lib/shared-platform";
import type { TicketAccessScope } from "@/lib/shared-platform";
import { getAvatarUrl } from "@/lib/avatars";

/**
 * Z1.5: canonical Support-side role type. Same string values as the legacy
 * `LegacyRole` enum so every existing guard (`requireSession({minRole:"ADMIN"})`,
 * `roleAtLeast(role, "AGENT")`) keeps working unchanged. Derived from the
 * subject's wrapper counterpart:
 *   - END_USER  → "CLIENT"
 *   - TEAM_MEMBER → mapped from wrapper Role.name ("Super Admin"→"SUPER_ADMIN",
 *     "Admin"→"ADMIN", "Agent"→"AGENT"). Custom role names fall through to
 *     the safest tier — "AGENT" — so a mis-named or newly-introduced role
 *     doesn't accidentally grant SUPER_ADMIN.
 */
export type UserRole = "CLIENT" | "AGENT" | "ADMIN" | "SUPER_ADMIN";

/** Alias kept so existing `import type { SessionUser } from "@/lib/auth"; user.role` sites don't need updating. */
export type Role = UserRole;

export type SessionUser = {
  /**
   * Z1.8 Set B — the neutral subject id. For CLIENT users this is the
   * end_users.id; for staff this is the team_members.id. Preserved-ids
   * from Z1.3 mean both also equal the legacy users.id until Z1.5 drops it.
   */
  subjectId: string;
  tenantId: string;
  email: string;
  name: string;
  role: UserRole;
  /** M21.3 — id of the UserSession row backing this cookie. */
  sessionId: string;
  /**
   * Z1.7: sourced from the Support-owned SubjectAvatar table (see
   * boundary doc §7.10 + lib/avatars.ts). Null when the subject has
   * never uploaded a picture; UI falls back to initials.
   */
  avatarUrl: string | null;
  /** Set when a SUPER_ADMIN is impersonating this tenant — see src/actions/super.ts. */
  isImpersonating?: boolean;
  /**
   * Z5.2 — the wrapper Role's canonical name ("Super Admin"/"Admin"/"Agent"
   * for standard, "Light Agent"/custom otherwise). Kept alongside the mapped
   * `role` tier so guardrails that care about the specific preset (Light
   * Agent's no-public-reply rule) can key off the exact name rather than
   * having to re-derive it. Null for END_USER sessions.
   */
  roleName: string | null;
  /**
   * Z5.2 — ticket access scope for team members. Determines which tickets
   * this user can read/edit. Filtered at the app layer (queue query,
   * ticket load). Null for END_USER sessions and for impersonating
   * SUPER_ADMIN (impersonation grants ADMIN with implicit ALL scope).
   */
  ticketAccessScope: TicketAccessScope | null;
  /** Z5.2 — group ids this team member belongs to. Empty for non-team sessions. */
  groupIds: string[];
};

/**
 * Z1.5: maps a wrapper Role.name to the canonical session role string.
 * Standard-role names are seeded by seedStandardRoles() in the wrapper.
 * Anything unrecognized falls back to "AGENT" — the safest tier — so a
 * custom role can never inherit SUPER_ADMIN privileges silently.
 */
function wrapperRoleNameToUserRole(name: string): UserRole {
  if (name === "Super Admin") return "SUPER_ADMIN";
  if (name === "Admin") return "ADMIN";
  if (name === "Agent") return "AGENT";
  return "AGENT";
}

/**
 * Resolves the current app-level user from the session cookie. Returns null
 * when unauthenticated.
 *
 * Post-Z1.5 sources:
 *   identity   — wrapper (end_users / team_members)
 *   status     — lifecycle table (end_user_lifecycle / team_member_lifecycle)
 *   password   — auth_credentials (for the session-invalidation check)
 *   lastActive — lifecycle table (best-effort update)
 *
 * If an impersonation cookie is also present and the real user is a
 * SUPER_ADMIN belonging to the INTERNAL host tenant, the returned session's
 * tenantId/role are overridden to the impersonated tenant/ADMIN — this is
 * the one choke point every server action's requireSession() flows through,
 * so impersonation is enforced app-wide.
 */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const payload = await getSessionPayload();
  if (!payload) return null;

  // M21.3 — pre-M21.3 cookies with no sessionId are rejected: without a
  // row backing them they can't be tracked or revoked. Users just re-login.
  if (!payload.sessionId) return null;

  const ctx = systemContext(payload.tenantId);

  // Resolve subject via wrapper. New-shape cookies name their kind
  // explicitly; grace-period old-shape cookies (see boundary doc §7.15)
  // try TeamMember first, fall back to EndUser — same preserved-id from
  // Z1.3 works either way.
  let subjectKind = payload.subjectKind;
  let endUser: Awaited<ReturnType<typeof getEndUser>> = null;
  let teamMember: Awaited<ReturnType<typeof getTeamMemberWithRoleName>> = null;

  if (subjectKind === "TEAM_MEMBER") {
    teamMember = await getTeamMemberWithRoleName(ctx, payload.subjectId);
    if (!teamMember) return null;
  } else if (subjectKind === "END_USER") {
    endUser = await getEndUser(ctx, payload.subjectId);
    if (!endUser) return null;
  } else {
    teamMember = await getTeamMemberWithRoleName(ctx, payload.subjectId);
    if (teamMember) {
      subjectKind = "TEAM_MEMBER";
    } else {
      endUser = await getEndUser(ctx, payload.subjectId);
      if (!endUser) return null;
      subjectKind = "END_USER";
    }
  }

  if (endUser && endUser.tenantId !== payload.tenantId) return null;
  if (teamMember && teamMember.tenantId !== payload.tenantId) return null;

  // Lifecycle status + credentials read + M21.3 UserSession row. Sharing
  // the same withRls scope so RLS is set up once. auth.ts is a critical
  // path — bounded to three parallel reads per request.
  const { status, passwordChangedAt, lastActiveAt, sessionRow } = await withRls(
    { tenantId: payload.tenantId, userId: payload.subjectId },
    async (tx) => {
      const [lifecycleRow, credRow, sessionRow] = await Promise.all([
        subjectKind === "TEAM_MEMBER"
          ? tx.teamMemberLifecycle.findUnique({ where: { subjectId: payload.subjectId } })
          : tx.endUserLifecycle.findUnique({ where: { subjectId: payload.subjectId } }),
        tx.authCredential.findFirst({
          where: {
            tenantId: payload.tenantId,
            ...(subjectKind === "TEAM_MEMBER"
              ? { subjectTeamMemberId: payload.subjectId }
              : { subjectEndUserId: payload.subjectId }),
          },
          select: { passwordChangedAt: true },
        }),
        tx.userSession.findUnique({ where: { id: payload.sessionId! } }),
      ]);
      return {
        status: lifecycleRow?.status ?? null,
        passwordChangedAt: credRow?.passwordChangedAt ?? null,
        lastActiveAt: lifecycleRow?.lastActiveAt ?? null,
        sessionRow,
      };
    }
  );

  if (status !== "ACTIVE") return null;

  // M21.3 — revoked (row deleted) or expired sessions are rejected.
  // subjectId mismatch also rejects, defensively — a valid JWT signature
  // shouldn't point at another subject's session row, but if the DB is
  // ever restored from a divergent point in time, this keeps things safe.
  if (
    !sessionRow ||
    sessionRow.subjectId !== payload.subjectId ||
    sessionRow.expiresAt.getTime() < Date.now()
  ) {
    return null;
  }

  // Invalidate any session whose token was issued before the user's last
  // password change (compared in whole seconds, matching the JWT `iat`
  // granularity). changeMyPassword() re-issues the acting session's cookie,
  // so this logs out other sessions.
  if (passwordChangedAt && payload.iat !== undefined) {
    if (payload.iat < Math.floor(passwordChangedAt.getTime() / 1000)) return null;
  }

  // Best-effort update of lastActiveAt on the lifecycle row AND the
  // M21.3 session row. Throttled to at most once per hour per user;
  // session-row touch runs on the same cadence to keep the two aligned
  // and to keep write volume down. Fire-and-forget: any failure is
  // silently swallowed since it must never break session auth.
  const now = new Date();
  const staleThresholdMs = 60 * 60 * 1000;
  const shouldTouchActive =
    !lastActiveAt || now.getTime() - lastActiveAt.getTime() > staleThresholdMs;
  if (shouldTouchActive) {
    const targetKind = subjectKind;
    const sessionId = payload.sessionId!;
    withRls({ tenantId: payload.tenantId, userId: payload.subjectId }, async (tx) => {
      await Promise.all([
        targetKind === "TEAM_MEMBER"
          ? tx.teamMemberLifecycle.update({
              where: { subjectId: payload.subjectId },
              data: { lastActiveAt: now },
            })
          : tx.endUserLifecycle.update({
              where: { subjectId: payload.subjectId },
              data: { lastActiveAt: now },
            }),
        tx.userSession.update({ where: { id: sessionId }, data: { lastActiveAt: now } }),
      ]);
    }).catch(() => {
      // Non-fatal.
    });
  }

  // tenants is a public-read table (see rls_policies.sql), so this doesn't
  // need withRls — a suspended tenant's users are signed out immediately.
  const tenant = await prisma.tenant.findUnique({ where: { id: payload.tenantId } });
  if (!tenant || tenant.status === "SUSPENDED") return null;

  const email = teamMember?.email ?? endUser?.email ?? "";
  const name = teamMember?.name ?? endUser?.name ?? email;
  const role: UserRole = teamMember
    ? wrapperRoleNameToUserRole(teamMember.roleName)
    : "CLIENT";

  // Z5.2 — group memberships alongside the identity read. Only meaningful
  // for team members; end users don't participate in the scope model.
  // Failure here is non-fatal: an empty groupIds still lets ALL/ASSIGNED
  // scopes work, and GROUPS-scoped agents just see nothing until the read
  // succeeds — safer than throwing on session resolve.
  let groupIds: string[] = [];
  if (teamMember) {
    try {
      const groups = await listGroupsForTeamMember(ctx, teamMember.id);
      groupIds = groups.map((g) => g.id);
    } catch {
      // Non-fatal — logged upstream by the wrapper.
    }
  }

  const avatarUrl = await getAvatarUrl(payload.tenantId, payload.subjectId);

  const baseSession: SessionUser = {
    subjectId: payload.subjectId,
    tenantId: payload.tenantId,
    email,
    name,
    role,
    sessionId: payload.sessionId!,
    avatarUrl,
    roleName: teamMember?.roleName ?? null,
    ticketAccessScope: teamMember?.ticketAccessScope ?? null,
    groupIds,
  };

  const impersonation = await getImpersonationPayload();
  if (!impersonation) return baseSession;

  // Only a real SUPER_ADMIN at the INTERNAL host tenant can impersonate.
  if (role !== "SUPER_ADMIN" || tenant.type !== "INTERNAL") return baseSession;
  if (impersonation.impersonatorUserId !== payload.subjectId) return baseSession;

  const targetTenant = await prisma.tenant.findUnique({ where: { id: impersonation.targetTenantId } });
  if (!targetTenant || targetTenant.status === "SUSPENDED") return baseSession;

  return {
    ...baseSession,
    tenantId: targetTenant.id,
    role: "ADMIN",
    isImpersonating: true,
    // Impersonators bypass scope — they need full visibility to diagnose
    // the tenant. groupIds cleared because they belong to the host tenant.
    ticketAccessScope: "ALL",
    groupIds: [],
  };
});

export function roleAtLeast(role: UserRole, min: UserRole): boolean {
  const order: UserRole[] = ["CLIENT", "AGENT", "ADMIN", "SUPER_ADMIN"];
  return order.indexOf(role) >= order.indexOf(min);
}

/** Throws if there is no session or the session's tenant/role doesn't match. Use at the top of every server action. */
export async function requireSession(opts?: { minRole?: UserRole; tenantId?: string }): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new Error("UNAUTHENTICATED");
  if (opts?.tenantId && user.tenantId !== opts.tenantId) throw new Error("TENANT_MISMATCH");
  if (opts?.minRole && !roleAtLeast(user.role, opts.minRole)) throw new Error("FORBIDDEN");
  return user;
}
