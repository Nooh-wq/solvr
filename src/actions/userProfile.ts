"use server";

// Z3.3 — User profile page loader + note editor.
//
// A "user" here is either an EndUser or a TeamMember (subjectId space is
// shared thanks to Z1.3 preserved ids). The loader tries both wrapper
// tables and returns a discriminated result; callers dispatch on `kind`.
//
// Interactions timeline is scoped to tickets in Z3.3; chat + KB layer
// in during Z3.4 (already stubbed here so the shape is stable).

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withRls } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import {
  systemContext,
  getEndUser,
  getTeamMember,
  listOrganizationsForEndUser,
  listTagsForTarget,
} from "@/lib/shared-platform";
import { getAvatarUrl } from "@/lib/avatars";
import { dualFkForUser, actorCols } from "@/lib/z1-dual-fk";
import type { UserStatus, TicketStatus, Priority } from "@/generated/prisma";
import type { UserRole as Role } from "@/lib/auth";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type UserProfileHeader = {
  id: string;
  kind: "END_USER" | "TEAM_MEMBER";
  name: string | null;
  email: string;
  avatarUrl: string | null;
  status: UserStatus;
  role: Role;
  notes: string | null;
  createdAt: Date;
  lastActiveAt: Date | null;
  organizations: Array<{ id: string; name: string }>;
  tags: Array<{ id: string; name: string; color: string }>;
  csatAvg: number | null;
  csatCount: number;
  /** Z5.2 — only meaningful for TEAM_MEMBER subjects. Null for end users. */
  ticketAccessScope: "ALL" | "GROUPS" | "ASSIGNED_ONLY" | null;
};

export type ProfileTicketRow = {
  id: string;
  reference: string;
  title: string;
  status: TicketStatus;
  priority: Priority;
  createdAt: Date;
  updatedAt: Date;
  csatRating: number | null;
};

export type UserProfileData = {
  header: UserProfileHeader;
  tickets: ProfileTicketRow[];
  // Z3.4 — chat conversations threaded in. No KB view tracking exists
  // in the schema yet; per spec that widget is gated on the table
  // existing, so the array is always empty for now.
  chats: Array<{ id: string; startedAt: Date; endedAt: Date | null; ticketId: string | null; status: string }>;
  kbViews: Array<{ id: string; articleTitle: string; viewedAt: Date }>;
};

