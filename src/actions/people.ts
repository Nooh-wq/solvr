"use server";

// Z3 — People surface actions. Splits admin.ts's monolithic listTeam()
// into two dedicated readers for the new Customers and Team Members
// pages. Each aggregates the columns the respective directory needs
// (ticket count, avg CSAT, last active for customers; role/group/scope
// for team members) in one round-trip per page rather than N+1'ing per
// row from the client.

import { withRls } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import {
  systemContext,
  listEndUsers,
  listTeamMembers,
} from "@/lib/shared-platform";
import { getAvatarUrlsByIds } from "@/lib/avatars";
import type { UserStatus } from "@/generated/prisma";
import type { UserRole as Role } from "@/lib/auth";

// ---------------------------------------------------------------------------
// Customers (end users only)
// ---------------------------------------------------------------------------

export type CustomerRow = {
  id: string;
  name: string | null;
  email: string;
  status: UserStatus;
  organizationName: string | null;
  tags: Array<{ id: string; name: string; color: string }>;
  ticketCount: number;
  lastActiveAt: Date | null;
  csatAvg: number | null;
  csatCount: number;
  avatarUrl: string | null;
  createdAt: Date;
};

export async function listCustomers(): Promise<CustomerRow[]> {
  const session = await requireSession({ minRole: "ADMIN" });
  const ctx = systemContext(session.tenantId);

  // Fetch a wide page — Z3.1 keeps client-side filter/sort/paginate.
  // Server-side pagination lands in Z3.6 alongside the CSV export.
  const { items: endUsers } = await listEndUsers(ctx, { limit: 200 });
  if (endUsers.length === 0) return [];
  const ids = endUsers.map((e) => e.id);

  // Aggregations that need Support-side RLS (tickets, survey responses,
  // lifecycle) — one withRls scope, then per-row lookups from Maps.
  const { ticketByClient, csatByClient, lifecycleById, avatarBySubjectId } = await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const [ticketCounts, csatRows, lifecycles] = await Promise.all([
        tx.ticket.groupBy({
          by: ["clientEndUserId"],
          where: { tenantId: session.tenantId, clientEndUserId: { in: ids } },
          _count: { _all: true },
        }),
        // Join survey → ticket to associate rating with the requesting end
        // user. Prisma groupBy doesn't cross relations, so plain findMany
        // over survey_responses joined to ticket.clientEndUserId, then
        // reduce client-side. Tenant-count-scoped: dozens of ratings.
        tx.surveyResponse.findMany({
          where: {
            tenantId: session.tenantId,
            ticket: { clientEndUserId: { in: ids } },
          },
          select: { rating: true, ticket: { select: { clientEndUserId: true } } },
        }),
        tx.endUserLifecycle.findMany({
          where: { tenantId: session.tenantId, subjectId: { in: ids } },
        }),
      ]);
      const ticketByClient = new Map<string, number>();
      for (const row of ticketCounts) {
        if (row.clientEndUserId) ticketByClient.set(row.clientEndUserId, row._count._all);
      }
      const csatByClient = new Map<string, { sum: number; count: number }>();
      for (const row of csatRows) {
        const uid = row.ticket.clientEndUserId;
        if (!uid) continue;
        const prev = csatByClient.get(uid) ?? { sum: 0, count: 0 };
        prev.sum += row.rating;
        prev.count += 1;
        csatByClient.set(uid, prev);
      }
      const lifecycleById = new Map(lifecycles.map((l) => [l.subjectId, l]));
      const avatarBySubjectId = await getAvatarUrlsByIds(session.tenantId, ids);
      return { ticketByClient, csatByClient, lifecycleById, avatarBySubjectId };
    }
  );

  // Batch the org-name + tags lookups in one Support-scoped transaction
  // rather than N per-row wrapper calls: a for-loop with two awaits per
  // row was making the page 15-20s on tenants with just 20 customers
  // because each wrapper helper opens its own withRls tx. Pulling both
  // sides in bulk here keeps the whole list under a couple seconds.
  const primaryOrgIds = new Set<string>();
  for (const eu of endUsers) if (eu.organizationId) primaryOrgIds.add(eu.organizationId);
  const { orgById, tagsBySubject } = await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const [orgs, assignments] = await Promise.all([
        primaryOrgIds.size > 0
          ? tx.organization.findMany({
              where: { tenantId: session.tenantId, id: { in: [...primaryOrgIds] } },
              select: { id: true, name: true },
            })
          : Promise.resolve([]),
        tx.tagAssignment.findMany({
          where: {
            tenantId: session.tenantId,
            targetType: "END_USER",
            targetId: { in: ids },
          },
          include: { tag: { select: { id: true, name: true, color: true } } },
        }),
      ]);
      const orgById = new Map(orgs.map((o) => [o.id, o]));
      const tagsBySubject = new Map<string, Array<{ id: string; name: string; color: string }>>();
      for (const a of assignments) {
        const prev = tagsBySubject.get(a.targetId) ?? [];
        prev.push({ id: a.tag.id, name: a.tag.name, color: a.tag.color });
        tagsBySubject.set(a.targetId, prev);
      }
      return { orgById, tagsBySubject };
    }
  );

  return endUsers.map<CustomerRow>((eu) => {
    const lc = lifecycleById.get(eu.id);
    const csat = csatByClient.get(eu.id);
    return {
      id: eu.id,
      name: eu.name,
      email: eu.email,
      status: (lc?.status as UserStatus) ?? "PENDING",
      organizationName: eu.organizationId ? orgById.get(eu.organizationId)?.name ?? null : null,
      tags: tagsBySubject.get(eu.id) ?? [],
      ticketCount: ticketByClient.get(eu.id) ?? 0,
      lastActiveAt: lc?.lastActiveAt ?? null,
      csatAvg: csat ? csat.sum / csat.count : null,
      csatCount: csat?.count ?? 0,
      avatarUrl: avatarBySubjectId.get(eu.id) ?? null,
      createdAt: eu.createdAt,
    };
  });
}

