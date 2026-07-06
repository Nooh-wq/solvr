// Group wrapper. Every tenant seeds a default "Support" group during Z1.3
// backfill; that invariant is enforced by the guards below.
//
// One-default-per-tenant invariant is enforced APP-SIDE today. The
// matching DB-level partial unique index lives in a Shared-Platform-
// owned migration that has not yet shipped — see
// docs/shared-platform-boundary.md §7.4 for the exact SQL and the
// coordination note. Once that ships, these guards become friendly-
// error UX layered on top of a hard DB backstop.

import { Prisma } from "@/generated/prisma";
import { withRls } from "@/lib/db";
import type { WrapperContext } from "./context";
import type { CreateGroupInput, Group, UpdateGroupInput } from "./types";
import {
  WrapperConflictError,
  WrapperNotFoundError,
  WrapperValidationError,
} from "./errors";
import { writeCoreAuditLogInTx } from "./audit";

const DEFAULT_GROUP_NAME = "Support";

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export async function getGroup(ctx: WrapperContext, id: string): Promise<Group | null> {
  const row = await withRls(
    { tenantId: ctx.tenantId, userId: ctx.actor?.teamMemberId ?? null, role: "SUPER_ADMIN" },
    (tx) => tx.group.findFirst({ where: { id, tenantId: ctx.tenantId } })
  );
  return row ? toDto(row) : null;
}

/**
 * Plain lookup of the tenant's default group. Returns null if no
 * default has been seeded yet (fresh tenant, pre-Z1.3 backfill).
 */
export async function getDefaultGroup(ctx: WrapperContext): Promise<Group | null> {
  const row = await withRls(
    { tenantId: ctx.tenantId, userId: ctx.actor?.teamMemberId ?? null, role: "SUPER_ADMIN" },
    (tx) => tx.group.findFirst({ where: { tenantId: ctx.tenantId, isDefault: true } })
  );
  return row ? toDto(row) : null;
}

/**
 * Provisioning helper. Returns the existing default group if one
 * exists; otherwise creates one named "Support" with isDefault:true.
 * Idempotent. Called from Z1.3 backfill (per tenant) and going forward
 * from any tenant provisioning flow.
 */
export async function getOrCreateDefaultGroup(ctx: WrapperContext): Promise<Group> {
  return withRls(
    { tenantId: ctx.tenantId, userId: ctx.actor?.teamMemberId ?? null, role: "SUPER_ADMIN" },
    async (tx) => {
      const existing = await tx.group.findFirst({
        where: { tenantId: ctx.tenantId, isDefault: true },
      });
      if (existing) return toDto(existing);
      const row = await tx.group.create({
        data: {
          tenantId: ctx.tenantId,
          name: DEFAULT_GROUP_NAME,
          isDefault: true,
        },
      });
      await writeCoreAuditLogInTx(tx, ctx, {
        action: "CREATE",
        resourceType: "Group",
        resourceId: row.id,
        toValue: { name: row.name, isDefault: row.isDefault },
      });
      return toDto(row);
    }
  );
}

