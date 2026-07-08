"use server";

// Z4.3 — Groups admin surface.
//
// * listGroupsWithStats — /admin/groups list (name, description, member
//   count, open-ticket count, avg first-response).
// * loadGroupDetail — /admin/groups/[id] (members + stats).
// * removeMemberFromGroup — enforces the "≥1 group per team member"
//   invariant server-side. Refuses if the removal would leave the
//   member in zero groups.
//
// NB: TicketAccessScope enforcement is Z5, not this milestone. Storing
// group membership + scope is a prerequisite for it — we ship the
// storage here, Z5 will consult it.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withRls } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import {
  systemContext,
  listGroups,
  getGroup,
  listGroupsForTeamMember,
  listTeamMembersInGroup,
  removeTeamMemberFromGroup,
  assignTeamMemberToGroup,
  createGroup as wrapperCreateGroup,
  updateGroup as wrapperUpdateGroup,
} from "@/lib/shared-platform";
import { dualFkForUser, actorCols } from "@/lib/z1-dual-fk";
import type { TicketAccessScope } from "@/lib/shared-platform";

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

export type GroupRow = {
  id: string;
  name: string;
  isDefault: boolean;
  memberCount: number;
  openTicketCount: number;
  avgFirstResponseHours: number | null;
};

export async function listGroupsWithStats(): Promise<GroupRow[]> {
  const session = await requireSession({ minRole: "ADMIN" });
  const ctx = systemContext(session.tenantId);

  const groups = await listGroups(ctx);
  if (groups.length === 0) return [];
  const ids = groups.map((g) => g.id);

  // Stats are Support-scoped: member counts sit on the wrapper's
  // TeamMemberGroup pivot (RLS-scoped, but we can read via withRls
  // since we have session context), and ticket stats live on Support's
  // Ticket table.
  //
  // Ticket → Group linkage: tickets today have no groupId column. The
  // avg-first-response stat is scoped to tickets assigned to a member
  // of the group. That's the useful behaviour for now; Z5 may add a
  // real Ticket.groupId when routing lands.
  const stats = await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const [memberCounts, memberships] = await Promise.all([
        tx.teamMemberGroup.groupBy({
          by: ["groupId"],
          where: { tenantId: session.tenantId, groupId: { in: ids } },
          _count: { _all: true },
        }),
        tx.teamMemberGroup.findMany({
          where: { tenantId: session.tenantId, groupId: { in: ids } },
          select: { groupId: true, teamMemberId: true },
        }),
      ]);

      const memberIdsByGroup = new Map<string, string[]>();
      for (const m of memberships) {
        const prev = memberIdsByGroup.get(m.groupId) ?? [];
        prev.push(m.teamMemberId);
        memberIdsByGroup.set(m.groupId, prev);
      }

      // Per-group: count open tickets assigned to any member, and average
      // first-response hours across resolved/replied tickets.
      const openByGroup = new Map<string, number>();
      const firstRespByGroup = new Map<string, { sumHours: number; count: number }>();

      await Promise.all(
        ids.map(async (groupId) => {
          const memberIds = memberIdsByGroup.get(groupId) ?? [];
          if (memberIds.length === 0) return;
          const [openCount, replied] = await Promise.all([
            tx.ticket.count({
              where: {
                tenantId: session.tenantId,
                assignedTeamMemberId: { in: memberIds },
                status: { in: ["OPEN", "IN_PROGRESS", "PENDING"] },
              },
            }),
            tx.ticket.findMany({
              where: {
                tenantId: session.tenantId,
                assignedTeamMemberId: { in: memberIds },
                firstReplyAt: { not: null },
              },
              select: { createdAt: true, firstReplyAt: true },
              take: 500,
            }),
          ]);
          openByGroup.set(groupId, openCount);
          if (replied.length > 0) {
            const hours = replied.map(
              (r) => ((r.firstReplyAt!.getTime() - r.createdAt.getTime()) / 3_600_000)
            );
            firstRespByGroup.set(groupId, {
              sumHours: hours.reduce((s, h) => s + h, 0),
              count: hours.length,
            });
          }
        })
      );

      const memberCountMap = new Map(memberCounts.map((m) => [m.groupId, m._count._all]));
      return { memberCountMap, openByGroup, firstRespByGroup };
    }
  );

  return groups.map<GroupRow>((g) => {
    const fr = stats.firstRespByGroup.get(g.id);
    return {
      id: g.id,
      name: g.name,
      isDefault: g.isDefault,
      memberCount: stats.memberCountMap.get(g.id) ?? 0,
      openTicketCount: stats.openByGroup.get(g.id) ?? 0,
      avgFirstResponseHours: fr ? fr.sumHours / fr.count : null,
    };
  });
}

// ---------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------

export type GroupDetail = {
  id: string;
  name: string;
  isDefault: boolean;
  members: Array<{
    id: string;
    name: string | null;
    email: string;
    ticketAccessScope: TicketAccessScope;
    openTicketCount: number;
  }>;
  openTicketCount: number;
  avgFirstResponseHours: number | null;
};

