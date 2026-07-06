// EndUser wrapper — replaces the role=CLIENT slice of the legacy User table.
// Also wraps EndUserOrganization (secondary org memberships).

import { Prisma } from "@/generated/prisma";
import { withRls } from "@/lib/db";
import type { WrapperContext } from "./context";
import type {
  CreateEndUserInput,
  EndUser,
  ListFilter,
  Organization,
  Page,
  UpdateEndUserInput,
} from "./types";
import { WrapperConflictError, WrapperNotFoundError } from "./errors";
import { writeCoreAuditLogInTx } from "./audit";

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export async function getEndUser(ctx: WrapperContext, id: string): Promise<EndUser | null> {
  const row = await withRls(
    { tenantId: ctx.tenantId, userId: ctx.actor?.teamMemberId ?? null, role: "SUPER_ADMIN" },
    (tx) => tx.endUser.findFirst({ where: { id, tenantId: ctx.tenantId } })
  );
  return row ? toDto(row) : null;
}

export async function listEndUsers(
  ctx: WrapperContext,
  filter?: { organizationId?: string } & ListFilter
): Promise<Page<EndUser>> {
  const limit = clampLimit(filter?.limit);
  const rows = await withRls(
    { tenantId: ctx.tenantId, userId: ctx.actor?.teamMemberId ?? null, role: "SUPER_ADMIN" },
    (tx) =>
      tx.endUser.findMany({
        where: {
          tenantId: ctx.tenantId,
          ...(filter?.organizationId && { organizationId: filter.organizationId }),
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

export async function matchEndUserByEmail(
  ctx: WrapperContext,
  email: string
): Promise<EndUser | null> {
  const row = await withRls(
    { tenantId: ctx.tenantId, userId: ctx.actor?.teamMemberId ?? null, role: "SUPER_ADMIN" },
    (tx) => tx.endUser.findFirst({ where: { tenantId: ctx.tenantId, email } })
  );
  return row ? toDto(row) : null;
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

export async function createEndUser(
  ctx: WrapperContext,
  input: CreateEndUserInput
): Promise<EndUser> {
  return withRls(
    { tenantId: ctx.tenantId, userId: ctx.actor?.teamMemberId ?? null, role: "SUPER_ADMIN" },
    async (tx) => {
      try {
        const row = await tx.endUser.create({
          data: {
            tenantId: ctx.tenantId,
            email: input.email,
            name: input.name ?? null,
            organizationId: input.organizationId ?? null,
          },
        });
        await writeCoreAuditLogInTx(tx, ctx, {
          action: "CREATE",
          resourceType: "EndUser",
          resourceId: row.id,
          toValue: { email: row.email, name: row.name, organizationId: row.organizationId },
        });
        return toDto(row);
      } catch (e) {
        throw translateUnique(e, "EndUser", "email", input.email);
      }
    }
  );
}

export async function updateEndUser(
  ctx: WrapperContext,
  id: string,
  patch: UpdateEndUserInput
): Promise<EndUser> {
  return withRls(
    { tenantId: ctx.tenantId, userId: ctx.actor?.teamMemberId ?? null, role: "SUPER_ADMIN" },
    async (tx) => {
      const existing = await tx.endUser.findFirst({ where: { id, tenantId: ctx.tenantId } });
      if (!existing) throw new WrapperNotFoundError("EndUser", id);
      try {
        const updated = await tx.endUser.update({
          where: { id },
          data: {
            ...(patch.email !== undefined && { email: patch.email }),
            ...(patch.name !== undefined && { name: patch.name }),
            ...(patch.organizationId !== undefined && { organizationId: patch.organizationId }),
          },
        });
        await writeCoreAuditLogInTx(tx, ctx, {
          action: "UPDATE",
          resourceType: "EndUser",
          resourceId: id,
          fromValue: {
            email: existing.email,
            name: existing.name,
            organizationId: existing.organizationId,
          },
          toValue: {
            email: updated.email,
            name: updated.name,
            organizationId: updated.organizationId,
          },
        });
        return toDto(updated);
      } catch (e) {
        throw translateUnique(e, "EndUser", "email", patch.email ?? existing.email);
      }
    }
  );
}

export async function deleteEndUser(ctx: WrapperContext, id: string): Promise<void> {
  await withRls(
    { tenantId: ctx.tenantId, userId: ctx.actor?.teamMemberId ?? null, role: "SUPER_ADMIN" },
    async (tx) => {
      const existing = await tx.endUser.findFirst({ where: { id, tenantId: ctx.tenantId } });
      if (!existing) throw new WrapperNotFoundError("EndUser", id);
      // DB cascade: end_user_organizations rows removed automatically.
      await tx.endUser.delete({ where: { id } });
      await writeCoreAuditLogInTx(tx, ctx, {
        action: "DELETE",
        resourceType: "EndUser",
        resourceId: id,
        fromValue: {
          email: existing.email,
          name: existing.name,
          organizationId: existing.organizationId,
        },
      });
    }
  );
}

/**
 * Backfill helper. Idempotent by (tenantId, email).
 *
 * PATCH-style overwrite semantics: every key present in `input`
 * OVERWRITES the corresponding column on the existing row, whether or
 * not the existing value is null. Keys NOT present in `input` are left
 * untouched. Explicit `null` in input counts as "set to null." This
 * makes backfill correctness under re-run deterministic — the legacy
 * source is authoritative during Z1.3, so re-running with updated
 * legacy data always converges to the latest state.
 */
export async function upsertEndUserByEmail(
  ctx: WrapperContext,
  email: string,
  input: Omit<CreateEndUserInput, "email">
): Promise<EndUser> {
  return withRls(
    { tenantId: ctx.tenantId, userId: ctx.actor?.teamMemberId ?? null, role: "SUPER_ADMIN" },
    async (tx) => {
      const existing = await tx.endUser.findFirst({
        where: { tenantId: ctx.tenantId, email },
      });
      if (!existing) {
        const row = await tx.endUser.create({
          data: {
            tenantId: ctx.tenantId,
            email,
            name: input.name ?? null,
            organizationId: input.organizationId ?? null,
          },
        });
        await writeCoreAuditLogInTx(tx, ctx, {
          action: "CREATE",
          resourceType: "EndUser",
          resourceId: row.id,
          toValue: { email: row.email, name: row.name, organizationId: row.organizationId },
        });
        return toDto(row);
      }
      const nextName = "name" in input ? (input.name ?? null) : existing.name;
      const nextOrgId =
        "organizationId" in input ? (input.organizationId ?? null) : existing.organizationId;
      const nameChanged = nextName !== existing.name;
      const orgChanged = nextOrgId !== existing.organizationId;
      if (!nameChanged && !orgChanged) return toDto(existing);
      const updated = await tx.endUser.update({
        where: { id: existing.id },
        data: {
          ...(nameChanged && { name: nextName }),
          ...(orgChanged && { organizationId: nextOrgId }),
        },
      });
      await writeCoreAuditLogInTx(tx, ctx, {
        action: "UPDATE",
        resourceType: "EndUser",
        resourceId: updated.id,
        fromValue: { name: existing.name, organizationId: existing.organizationId },
        toValue: { name: updated.name, organizationId: updated.organizationId },
      });
      return toDto(updated);
    }
  );
}

// ---------------------------------------------------------------------------
// Multi-org (EndUserOrganization) — secondary memberships
// ---------------------------------------------------------------------------

/**
 * Adds an EndUser to a secondary Organization. Idempotent: re-calling
 * with the same pair is a no-op (no audit row emitted for the no-op).
 * Both the EndUser and the Organization must exist in ctx.tenantId
 * (RLS makes cross-tenant targets invisible → NotFound thrown).
 */
export async function attachEndUserToOrganization(
  ctx: WrapperContext,
  endUserId: string,
  organizationId: string
): Promise<void> {
  await withRls(
    { tenantId: ctx.tenantId, userId: ctx.actor?.teamMemberId ?? null, role: "SUPER_ADMIN" },
    async (tx) => {
      const eu = await tx.endUser.findFirst({ where: { id: endUserId, tenantId: ctx.tenantId } });
      if (!eu) throw new WrapperNotFoundError("EndUser", endUserId);
      const org = await tx.organization.findFirst({
        where: { id: organizationId, tenantId: ctx.tenantId },
      });
      if (!org) throw new WrapperNotFoundError("Organization", organizationId);
      const existing = await tx.endUserOrganization.findUnique({
        where: { endUserId_organizationId: { endUserId, organizationId } },
      });
      if (existing) return; // idempotent no-op
      await tx.endUserOrganization.create({
        data: { endUserId, organizationId, tenantId: ctx.tenantId },
      });
      await writeCoreAuditLogInTx(tx, ctx, {
        action: "ATTACH",
        resourceType: "EndUserOrganization",
        resourceId: `${endUserId}:${organizationId}`,
        toValue: { endUserId, organizationId },
      });
    }
  );
}

/**
 * Reverses attach. Idempotent: no-op if not attached (no audit row).
 */
export async function detachEndUserFromOrganization(
  ctx: WrapperContext,
  endUserId: string,
  organizationId: string
): Promise<void> {
  await withRls(
    { tenantId: ctx.tenantId, userId: ctx.actor?.teamMemberId ?? null, role: "SUPER_ADMIN" },
    async (tx) => {
      const existing = await tx.endUserOrganization.findUnique({
        where: { endUserId_organizationId: { endUserId, organizationId } },
      });
      if (!existing) return; // idempotent no-op
      // Cross-tenant safety: existing.tenantId must match ctx.tenantId —
      // RLS makes cross-tenant rows invisible so this shouldn't fire,
      // but explicit belt-and-braces check documents the guarantee.
      if (existing.tenantId !== ctx.tenantId) return;
      await tx.endUserOrganization.delete({
        where: { endUserId_organizationId: { endUserId, organizationId } },
      });
      await writeCoreAuditLogInTx(tx, ctx, {
        action: "DETACH",
        resourceType: "EndUserOrganization",
        resourceId: `${endUserId}:${organizationId}`,
        fromValue: { endUserId, organizationId },
      });
    }
  );
}

/** Primary + all secondary orgs for one EndUser, in a stable order. */
export async function listOrganizationsForEndUser(
  ctx: WrapperContext,
  endUserId: string
): Promise<Organization[]> {
  return withRls(
    { tenantId: ctx.tenantId, userId: ctx.actor?.teamMemberId ?? null, role: "SUPER_ADMIN" },
    async (tx) => {
      const eu = await tx.endUser.findFirst({
        where: { id: endUserId, tenantId: ctx.tenantId },
      });
      if (!eu) return [];
      const secondary = await tx.endUserOrganization.findMany({
        where: { endUserId, tenantId: ctx.tenantId },
        include: { organization: true },
      });
      const secondaryOrgs = secondary.map((m) => toOrgDto(m.organization));
      // Primary org first (if any), then any secondaries not already in
      // primary. Dedupe by id so primaryOrgId in the secondary list
      // doesn't appear twice.
      if (!eu.organizationId) return secondaryOrgs;
      const primary = await tx.organization.findFirst({
        where: { id: eu.organizationId, tenantId: ctx.tenantId },
      });
      if (!primary) return secondaryOrgs;
      const primaryDto = toOrgDto(primary);
      const rest = secondaryOrgs.filter((o) => o.id !== primaryDto.id);
      return [primaryDto, ...rest];
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
  organizationId: string | null;
  createdAt: Date;
  updatedAt: Date;
}): EndUser {
  return {
    id: row.id,
    tenantId: row.tenantId,
    email: row.email,
    name: row.name,
    organizationId: row.organizationId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toOrgDto(row: {
  id: string;
  tenantId: string;
  name: string;
  domain: string | null;
  createdAt: Date;
  updatedAt: Date;
}): Organization {
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    domain: row.domain,
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