export async function listGroups(ctx: WrapperContext): Promise<Group[]> {
  return withRls(
    { tenantId: ctx.tenantId, userId: ctx.actor?.teamMemberId ?? null, role: "SUPER_ADMIN" },
    async (tx) => {
      const rows = await tx.group.findMany({
        where: { tenantId: ctx.tenantId },
        orderBy: [{ isDefault: "desc" }, { name: "asc" }],
      });
      return rows.map(toDto);
    }
  );
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

/**
 * Creates a Group. If `input.isDefault === true`:
 *   Guard: DUPLICATE_DEFAULT_GROUP — reject if any default group
 *   already exists on this tenant. Callers wanting to switch which
 *   group is default should call updateGroup(newDefaultId, {
 *   isDefault: true }) instead — that's the promotion path with
 *   atomic demotion. See docs/shared-platform-boundary.md §7.4 for the
 *   coordinated DB-level backstop planned in Shared Platform.
 */
export async function createGroup(
  ctx: WrapperContext,
  input: CreateGroupInput
): Promise<Group> {
  return withRls(
    { tenantId: ctx.tenantId, userId: ctx.actor?.teamMemberId ?? null, role: "SUPER_ADMIN" },
    async (tx) => {
      if (input.isDefault === true) {
        const existing = await tx.group.findFirst({
          where: { tenantId: ctx.tenantId, isDefault: true },
        });
        if (existing) {
          throw new WrapperValidationError(
            "DUPLICATE_DEFAULT_GROUP",
            "A default group already exists on this tenant. Use updateGroup(newId, { isDefault: true }) to switch which group is default."
          );
        }
      }
      try {
        const row = await tx.group.create({
          data: {
            tenantId: ctx.tenantId,
            name: input.name,
            isDefault: input.isDefault ?? false,
          },
        });
        await writeCoreAuditLogInTx(tx, ctx, {
          action: "CREATE",
          resourceType: "Group",
          resourceId: row.id,
          toValue: { name: row.name, isDefault: row.isDefault },
        });
        return toDto(row);
      } catch (e) {
        throw translateUnique(e, "Group", "name", input.name);
      }
    }
  );
}

/**
 * Updates a Group.
 *
 * `patch.isDefault: true` promotes this group to default AND atomically
 * demotes any other default group on the same tenant in the same
 * transaction — no reader ever sees two `isDefault: true` groups.
 *
 * `patch.isDefault: false` on the current default is REJECTED
 * (CANNOT_UNSET_LAST_DEFAULT_GROUP) — a tenant must never have zero
 * default groups. To move the default elsewhere, promote another group
 * (which cascades the demotion). Setting `isDefault: false` on a
 * group that is already not-default is a no-op.
 */
export async function updateGroup(
  ctx: WrapperContext,
  id: string,
  patch: UpdateGroupInput
): Promise<Group> {
  return withRls(
    { tenantId: ctx.tenantId, userId: ctx.actor?.teamMemberId ?? null, role: "SUPER_ADMIN" },
    async (tx) => {
      const existing = await tx.group.findFirst({ where: { id, tenantId: ctx.tenantId } });
      if (!existing) throw new WrapperNotFoundError("Group", id);

      // Guard: cannot unset the last default group.
      if (patch.isDefault === false && existing.isDefault) {
        throw new WrapperValidationError(
          "CANNOT_UNSET_LAST_DEFAULT_GROUP",
          "Cannot unset the default flag on the tenant's only default group. Promote another group first."
        );
      }

      // Atomic promotion: if patch.isDefault === true AND this group is
      // not currently the default, find the current default (if any)
      // and demote it in the same transaction so no reader ever sees
      // two defaults simultaneously.
      if (patch.isDefault === true && !existing.isDefault) {
        const currentDefault = await tx.group.findFirst({
          where: { tenantId: ctx.tenantId, isDefault: true },
        });
        if (currentDefault) {
          await tx.group.update({
            where: { id: currentDefault.id },
            data: { isDefault: false },
          });
          await writeCoreAuditLogInTx(tx, ctx, {
            action: "DEMOTE_DEFAULT",
            resourceType: "Group",
            resourceId: currentDefault.id,
            fromValue: { isDefault: true },
            toValue: { isDefault: false },
          });
        }
      }

      try {
        const updated = await tx.group.update({
          where: { id },
          data: {
            ...(patch.name !== undefined && { name: patch.name }),
            ...(patch.isDefault !== undefined && { isDefault: patch.isDefault }),
          },
        });
        await writeCoreAuditLogInTx(tx, ctx, {
          action: "UPDATE",
          resourceType: "Group",
          resourceId: id,
          fromValue: { name: existing.name, isDefault: existing.isDefault },
          toValue: { name: updated.name, isDefault: updated.isDefault },
        });
        return toDto(updated);
      } catch (e) {
        throw translateUnique(e, "Group", "name", patch.name ?? existing.name);
      }
    }
  );
}

/**
 * Guard: DEFAULT_GROUP_DELETE — refuses to delete a group with
 * isDefault:true. Established by Z1 milestone §3 (seed a default
 * "Support" group per tenant) + the "every team member belongs to ≥1
 * group" invariant. Callers should promote another group first
 * (updateGroup(otherId, { isDefault: true })), which cascades the
 * demotion, then re-attempt the delete.
 */
export async function deleteGroup(ctx: WrapperContext, id: string): Promise<void> {
  await withRls(
    { tenantId: ctx.tenantId, userId: ctx.actor?.teamMemberId ?? null, role: "SUPER_ADMIN" },
    async (tx) => {
      const existing = await tx.group.findFirst({ where: { id, tenantId: ctx.tenantId } });
      if (!existing) throw new WrapperNotFoundError("Group", id);
      if (existing.isDefault) {
        throw new WrapperValidationError(
          "DEFAULT_GROUP_DELETE",
          "Cannot delete the tenant's default group. Promote another group first."
        );
      }
      await tx.group.delete({ where: { id } });
      await writeCoreAuditLogInTx(tx, ctx, {
        action: "DELETE",
        resourceType: "Group",
        resourceId: id,
        fromValue: { name: existing.name, isDefault: existing.isDefault },
      });
    }
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toDto(row: {
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
