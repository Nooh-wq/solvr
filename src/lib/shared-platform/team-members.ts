// TeamMember wrapper — replaces the AGENT/ADMIN/SUPER_ADMIN slice of the
// legacy User table. Also wraps TeamMemberGroup (group memberships).

import { Prisma } from "@/generated/prisma";
import { withRls } from "@/lib/db";
import type { WrapperContext } from "./context";
import type {
  CreateTeamMemberInput,
  Group,
  ListFilter,
  Page,
  TeamMember,
  UpdateTeamMemberInput,
} from "./types";
import {
  WrapperConflictError,
  WrapperNotFoundError,
  WrapperValidationError,
} from "./errors";
import { writeCoreAuditLogInTx } from "./audit";

// The reserved name of the Super Admin role, seeded per tenant by
// seedStandardRoles(). Used by the last-Super-Admin guard to find the
// right roleId at check time.
const SUPER_ADMIN_ROLE_NAME = "Super Admin";

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export async function getTeamMember(ctx: WrapperContext, id: string): Promise<TeamMember | null> {
  const row = await withRls(
    { tenantId: ctx.tenantId, userId: ctx.actor?.teamMemberId ?? null, role: "SUPER_ADMIN" },
    (tx) => tx.teamMember.findFirst({ where: { id, tenantId: ctx.tenantId } })
  );
  return row ? toDto(row) : null;
}

/**
 * Z1.5: fetches a TeamMember with its Role name joined in one query.
 * Callers that need the display role name (session, admin lookups) use this
 * to avoid two round-trips. `roleName` is the wrapper Role's canonical name
 * ("Super Admin" / "Admin" / "Agent" for standard, custom string otherwise).
 */
export async function getTeamMemberWithRoleName(
  ctx: WrapperContext,
  id: string
): Promise<(TeamMember & { roleName: string }) | null> {
  const row = await withRls(
    { tenantId: ctx.tenantId, userId: ctx.actor?.teamMemberId ?? null, role: "SUPER_ADMIN" },
    (tx) =>
      tx.teamMember.findFirst({
        where: { id, tenantId: ctx.tenantId },
        include: { role: { select: { name: true } } },
      })
  );
  if (!row) return null;
  return { ...toDto(row), roleName: row.role.name };
}

export async function listTeamMembers(
  ctx: WrapperContext,
  filter?: { roleId?: string; groupId?: string } & ListFilter
): Promise<Page<TeamMember>> {
  const limit = clampLimit(filter?.limit);
  const rows = await withRls(
    { tenantId: ctx.tenantId, userId: ctx.actor?.teamMemberId ?? null, role: "SUPER_ADMIN" },
    (tx) =>
      tx.teamMember.findMany({
        where: {
          tenantId: ctx.tenantId,
          ...(filter?.roleId && { roleId: filter.roleId }),
          ...(filter?.groupId && {
            groupMemberships: { some: { groupId: filter.groupId } },
          }),
          ...(filter?.search && {
            OR: [
              { email: { contains: filter.search, mode: "insensitive" } },
              { name: { contains: filter.search, mode: "insensitive" } },
            ],
          }),
        },
        orderBy: [{ email: "asc" }, { id: "asc" }],
        take: limit + 1,
        ...(filter?.cursor && { cursor: { id: filter.cursor }, skip: 1 }),
      })
  );
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  return {
    items: page.map(toDto),
    nextCursor: hasMore ? page[page.length - 1].id : null,
  };
}

export async function matchTeamMemberByEmail(
  ctx: WrapperContext,
  email: string
): Promise<TeamMember | null> {
  const row = await withRls(
    { tenantId: ctx.tenantId, userId: ctx.actor?.teamMemberId ?? null, role: "SUPER_ADMIN" },
    (tx) => tx.teamMember.findFirst({ where: { tenantId: ctx.tenantId, email } })
  );
  return row ? toDto(row) : null;
}

