// Role wrapper. Replaces the legacy `LegacyRole` enum with per-tenant
// rows. Every tenant is seeded with 3 standard roles by
// seedStandardRoles(); those rows have isCustom:false and are immutable
// through updateRole/deleteRole.

import { Prisma } from "@/generated/prisma";
import { withRls } from "@/lib/db";
import type { WrapperContext } from "./context";
import type { CreateRoleInput, Role, UpdateRoleInput } from "./types";
import {
  WrapperConflictError,
  WrapperNotFoundError,
  WrapperValidationError,
} from "./errors";
import { writeCoreAuditLogInTx } from "./audit";

// Standard-role names seeded per tenant by seedStandardRoles(). Order
// matters only for stable seedStandardRoles() return ordering. Z5
// (Access Scoping, Custom Roles & Light Agent) may add "Light Agent" —
// extending this list is Z5's job; Z1.2 only ships the current three.
const STANDARD_ROLE_NAMES = ["Super Admin", "Admin", "Agent"] as const;

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export async function getRole(ctx: WrapperContext, id: string): Promise<Role | null> {
  const row = await withRls(
    { tenantId: ctx.tenantId, userId: ctx.actor?.teamMemberId ?? null, role: "SUPER_ADMIN" },
    (tx) => tx.role.findFirst({ where: { id, tenantId: ctx.tenantId } })
  );
  return row ? toDto(row) : null;
}

export async function getRoleByName(ctx: WrapperContext, name: string): Promise<Role | null> {
  const row = await withRls(
    { tenantId: ctx.tenantId, userId: ctx.actor?.teamMemberId ?? null, role: "SUPER_ADMIN" },
    (tx) => tx.role.findFirst({ where: { tenantId: ctx.tenantId, name } })
  );
  return row ? toDto(row) : null;
}

