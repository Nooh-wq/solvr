// CoreAuditLog wrapper. Distinct from Support's own AuditLog (ticket-shaped,
// see docs/shared-platform-boundary.md §1 rule 6). Every mutation function
// in the sibling wrapper files calls writeCoreAuditLogInTx() with their
// own transaction handle so the mutation + audit are atomic.

import { Prisma } from "@/generated/prisma";
import { withRls } from "@/lib/db";
import type { WrapperContext } from "./context";
import type {
  CoreAuditLogEntry,
  CoreAuditLogInput,
  ListFilter,
  Page,
} from "./types";

type Tx = Prisma.TransactionClient;

// ---------------------------------------------------------------------------
// Internal helper — used by every mutation function in the wrapper.
// Not exported from the public barrel; consumers only see the wrappers.
// ---------------------------------------------------------------------------

/**
 * Writes one CoreAuditLog row inside an existing transaction. Mutation
 * functions call this at the end of their withRls block so mutation +
 * audit are atomic. actorType/actorId derived from ctx.actor.
 */
export async function writeCoreAuditLogInTx(
  tx: Tx,
  ctx: WrapperContext,
  entry: CoreAuditLogInput
): Promise<void> {
  await tx.coreAuditLog.create({
    data: {
      tenantId: ctx.tenantId,
      actorId: ctx.actor?.teamMemberId ?? null,
      actorType: ctx.actor ? "TEAM_MEMBER" : "SYSTEM",
      action: entry.action,
      resourceType: entry.resourceType,
      resourceId: entry.resourceId,
      fromValue: entry.fromValue == null ? Prisma.JsonNull : (entry.fromValue as Prisma.InputJsonValue),
      toValue: entry.toValue == null ? Prisma.JsonNull : (entry.toValue as Prisma.InputJsonValue),
    },
  });
}

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

/**
 * Public entry point for writing a CoreAuditLog row from outside a
 * mutation. Consumers typically never need this — every wrapper
 * mutation emits its own audit row. Exposed for exceptional flows
 * (e.g. Z1.3 backfill emitting "BACKFILLED" entries).
 */
export async function writeCoreAuditLog(
  ctx: WrapperContext,
  entry: CoreAuditLogInput
): Promise<void> {
  await withRls(
    { tenantId: ctx.tenantId, userId: ctx.actor?.teamMemberId ?? null, role: "SUPER_ADMIN" },
    (tx) => writeCoreAuditLogInTx(tx, ctx, entry)
  );
}

/**
 * Read CoreAuditLog entries for a tenant. Cursor-paginated.
 */
export async function listCoreAuditLog(
  ctx: WrapperContext,
  filter?: {
    resourceType?: string;
    resourceId?: string;
    actorId?: string;
    since?: Date;
  } & ListFilter
): Promise<Page<CoreAuditLogEntry>> {
  const limit = Math.min(Math.max(filter?.limit ?? 50, 1), 200);
  const rows = await withRls(
    { tenantId: ctx.tenantId, userId: ctx.actor?.teamMemberId ?? null, role: "SUPER_ADMIN" },
    (tx) =>
      tx.coreAuditLog.findMany({
        where: {
          tenantId: ctx.tenantId,
          ...(filter?.resourceType && { resourceType: filter.resourceType }),
          ...(filter?.resourceId && { resourceId: filter.resourceId }),
          ...(filter?.actorId && { actorId: filter.actorId }),
          ...(filter?.since && { createdAt: { gte: filter.since } }),
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
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

// ---------------------------------------------------------------------------
// Prisma-row -> DTO
// ---------------------------------------------------------------------------

function toDto(row: {
  id: string;
  tenantId: string;
  actorId: string | null;
  actorType: "TEAM_MEMBER" | "SYSTEM";
  action: string;
  resourceType: string;
  resourceId: string;
  fromValue: Prisma.JsonValue;
  toValue: Prisma.JsonValue;
  createdAt: Date;
}): CoreAuditLogEntry {
  return {
    id: row.id,
    tenantId: row.tenantId,
    actorId: row.actorId,
    actorType: row.actorType,
    action: row.action,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    fromValue: coerceJson(row.fromValue),
    toValue: coerceJson(row.toValue),
    createdAt: row.createdAt,
  };
}

function coerceJson(v: Prisma.JsonValue): Record<string, unknown> | null {
  if (v == null) return null;
  if (typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}