// ---------------------------------------------------------------------------
// Team members (agents + admins)
// ---------------------------------------------------------------------------

export type TeamMemberRow = {
  id: string;
  name: string | null;
  email: string;
  role: Role;
  status: UserStatus;
  ticketAccessScope: "ALL" | "GROUPS" | "ASSIGNED_ONLY";
  groupNames: string[];
  lastActiveAt: Date | null;
  avatarUrl: string | null;
  createdAt: Date;
  isLastSuperAdmin: boolean;
};

function wrapperRoleNameToTeamRole(name: string): Role {
  switch (name) {
    case "Super Admin":
      return "SUPER_ADMIN";
    case "Admin":
      return "ADMIN";
    case "Agent":
      return "AGENT";
    default:
      return "AGENT";
  }
}

export async function listTeamMembersDetailed(): Promise<TeamMemberRow[]> {
  const session = await requireSession({ minRole: "ADMIN" });
  const ctx = systemContext(session.tenantId);

  const { items: teamMembers } = await listTeamMembers(ctx, { limit: 200 });
  if (teamMembers.length === 0) return [];
  const ids = teamMembers.map((m) => m.id);

  const { lifecycleById, avatarBySubjectId, roleById, groupsByMember } = await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const [lifecycles, roles, memberships] = await Promise.all([
        tx.teamMemberLifecycle.findMany({
          where: { tenantId: session.tenantId, subjectId: { in: ids } },
        }),
        tx.role.findMany({ where: { tenantId: session.tenantId } }),
        tx.teamMemberGroup.findMany({
          where: { teamMemberId: { in: ids } },
          include: { group: { select: { id: true, name: true } } },
        }),
      ]);
      const roleById = new Map(roles.map((r) => [r.id, r]));
      const groupsByMember = new Map<string, string[]>();
      for (const m of memberships) {
        const prev = groupsByMember.get(m.teamMemberId) ?? [];
        prev.push(m.group.name);
        groupsByMember.set(m.teamMemberId, prev);
      }
      const lifecycleById = new Map(lifecycles.map((l) => [l.subjectId, l]));
      const avatarBySubjectId = await getAvatarUrlsByIds(session.tenantId, ids);
      return { lifecycleById, avatarBySubjectId, roleById, groupsByMember };
    }
  );

  const superAdminIds = new Set<string>();
  for (const tm of teamMembers) {
    const roleName = roleById.get(tm.roleId)?.name;
    if (roleName === "Super Admin") superAdminIds.add(tm.id);
  }
  let activeSaCount = 0;
  for (const id of superAdminIds) {
    if (lifecycleById.get(id)?.status === "ACTIVE") activeSaCount += 1;
  }

  return teamMembers.map((tm) => {
    const lc = lifecycleById.get(tm.id);
    const roleName = roleById.get(tm.roleId)?.name ?? "Agent";
    const role = wrapperRoleNameToTeamRole(roleName);
    return {
      id: tm.id,
      name: tm.name,
      email: tm.email,
      role,
      status: (lc?.status as UserStatus) ?? "PENDING",
      ticketAccessScope: tm.ticketAccessScope,
      groupNames: (groupsByMember.get(tm.id) ?? []).sort(),
      lastActiveAt: lc?.lastActiveAt ?? null,
      avatarUrl: avatarBySubjectId.get(tm.id) ?? null,
      createdAt: tm.createdAt,
      isLastSuperAdmin:
        role === "SUPER_ADMIN" && (lc?.status as UserStatus) === "ACTIVE" && activeSaCount <= 1,
    };
  });
}