export async function loadUserProfile(userId: string): Promise<UserProfileData | null> {
  const session = await requireSession({ minRole: "AGENT" });
  const ctx = systemContext(session.tenantId);

  // Try the wrapper's EndUser first, then TeamMember. Both id spaces are
  // globally unique per tenant (Z1.3), so at most one hits.
  const [endUser, teamMember] = await Promise.all([
    getEndUser(ctx, userId),
    getTeamMember(ctx, userId),
  ]);
  const subject = endUser ?? teamMember;
  if (!subject) return null;
  const kind = endUser ? "END_USER" : "TEAM_MEMBER";

  // Wrapper-side reads: org membership + tags. Both are per-subject
  // singletons at this scale.
  const [orgs, tags, avatarUrl] = await Promise.all([
    kind === "END_USER" ? listOrganizationsForEndUser(ctx, userId) : Promise.resolve([]),
    listTagsForTarget(ctx, { type: kind, id: userId }),
    getAvatarUrl(session.tenantId, userId),
  ]);

  // Support-side reads: lifecycle, tickets, CSAT, chats, role name. One RLS scope.
  const { lifecycle, tickets, csatAgg, chats, roleName } = await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const [lc, tickets, csatRows, chatRows] = await Promise.all([
        kind === "END_USER"
          ? tx.endUserLifecycle.findUnique({ where: { subjectId: userId } })
          : tx.teamMemberLifecycle.findUnique({ where: { subjectId: userId } }),
        // Both directions: tickets THIS user opened (clientEndUserId /
        // clientTeamMemberId) and tickets THIS team member owns (assignedTeamMemberId).
        // The profile page renders both together sorted by activity.
        tx.ticket.findMany({
          where: {
            tenantId: session.tenantId,
            OR:
              kind === "END_USER"
                ? [{ clientEndUserId: userId }]
                : [{ clientTeamMemberId: userId }, { assignedTeamMemberId: userId }],
          },
          orderBy: { updatedAt: "desc" },
          take: 50,
          select: {
            id: true,
            reference: true,
            title: true,
            status: true,
            priority: true,
            createdAt: true,
            updatedAt: true,
            surveyResponse: { select: { rating: true } },
          },
        }),
        tx.surveyResponse.findMany({
          where: {
            tenantId: session.tenantId,
            ticket:
              kind === "END_USER"
                ? { clientEndUserId: userId }
                : { clientTeamMemberId: userId },
          },
          select: { rating: true },
        }),
        tx.chatConversation.findMany({
          where: {
            tenantId: session.tenantId,
            ...(kind === "END_USER"
              ? { endUserId: userId }
              : { teamMemberId: userId }),
          },
          orderBy: { createdAt: "desc" },
          take: 50,
          select: {
            id: true,
            createdAt: true,
            status: true,
            ticketId: true,
          },
        }),
      ]);
      let roleName: string | null = null;
      if (kind === "TEAM_MEMBER" && teamMember) {
        const r = await tx.role.findUnique({ where: { id: teamMember.roleId } });
        roleName = r?.name ?? null;
      }
      return {
        lifecycle: lc,
        tickets,
        csatAgg:
          csatRows.length === 0
            ? { avg: null, count: 0 }
            : {
                avg: csatRows.reduce((s, r) => s + r.rating, 0) / csatRows.length,
                count: csatRows.length,
              },
        chats: chatRows,
        roleName,
      };
    }
  );

  const role: Role = wrapperRoleNameToTeamRole(roleName, kind);

  return {
    header: {
      id: subject.id,
      kind,
      name: subject.name,
      email: subject.email,
      avatarUrl,
      status: (lifecycle?.status as UserStatus) ?? "PENDING",
      role,
      notes: lifecycle?.notes ?? null,
      createdAt: subject.createdAt,
      lastActiveAt: lifecycle?.lastActiveAt ?? null,
      organizations: orgs.map((o) => ({ id: o.id, name: o.name })),
      tags: tags.map((t) => ({ id: t.id, name: t.name, color: t.color })),
      csatAvg: csatAgg.avg,
      csatCount: csatAgg.count,
      ticketAccessScope: teamMember?.ticketAccessScope ?? null,
    },
    tickets: tickets.map((t) => ({
      id: t.id,
      reference: t.reference,
      title: t.title,
      status: t.status,
      priority: t.priority,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      csatRating: t.surveyResponse?.rating ?? null,
    })),
    chats: chats.map((c) => ({
      id: c.id,
      startedAt: c.createdAt,
      endedAt: null,
      ticketId: c.ticketId,
      status: c.status,
    })),
    kbViews: [],
  };
}

function wrapperRoleNameToTeamRole(
  name: string | null,
  kind: "END_USER" | "TEAM_MEMBER"
): Role {
  if (kind === "END_USER") return "CLIENT";
  switch (name) {
    case "Super Admin":
      return "SUPER_ADMIN";
    case "Admin":
      return "ADMIN";
    default:
      return "AGENT";
  }
}

// ---------------------------------------------------------------------------
// Notes editor
// ---------------------------------------------------------------------------

const updateNotesSchema = z.object({
  userId: z.string().min(1),
  notes: z.string().max(4000).nullable(),
});

export async function updateUserNotes(
  input: z.infer<typeof updateNotesSchema>
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await requireSession({ minRole: "AGENT" });
  const parsed = updateNotesSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const { userId, notes } = parsed.data;
  const ctx = systemContext(session.tenantId);
  const [endUser, teamMember] = await Promise.all([
    getEndUser(ctx, userId),
    getTeamMember(ctx, userId),
  ]);
  if (!endUser && !teamMember) return { ok: false, error: "User not found." };

  await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      if (endUser) {
        await tx.endUserLifecycle.upsert({
          where: { subjectId: userId },
          create: {
            subjectId: userId,
            tenantId: session.tenantId,
            status: "ACTIVE",
            notes: notes,
          },
          update: { notes },
        });
      } else {
        await tx.teamMemberLifecycle.upsert({
          where: { subjectId: userId },
          create: {
            subjectId: userId,
            tenantId: session.tenantId,
            status: "ACTIVE",
            notes: notes,
          },
          update: { notes },
        });
      }
      await tx.auditLog.create({
        data: {
          tenantId: session.tenantId,
          ...actorCols(dualFkForUser(session.subjectId, session.role)),
          action: "UPDATE_USER_NOTES",
          toValue: userId,
        },
      });
    }
  );

  revalidatePath(`/admin/users/${userId}`);
  return { ok: true };
}
