// Tag wrapper + polymorphic TagAssignment.
//
// TagAssignment.targetType is END_USER | TEAM_MEMBER | ORGANIZATION.
// The wrapper checks the target row exists in the caller's tenant
// before assigning — RLS makes cross-tenant targets invisible, so this
// naturally rejects cross-tenant assignments as WrapperNotFoundError.

import { Prisma } from "@/generated/prisma";
import { withRls } from "@/lib/db";
import type { WrapperContext } from "./context";
import type { CreateTagInput, Tag, TagAssignment, TagTargetType, UpdateTagInput } from "./types";
import { WrapperConflictError, WrapperNotFoundError } from "./errors";
import { writeCoreAuditLogInTx } from "./audit";

const DEFAULT_TAG_COLOR = "#7A7A7A";

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export async function getTag(ctx: WrapperContext, id: string): Promise<Tag | null> {
  const row = await withRls(
    { tenantId: ctx.tenantId, userId: ctx.actor?.teamMemberId ?? null, role: "SUPER_ADMIN" },
    (tx) => tx.tag.findFirst({ where: { id, tenantId: ctx.tenantId } })
  );
  return row ? toDto(row) : null;
}

export async function listTags(ctx: WrapperContext): Promise<Tag[]> {
  return withRls(
    { tenantId: ctx.tenantId, userId: ctx.actor?.teamMemberId ?? null, role: "SUPER_ADMIN" },
    async (tx) => {
      const rows = await tx.tag.findMany({
        where: { tenantId: ctx.tenantId },
        orderBy: { name: "asc" },
      });
      return rows.map(toDto);
    }
  );
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

export async function createTag(ctx: WrapperContext, input: CreateTagInput): Promise<Tag> {
  return withRls(
    { tenantId: ctx.tenantId, userId: ctx.actor?.teamMemberId ?? null, role: "SUPER_ADMIN" },
    async (tx) => {
      try {
        const row = await tx.tag.create({
          data: {
            tenantId: ctx.tenantId,
            name: input.name,
            color: input.color ?? DEFAULT_TAG_COLOR,
          },
        });
        await writeCoreAuditLogInTx(tx, ctx, {
          action: "CREATE",
          resourceType: "Tag",
          resourceId: row.id,
          toValue: { name: row.name, color: row.color },
        });
        return toDto(row);
      } catch (e) {
        throw translateUnique(e, "Tag", "name", input.name);
      }
    }
  );
}

export async function updateTag(
  ctx: WrapperContext,
  id: string,
  patch: UpdateTagInput
): Promise<Tag> {
  return withRls(
    { tenantId: ctx.tenantId, userId: ctx.actor?.teamMemberId ?? null, role: "SUPER_ADMIN" },
    async (tx) => {
      const existing = await tx.tag.findFirst({ where: { id, tenantId: ctx.tenantId } });
      if (!existing) throw new WrapperNotFoundError("Tag", id);
      try {
        const updated = await tx.tag.update({
          where: { id },
          data: {
            ...(patch.name !== undefined && { name: patch.name }),
            ...(patch.color !== undefined && { color: patch.color }),
          },
        });
        await writeCoreAuditLogInTx(tx, ctx, {
          action: "UPDATE",
          resourceType: "Tag",
          resourceId: id,
          fromValue: { name: existing.name, color: existing.color },
          toValue: { name: updated.name, color: updated.color },
        });
        return toDto(updated);
      } catch (e) {
        throw translateUnique(e, "Tag", "name", patch.name ?? existing.name);
      }
    }
  );
}

export async function deleteTag(ctx: WrapperContext, id: string): Promise<void> {
  await withRls(
    { tenantId: ctx.tenantId, userId: ctx.actor?.teamMemberId ?? null, role: "SUPER_ADMIN" },
    async (tx) => {
      const existing = await tx.tag.findFirst({ where: { id, tenantId: ctx.tenantId } });
      if (!existing) throw new WrapperNotFoundError("Tag", id);
      // DB cascade: TagAssignment rows removed automatically.
      await tx.tag.delete({ where: { id } });
      await writeCoreAuditLogInTx(tx, ctx, {
        action: "DELETE",
        resourceType: "Tag",
        resourceId: id,
        fromValue: { name: existing.name, color: existing.color },
      });
    }
  );
}

// ---------------------------------------------------------------------------
// Polymorphic assignment
// ---------------------------------------------------------------------------

/**
 * Assign a Tag to a target. Idempotent — re-calling with the same tag +
 * target is a no-op (no audit row for the no-op). Both the tag and the
 * target must exist in ctx.tenantId — RLS makes cross-tenant targets
 * invisible, so a cross-tenant assign attempt throws
 * WrapperNotFoundError before any write.
 */
export async function assignTag(
  ctx: WrapperContext,
  tagId: string,
  target: { type: TagTargetType; id: string }
): Promise<TagAssignment> {
  return withRls(
    { tenantId: ctx.tenantId, userId: ctx.actor?.teamMemberId ?? null, role: "SUPER_ADMIN" },
    async (tx) => {
      const tag = await tx.tag.findFirst({ where: { id: tagId, tenantId: ctx.tenantId } });
      if (!tag) throw new WrapperNotFoundError("Tag", tagId);
      await assertTargetExists(tx, ctx.tenantId, target);

      const existing = await tx.tagAssignment.findUnique({
        where: {
          tenantId_tagId_targetType_targetId: {
            tenantId: ctx.tenantId,
            tagId,
            targetType: target.type,
            targetId: target.id,
          },
        },
      });
      if (existing) return toAssignmentDto(existing);
      const row = await tx.tagAssignment.create({
        data: {
          tenantId: ctx.tenantId,
          tagId,
          targetType: target.type,
          targetId: target.id,
        },
      });
      await writeCoreAuditLogInTx(tx, ctx, {
        action: "ASSIGN",
        resourceType: "TagAssignment",
        resourceId: row.id,
        toValue: { tagId, targetType: target.type, targetId: target.id },
      });
      return toAssignmentDto(row);
    }
  );
}

export async function unassignTag(
  ctx: WrapperContext,
  tagId: string,
  target: { type: TagTargetType; id: string }
): Promise<void> {
  await withRls(
    { tenantId: ctx.tenantId, userId: ctx.actor?.teamMemberId ?? null, role: "SUPER_ADMIN" },
    async (tx) => {
      const existing = await tx.tagAssignment.findUnique({
        where: {
          tenantId_tagId_targetType_targetId: {
            tenantId: ctx.tenantId,
            tagId,
            targetType: target.type,
            targetId: target.id,
          },
        },
      });
      if (!existing) return; // idempotent no-op
      await tx.tagAssignment.delete({ where: { id: existing.id } });
      await writeCoreAuditLogInTx(tx, ctx, {
        action: "UNASSIGN",
        resourceType: "TagAssignment",
        resourceId: existing.id,
        fromValue: { tagId, targetType: target.type, targetId: target.id },
      });
    }
  );
}

export async function listTagsForTarget(
  ctx: WrapperContext,
  target: { type: TagTargetType; id: string }
): Promise<Tag[]> {
  return withRls(
    { tenantId: ctx.tenantId, userId: ctx.actor?.teamMemberId ?? null, role: "SUPER_ADMIN" },
    async (tx) => {
      const assignments = await tx.tagAssignment.findMany({
        where: {
          tenantId: ctx.tenantId,
          targetType: target.type,
          targetId: target.id,
        },
        include: { tag: true },
        orderBy: { tag: { name: "asc" } },
      });
      return assignments.map((a) => toDto(a.tag));
    }
  );
}

export async function listTargetsForTag(
  ctx: WrapperContext,
  tagId: string,
  targetType?: TagTargetType
): Promise<{ id: string; type: TagTargetType }[]> {
  return withRls(
    { tenantId: ctx.tenantId, userId: ctx.actor?.teamMemberId ?? null, role: "SUPER_ADMIN" },
    async (tx) => {
      const assignments = await tx.tagAssignment.findMany({
        where: {
          tenantId: ctx.tenantId,
          tagId,
          ...(targetType && { targetType }),
        },
        orderBy: [{ targetType: "asc" }, { targetId: "asc" }],
      });
      return assignments.map((a) => ({
        id: a.targetId,
        type: a.targetType as TagTargetType,
      }));
    }
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function assertTargetExists(
  tx: Prisma.TransactionClient,
  tenantId: string,
  target: { type: TagTargetType; id: string }
): Promise<void> {
  let exists = false;
  switch (target.type) {
    case "END_USER":
      exists = !!(await tx.endUser.findFirst({ where: { id: target.id, tenantId } }));
      break;
    case "TEAM_MEMBER":
      exists = !!(await tx.teamMember.findFirst({ where: { id: target.id, tenantId } }));
      break;
    case "ORGANIZATION":
      exists = !!(await tx.organization.findFirst({ where: { id: target.id, tenantId } }));
      break;
    // Z8 added TICKET so add_tag rule actions can attach tags to
    // tickets. Tickets are Support-owned but visible on the shared
    // Prisma client because the schemas mirror into one database.
    case "TICKET":
      exists = !!(await tx.ticket.findFirst({ where: { id: target.id, tenantId } }));
      break;
  }
  if (!exists) throw new WrapperNotFoundError(resourceForTargetType(target.type), target.id);
}

function resourceForTargetType(t: TagTargetType): string {
  switch (t) {
    case "END_USER":
      return "EndUser";
    case "TEAM_MEMBER":
      return "TeamMember";
    case "ORGANIZATION":
      return "Organization";
    case "TICKET":
      return "Ticket";
  }
}

function toDto(row: {
  id: string;
  tenantId: string;
  name: string;
  color: string;
  createdAt: Date;
  updatedAt: Date;
}): Tag {
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    color: row.color,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toAssignmentDto(row: {
  id: string;
  tenantId: string;
  tagId: string;
  // TagTargetType widened in Z8 to include TICKET so `add_tag` rule
  // actions can attach tags to ticket rows. The DTO surface has to
  // widen with it — narrowing here silently rejected TICKET-scoped
  // rows.
  targetType: TagTargetType;
  targetId: string;
  createdAt: Date;
}): TagAssignment {
  return {
    id: row.id,
    tenantId: row.tenantId,
    tagId: row.tagId,
    targetType: row.targetType,
    targetId: row.targetId,
    createdAt: row.createdAt,
  };
}

function translateUnique(e: unknown, resourceType: string, field: string, value: string): unknown {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
    return new WrapperConflictError(resourceType, field, value);
  }
  return e;
}