export async function listRoles(ctx: WrapperContext): Promise<Role[]> {
  return withRls(
    { tenantId: ctx.tenantId, userId: ctx.actor?.teamMemberId ?? null, role: "SUPER_ADMIN" },
    async (tx) => {
      const rows = await tx.role.findMany({
        where: { tenantId: ctx.tenantId },
        orderBy: [{ isCustom: "asc" }, { name: "asc" }],
      });
      return rows.map(toDto);
    }
  );
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

/**
 * Creates a custom role. `isCustom` is forced to `true` — standard
 * roles can only be created through seedStandardRoles().
 */
export async function createRole(
  ctx: WrapperContext,
  input: CreateRoleInput
): Promise<Role> {
  return withRls(
    { tenantId: ctx.tenantId, userId: ctx.actor?.teamMemberId ?? null, role: "SUPER_ADMIN" },
    async (tx) => {
      try {
        const row = await tx.role.create({
          data: {
            tenantId: ctx.tenantId,
            name: input.name,
            isCustom: true,
            permissions: (input.permissions ?? {}) as Prisma.InputJsonValue,
          },
        });
        await writeCoreAuditLogInTx(tx, ctx, {
          action: "CREATE",
          resourceType: "Role",
          resourceId: row.id,
          toValue: { name: row.name, isCustom: row.isCustom },
        });
        return toDto(row);
      } catch (e) {
        throw translateUnique(e, "Role", "name", input.name);
      }
    }
  );
}

/**
 * Guard: STANDARD_ROLE_MODIFY — rejects if the target has
 * isCustom:false. Established by Z1 milestone §5.1.3 (seedStandardRoles
 * ships standard roles once per tenant) + Z5 (Custom Roles) assumes
 * standard-role names/permissions are stable so downstream logic can
 * key off them.
 */
export async function updateRole(
  ctx: WrapperContext,
  id: string,
  patch: UpdateRoleInput
): Promise<Role> {
  return withRls(
    { tenantId: ctx.tenantId, userId: ctx.actor?.teamMemberId ?? null, role: "SUPER_ADMIN" },
    async (tx) => {
      const existing = await tx.role.findFirst({ where: { id, tenantId: ctx.tenantId } });
      if (!existing) throw new WrapperNotFoundError("Role", id);
      if (!existing.isCustom) {
        throw new WrapperValidationError(
          "STANDARD_ROLE_MODIFY",
          `Standard roles are immutable. Role "${existing.name}" cannot be edited.`
        );
      }
      try {
        const updated = await tx.role.update({
          where: { id },
          data: {
            ...(patch.name !== undefined && { name: patch.name }),
            ...(patch.permissions !== undefined && {
              permissions: patch.permissions as Prisma.InputJsonValue,
            }),
          },
        });
        await writeCoreAuditLogInTx(tx, ctx, {
          action: "UPDATE",
          resourceType: "Role",
          resourceId: id,
          fromValue: { name: existing.name },
          toValue: { name: updated.name },
        });
        return toDto(updated);
      } catch (e) {
        throw translateUnique(e, "Role", "name", patch.name ?? existing.name);
      }
    }
  );
}

/**
 * Two guards:
 *   - STANDARD_ROLE_MODIFY (same origin as updateRole).
 *   - ROLE_IN_USE — DB-level backstop is team_members.roleId
 *     ON DELETE RESTRICT (verified live against Supabase for Z1.2 —
 *     see PR body). This app-level count check surfaces a friendlier
 *     error before Postgres rejects. Callers should reassign the
 *     dependent TeamMembers first, then retry.
 */
export async function deleteRole(ctx: WrapperContext, id: string): Promise<void> {
  await withRls(
    { tenantId: ctx.tenantId, userId: ctx.actor?.teamMemberId ?? null, role: "SUPER_ADMIN" },
    async (tx) => {
      const existing = await tx.role.findFirst({ where: { id, tenantId: ctx.tenantId } });
      if (!existing) throw new WrapperNotFoundError("Role", id);
      if (!existing.isCustom) {
        throw new WrapperValidationError(
          "STANDARD_ROLE_MODIFY",
          `Standard roles cannot be deleted. Role "${existing.name}" is a standard role.`
        );
      }
      const inUse = await tx.teamMember.count({
        where: { tenantId: ctx.tenantId, roleId: id },
      });
      if (inUse > 0) {
        throw new WrapperValidationError(
          "ROLE_IN_USE",
          `Cannot delete role "${existing.name}": ${inUse} team member${
            inUse === 1 ? "" : "s"
          } still use it. Reassign them first.`
        );
      }
      await tx.role.delete({ where: { id } });
      await writeCoreAuditLogInTx(tx, ctx, {
        action: "DELETE",
        resourceType: "Role",
        resourceId: id,
        fromValue: { name: existing.name, isCustom: existing.isCustom },
      });
    }
  );
}

/**
 * Idempotent seed of the 3 standard roles per tenant:
 *   - "Super Admin"
 *   - "Admin"
 *   - "Agent"
 *
 * Called from Z1.3 backfill (per tenant) and from tenant provisioning
 * going forward. Returns the 3 role rows in the order above. Emits
 * CoreAuditLog CREATE entries only for the ones actually created
 * (existing rows produce no audit noise).
 *
 * Permissions JSON is left as an empty object — Z5 (Access Scoping,
 * Custom Roles & Light Agent) designs the real permission shape and
 * will backfill values into these standard rows at that time.
 */
export async function seedStandardRoles(ctx: WrapperContext): Promise<Role[]> {
  return withRls(
    { tenantId: ctx.tenantId, userId: ctx.actor?.teamMemberId ?? null, role: "SUPER_ADMIN" },
    async (tx) => {
      const results: Role[] = [];
      for (const name of STANDARD_ROLE_NAMES) {
        const existing = await tx.role.findFirst({
          where: { tenantId: ctx.tenantId, name },
        });
        if (existing) {
          results.push(toDto(existing));
          continue;
        }
        const row = await tx.role.create({
          data: {
            tenantId: ctx.tenantId,
            name,
            isCustom: false,
            permissions: {} as Prisma.InputJsonValue,
          },
        });
        await writeCoreAuditLogInTx(tx, ctx, {
          action: "CREATE",
          resourceType: "Role",
          resourceId: row.id,
          toValue: { name: row.name, isCustom: row.isCustom },
        });
        results.push(toDto(row));
      }
      return results;
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
  isCustom: boolean;
  permissions: Prisma.JsonValue;
  createdAt: Date;
  updatedAt: Date;
}): Role {
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    isCustom: row.isCustom,
    permissions:
      row.permissions && typeof row.permissions === "object" && !Array.isArray(row.permissions)
        ? (row.permissions as Record<string, unknown>)
        : {},
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