export async function loadGroupDetail(id: string): Promise<GroupDetail | null> {
  const session = await requireSession({ minRole: "ADMIN" });
  const ctx = systemContext(session.tenantId);

  const group = await getGroup(ctx, id);
  if (!group) return null;

  const members = await listTeamMembersInGroup(ctx, id);
  const memberIds = members.map((m) => m.id);

  const stats = await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      if (memberIds.length === 0) {
        return {
          openPerMember: new Map<string, number>(),
          groupOpen: 0,
          avgFrH: null as number | null,
        };
      }
      const [openPerMemberRows, groupOpen, replied] = await Promise.all([
        tx.ticket.groupBy({
          by: ["assignedTeamMemberId"],
          where: {
            tenantId: session.tenantId,
            assignedTeamMemberId: { in: memberIds },
            status: { in: ["OPEN", "IN_PROGRESS", "PENDING"] },
          },
          _count: { _all: true },
        }),
        tx.ticket.count({
          where: {
            tenantId: session.tenantId,
            assignedTeamMemberId: { in: memberIds },
            status: { in: ["OPEN", "IN_PROGRESS", "PENDING"] },
          },
        }),
        tx.ticket.findMany({
          where: {
            tenantId: session.tenantId,
            assignedTeamMemberId: { in: memberIds },
            firstReplyAt: { not: null },
          },
          select: { createdAt: true, firstReplyAt: true },
          take: 500,
        }),
      ]);
      const openPerMember = new Map<string, number>();
      for (const r of openPerMemberRows) {
        if (r.assignedTeamMemberId) openPerMember.set(r.assignedTeamMemberId, r._count._all);
      }
      const avgFrH =
        replied.length === 0
          ? null
          : replied
              .map((r) => (r.firstReplyAt!.getTime() - r.createdAt.getTime()) / 3_600_000)
              .reduce((s, h) => s + h, 0) / replied.length;
      return { openPerMember, groupOpen, avgFrH };
    }
  );

  return {
    id: group.id,
    name: group.name,
    isDefault: group.isDefault,
    members: members.map((m) => ({
      id: m.id,
      name: m.name,
      email: m.email,
      ticketAccessScope: m.ticketAccessScope,
      openTicketCount: stats.openPerMember.get(m.id) ?? 0,
    })),
    openTicketCount: stats.groupOpen,
    avgFirstResponseHours: stats.avgFrH,
  };
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

const createSchema = z.object({ name: z.string().min(1).max(120) });

export async function createGroupAction(
  input: z.infer<typeof createSchema>
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const session = await requireSession({ minRole: "ADMIN" });
  const parsed = createSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  try {
    const g = await wrapperCreateGroup(systemContext(session.tenantId), { name: parsed.data.name });
    revalidatePath("/admin/groups");
    return { ok: true, id: g.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't create." };
  }
}

const renameSchema = z.object({ groupId: z.string().min(1), name: z.string().min(1).max(120) });

export async function renameGroupAction(
  input: z.infer<typeof renameSchema>
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await requireSession({ minRole: "ADMIN" });
  const parsed = renameSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  try {
    await wrapperUpdateGroup(systemContext(session.tenantId), parsed.data.groupId, {
      name: parsed.data.name,
    });
    revalidatePath(`/admin/groups/${parsed.data.groupId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't rename." };
  }
}

const removeSchema = z.object({
  groupId: z.string().min(1),
  teamMemberId: z.string().min(1),
});

export async function removeMemberFromGroup(
  input: z.infer<typeof removeSchema>
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await requireSession({ minRole: "ADMIN" });
  const parsed = removeSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const { groupId, teamMemberId } = parsed.data;
  const ctx = systemContext(session.tenantId);

  // Invariant: every team member belongs to ≥1 group (Z1). Refuse the
  // removal if this member has exactly one group and it's the one being
  // removed — the caller must reassign to another group first.
  const existing = await listGroupsForTeamMember(ctx, teamMemberId);
  const inThisGroup = existing.some((g) => g.id === groupId);
  if (!inThisGroup) return { ok: true }; // idempotent no-op
  if (existing.length <= 1) {
    return {
      ok: false,
      error: "Every team member must belong to at least one group. Assign another group first.",
    };
  }
  try {
    await removeTeamMemberFromGroup(ctx, teamMemberId, groupId);
    await withRls(
      { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
      async (tx) => {
        await tx.auditLog.create({
          data: {
            tenantId: session.tenantId,
            ...actorCols(dualFkForUser(session.subjectId, session.role)),
            action: "REMOVE_GROUP_MEMBER",
            toValue: `${teamMemberId}:${groupId}`,
          },
        });
      }
    );
    revalidatePath(`/admin/groups/${groupId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't remove." };
  }
}

const addSchema = z.object({
  groupId: z.string().min(1),
  teamMemberId: z.string().min(1),
});

export async function addMemberToGroup(
  input: z.infer<typeof addSchema>
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await requireSession({ minRole: "ADMIN" });
  const parsed = addSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const ctx = systemContext(session.tenantId);
  try {
    await assignTeamMemberToGroup(ctx, parsed.data.teamMemberId, parsed.data.groupId);
    revalidatePath(`/admin/groups/${parsed.data.groupId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't add." };
  }
}

// Helper for the Team Members editor to enumerate assignable team
// members that aren't already in this group.
export async function listAssignableTeamMembersForGroup(
  groupId: string
): Promise<Array<{ id: string; name: string | null; email: string }>> {
  const session = await requireSession({ minRole: "ADMIN" });
  const ctx = systemContext(session.tenantId);
  const [inGroup, all] = await Promise.all([
    listTeamMembersInGroup(ctx, groupId),
    // listTeamMembers page cap 200 — same convention as the Customers
    // page. Fine at this repo's tenant sizes.
    (await import("@/lib/shared-platform")).listTeamMembers(ctx, { limit: 200 }),
  ]);
  const inSet = new Set(inGroup.map((m) => m.id));
  return all.items
    .filter((m) => !inSet.has(m.id))
    .map((m) => ({ id: m.id, name: m.name, email: m.email }));
}