/**
 * Batch id lookup. Returns a Map keyed by id — callers can `.get(id)`
 * without needing to array-search. Missing ids are simply absent from
 * the Map. Empty input returns empty Map.
 *
 * Z1.4b addition — see docs/shared-platform-boundary.md §7.9.
 * Post-M7, this maps to `GET /api/v1/team-members?ids=...`.
 */
export async function getTeamMembersByIds(
  ctx: WrapperContext,
  ids: readonly string[]
): Promise<Map<string, TeamMember>> {
  if (ids.length === 0) return new Map();
  const rows = await withRls(
    { tenantId: ctx.tenantId, userId: ctx.actor?.teamMemberId ?? null, role: "SUPER_ADMIN" },
    (tx) =>
      tx.teamMember.findMany({
        where: { tenantId: ctx.tenantId, id: { in: [...ids] } },
      })
  );
  return new Map(rows.map((r) => [r.id, toDto(r)]));
}

/**
 * Count helper. Used internally by the last-Super-Admin guard and
 * exposed for admin dashboards / consumer checks.
 */
export async function countTeamMembersWithRole(
  ctx: WrapperContext,
  roleId: string
): Promise<number> {
  return withRls(
    { tenantId: ctx.tenantId, userId: ctx.actor?.teamMemberId ?? null, role: "SUPER_ADMIN" },
    (tx) => tx.teamMember.count({ where: { tenantId: ctx.tenantId, roleId } })
  );
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

export async function createTeamMember(
  ctx: WrapperContext,
  input: CreateTeamMemberInput
): Promise<TeamMember> {
  return withRls(
    { tenantId: ctx.tenantId, userId: ctx.actor?.teamMemberId ?? null, role: "SUPER_ADMIN" },
    async (tx) => {
      const role = await tx.role.findFirst({
        where: { id: input.roleId, tenantId: ctx.tenantId },
      });
      if (!role) {
        throw new WrapperValidationError(
          "INVALID_ROLE",
          `Role ${input.roleId} does not exist in this tenant.`
        );
      }
      try {
        const row = await tx.teamMember.create({
          data: {
            // input.id is set only by Z1.3 backfill (see types.ts note).
            ...(input.id && { id: input.id }),
            tenantId: ctx.tenantId,
            email: input.email,
            name: input.name ?? null,
            roleId: input.roleId,
            ...(input.ticketAccessScope && { ticketAccessScope: input.ticketAccessScope }),
          },
        });
        await writeCoreAuditLogInTx(tx, ctx, {
          action: "CREATE",
          resourceType: "TeamMember",
          resourceId: row.id,
          toValue: {
            email: row.email,
            name: row.name,
            roleId: row.roleId,
            ticketAccessScope: row.ticketAccessScope,
          },
        });
        return toDto(row);
      } catch (e) {
        throw translateUnique(e, "TeamMember", "email", input.email);
      }
    }
  );
}

export async function updateTeamMember(
  ctx: WrapperContext,
  id: string,
  patch: UpdateTeamMemberInput
): Promise<TeamMember> {
  return withRls(
    { tenantId: ctx.tenantId, userId: ctx.actor?.teamMemberId ?? null, role: "SUPER_ADMIN" },
    async (tx) => {
      const existing = await tx.teamMember.findFirst({
        where: { id, tenantId: ctx.tenantId },
      });
      if (!existing) throw new WrapperNotFoundError("TeamMember", id);

      // Guard: last-Super-Admin lockout.
      // Established by Team & Roles v2 §1.1 (PR #21), carries into Z1
      // unchanged — a tenant must never end up with zero Super Admins.
      // If the caller is trying to move this member OFF Super Admin AND
      // they are the sole Super Admin, reject.
      if (patch.roleId !== undefined && patch.roleId !== existing.roleId) {
        const superAdminRole = await tx.role.findFirst({
          where: { tenantId: ctx.tenantId, name: SUPER_ADMIN_ROLE_NAME },
        });
        if (superAdminRole && existing.roleId === superAdminRole.id) {
          const count = await tx.teamMember.count({
            where: { tenantId: ctx.tenantId, roleId: superAdminRole.id },
          });
          if (count <= 1) {
            throw new WrapperValidationError(
              "LAST_SUPER_ADMIN",
              "Cannot change role: this is the last Super Admin on the tenant. Promote another member to Super Admin first."
            );
          }
        }
        // Also validate the target roleId exists in this tenant.
        const nextRole = await tx.role.findFirst({
          where: { id: patch.roleId, tenantId: ctx.tenantId },
        });
        if (!nextRole) {
          throw new WrapperValidationError(
            "INVALID_ROLE",
            `Role ${patch.roleId} does not exist in this tenant.`
          );
        }
      }

      try {
        const updated = await tx.teamMember.update({
          where: { id },
          data: {
            ...(patch.email !== undefined && { email: patch.email }),
            ...(patch.name !== undefined && { name: patch.name }),
            ...(patch.roleId !== undefined && { roleId: patch.roleId }),
            ...(patch.ticketAccessScope !== undefined && {
              ticketAccessScope: patch.ticketAccessScope,
            }),
          },
        });
        await writeCoreAuditLogInTx(tx, ctx, {
          action: "UPDATE",
          resourceType: "TeamMember",
          resourceId: id,
          fromValue: {
            email: existing.email,
            name: existing.name,
            roleId: existing.roleId,
            ticketAccessScope: existing.ticketAccessScope,
          },
          toValue: {
            email: updated.email,
            name: updated.name,
            roleId: updated.roleId,
            ticketAccessScope: updated.ticketAccessScope,
          },
        });
        return toDto(updated);
      } catch (e) {
        if (patch.email !== undefined) throw translateUnique(e, "TeamMember", "email", patch.email);
        throw e;
      }
    }
  );
}

export async function deleteTeamMember(ctx: WrapperContext, id: string): Promise<void> {
  await withRls(
    { tenantId: ctx.tenantId, userId: ctx.actor?.teamMemberId ?? null, role: "SUPER_ADMIN" },
    async (tx) => {
      const existing = await tx.teamMember.findFirst({
        where: { id, tenantId: ctx.tenantId },
      });
      if (!existing) throw new WrapperNotFoundError("TeamMember", id);

      // Guard: last-Super-Admin lockout (same origin/reason as above).
      const superAdminRole = await tx.role.findFirst({
        where: { tenantId: ctx.tenantId, name: SUPER_ADMIN_ROLE_NAME },
      });
      if (superAdminRole && existing.roleId === superAdminRole.id) {
        const count = await tx.teamMember.count({
          where: { tenantId: ctx.tenantId, roleId: superAdminRole.id },
        });
        if (count <= 1) {
          throw new WrapperValidationError(
            "LAST_SUPER_ADMIN",
            "Cannot delete the last Super Admin on the tenant. Promote another member to Super Admin first."
          );
        }
      }

      // DB cascade: team_member_groups rows removed automatically.
      await tx.teamMember.delete({ where: { id } });
      await writeCoreAuditLogInTx(tx, ctx, {
        action: "DELETE",
        resourceType: "TeamMember",
        resourceId: id,
        fromValue: {
          email: existing.email,
          name: existing.name,
          roleId: existing.roleId,
          ticketAccessScope: existing.ticketAccessScope,
        },
      });
    }
  );
}

/**
 * Backfill helper. Idempotent by (tenantId, email). PATCH-style
 * overwrite semantics — see upsertEndUserByEmail for the full rule and
 * rationale.
 */
export async function upsertTeamMemberByEmail(
  ctx: WrapperContext,
  email: string,
  input: Omit<CreateTeamMemberInput, "email">
): Promise<TeamMember> {
  return withRls(
    { tenantId: ctx.tenantId, userId: ctx.actor?.teamMemberId ?? null, role: "SUPER_ADMIN" },
    async (tx) => {
      const role = await tx.role.findFirst({
        where: { id: input.roleId, tenantId: ctx.tenantId },
      });
      if (!role) {
        throw new WrapperValidationError(
          "INVALID_ROLE",
          `Role ${input.roleId} does not exist in this tenant.`
        );
      }
      const existing = await tx.teamMember.findFirst({
        where: { tenantId: ctx.tenantId, email },
      });
      if (!existing) {
        const row = await tx.teamMember.create({
          data: {
            ...(input.id && { id: input.id }),
            tenantId: ctx.tenantId,
            email,
            name: input.name ?? null,
            roleId: input.roleId,
            ...(input.ticketAccessScope && { ticketAccessScope: input.ticketAccessScope }),
          },
        });
        await writeCoreAuditLogInTx(tx, ctx, {
          action: "CREATE",
          resourceType: "TeamMember",
          resourceId: row.id,
          toValue: {
            email: row.email,
            name: row.name,
            roleId: row.roleId,
            ticketAccessScope: row.ticketAccessScope,
          },
        });
        return toDto(row);
      }
      const nextName = "name" in input ? (input.name ?? null) : existing.name;
      const nextRoleId = "roleId" in input ? input.roleId : existing.roleId;
      const nextScope =
        "ticketAccessScope" in input && input.ticketAccessScope !== undefined
          ? input.ticketAccessScope
          : existing.ticketAccessScope;

      const nameChanged = nextName !== existing.name;
      const roleChanged = nextRoleId !== existing.roleId;
      const scopeChanged = nextScope !== existing.ticketAccessScope;

      if (!nameChanged && !roleChanged && !scopeChanged) return toDto(existing);

      // If the upsert would demote this member OFF Super Admin and
      // they are the sole Super Admin, reject — same last-Super-Admin
      // guard as updateTeamMember.
      if (roleChanged) {
        const superAdminRole = await tx.role.findFirst({
          where: { tenantId: ctx.tenantId, name: SUPER_ADMIN_ROLE_NAME },
        });
        if (superAdminRole && existing.roleId === superAdminRole.id) {
          const count = await tx.teamMember.count({
            where: { tenantId: ctx.tenantId, roleId: superAdminRole.id },
          });
          if (count <= 1) {
            throw new WrapperValidationError(
              "LAST_SUPER_ADMIN",
              "Cannot change role via upsert: this is the last Super Admin on the tenant. Promote another member to Super Admin first."
            );
          }
        }
      }

      const updated = await tx.teamMember.update({
        where: { id: existing.id },
        data: {
          ...(nameChanged && { name: nextName }),
          ...(roleChanged && { roleId: nextRoleId }),
          ...(scopeChanged && { ticketAccessScope: nextScope }),
        },
      });
      await writeCoreAuditLogInTx(tx, ctx, {
        action: "UPDATE",
        resourceType: "TeamMember",
        resourceId: updated.id,
        fromValue: {
          name: existing.name,
          roleId: existing.roleId,
          ticketAccessScope: existing.ticketAccessScope,
        },
        toValue: {
          name: updated.name,
          roleId: updated.roleId,
          ticketAccessScope: updated.ticketAccessScope,
        },
      });
      return toDto(updated);
    }
  );
}

// ---------------------------------------------------------------------------
// Group membership (TeamMemberGroup)
// ---------------------------------------------------------------------------

export async function assignTeamMemberToGroup(
  ctx: WrapperContext,
  teamMemberId: string,
  groupId: string
): Promise<void> {
  await withRls(
    { tenantId: ctx.tenantId, userId: ctx.actor?.teamMemberId ?? null, role: "SUPER_ADMIN" },
    async (tx) => {
      const tm = await tx.teamMember.findFirst({
        where: { id: teamMemberId, tenantId: ctx.tenantId },
      });
      if (!tm) throw new WrapperNotFoundError("TeamMember", teamMemberId);
      const g = await tx.group.findFirst({ where: { id: groupId, tenantId: ctx.tenantId } });
      if (!g) throw new WrapperNotFoundError("Group", groupId);
      const existing = await tx.teamMemberGroup.findUnique({
        where: { teamMemberId_groupId: { teamMemberId, groupId } },
      });
      if (existing) return; // idempotent no-op
      await tx.teamMemberGroup.create({
        data: { teamMemberId, groupId, tenantId: ctx.tenantId },
      });
      await writeCoreAuditLogInTx(tx, ctx, {
        action: "ASSIGN",
        resourceType: "TeamMemberGroup",
        resourceId: `${teamMemberId}:${groupId}`,
        toValue: { teamMemberId, groupId },
      });
    }
  );
}

export async function removeTeamMemberFromGroup(
  ctx: WrapperContext,
  teamMemberId: string,
  groupId: string
): Promise<void> {
  await withRls(
    { tenantId: ctx.tenantId, userId: ctx.actor?.teamMemberId ?? null, role: "SUPER_ADMIN" },
    async (tx) => {
      const existing = await tx.teamMemberGroup.findUnique({
        where: { teamMemberId_groupId: { teamMemberId, groupId } },
      });
      if (!existing) return; // idempotent no-op
      if (existing.tenantId !== ctx.tenantId) return; // belt-and-braces
      await tx.teamMemberGroup.delete({
        where: { teamMemberId_groupId: { teamMemberId, groupId } },
      });
      await writeCoreAuditLogInTx(tx, ctx, {
        action: "UNASSIGN",
        resourceType: "TeamMemberGroup",
        resourceId: `${teamMemberId}:${groupId}`,
        fromValue: { teamMemberId, groupId },
      });
    }
  );
}

export async function listGroupsForTeamMember(
  ctx: WrapperContext,
  teamMemberId: string
): Promise<Group[]> {
  return withRls(
    { tenantId: ctx.tenantId, userId: ctx.actor?.teamMemberId ?? null, role: "SUPER_ADMIN" },
    async (tx) => {
      const memberships = await tx.teamMemberGroup.findMany({
        where: { teamMemberId, tenantId: ctx.tenantId },
        include: { group: true },
        orderBy: { group: { name: "asc" } },
      });
      return memberships.map((m) => toGroupDto(m.group));
    }
  );
}

export async function listTeamMembersInGroup(
  ctx: WrapperContext,
  groupId: string
): Promise<TeamMember[]> {
  return withRls(
    { tenantId: ctx.tenantId, userId: ctx.actor?.teamMemberId ?? null, role: "SUPER_ADMIN" },
    async (tx) => {
      const memberships = await tx.teamMemberGroup.findMany({
        where: { groupId, tenantId: ctx.tenantId },
        include: { teamMember: true },
        orderBy: { teamMember: { email: "asc" } },
      });
      return memberships.map((m) => toDto(m.teamMember));
    }
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toDto(row: {
  id: string;
  tenantId: string;
  email: string;
  name: string | null;
  roleId: string;
  ticketAccessScope: "ALL" | "GROUPS" | "ASSIGNED_ONLY";
  createdAt: Date;
  updatedAt: Date;
}): TeamMember {
  return {
    id: row.id,
    tenantId: row.tenantId,
    email: row.email,
    name: row.name,
    roleId: row.roleId,
    ticketAccessScope: row.ticketAccessScope,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toGroupDto(row: {
  id: string;
  tenantId: string;
  name: string;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}): Group {
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    isDefault: row.isDefault,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function translateUnique(e: unknown, resourceType: string, field: string, value: string): unknown {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
    return new WrapperConflictError(resourceType, field, value);
  }
  return e;
}

function clampLimit(limit?: number): number {
  return Math.min(Math.max(limit ?? 50, 1), 200);
}
