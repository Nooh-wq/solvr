"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@/generated/prisma";
import { withRls } from "@/lib/db";
import { requireSession, roleAtLeast } from "@/lib/auth";
import { actorCols, dualFkForUser } from "@/lib/z1-dual-fk";

// Z6.1 — Views (personal only). Shared views (Z6.5) share this schema
// with ownerTeamMemberId = null; the app-layer create guard here rejects
// nulls today so an ordinary agent can't ship a "shared" view before
// the permission catalog gate lands.

const filterSchema = z
  .object({
    status: z.enum(["OPEN", "IN_PROGRESS", "PENDING", "RESOLVED", "CLOSED"]).optional(),
    priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).optional(),
    categoryId: z.string().optional(),
    // "me" | "unassigned" | teamMemberId. String kept loose because the
    // sentinel values are meaningful, not just cuids.
    assignedToId: z.string().optional(),
    search: z.string().max(200).optional(),
  })
  .strict();

const sortSchema = z
  .object({
    key: z.enum(["updatedAt", "createdAt", "priority"]).default("updatedAt"),
    dir: z.enum(["asc", "desc"]).default("desc"),
  })
  .strict();

const createViewSchema = z.object({
  name: z.string().min(1).max(80),
  filters: filterSchema.default({}),
  sort: sortSchema.default({ key: "updatedAt", dir: "desc" }),
  /**
   * Z6.5 — when true, the view is created with ownerTeamMemberId = null
   * (tenant-shared). Requires ADMIN+ (permission-catalog gate lands with
   * the wrapper-side Z5.4 role-permission wiring; until then role tier
   * is the enforcement point).
   */
  shared: z.boolean().default(false),
});

const updateViewSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(80).optional(),
  filters: filterSchema.optional(),
  sort: sortSchema.optional(),
});

export type SavedViewRow = {
  id: string;
  name: string;
  filters: z.infer<typeof filterSchema>;
  sort: z.infer<typeof sortSchema>;
  isDefault: boolean;
  isShared: boolean;
  createdAt: Date;
  updatedAt: Date;
};

function parseFilters(raw: Prisma.JsonValue): z.infer<typeof filterSchema> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const parsed = filterSchema.safeParse(raw);
    if (parsed.success) return parsed.data;
  }
  return {};
}

function parseSort(raw: Prisma.JsonValue): z.infer<typeof sortSchema> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const parsed = sortSchema.safeParse(raw);
    if (parsed.success) return parsed.data;
  }
  return { key: "updatedAt", dir: "desc" };
}

/**
 * Z6.5 — one-shot seed of the 4 default shared views for a tenant. Called
 * lazily from ensureDefaultSharedViews() the first time an agent lands on
 * /agent, and from the tenant-provisioning path for new signups. Named
 * views are the ones the Z6 spec §5 explicitly lists.
 *
 * Runs under SUPER_ADMIN scope so the seeder doesn't require the caller
 * to be an admin. Idempotent: existing rows with the same names are
 * left untouched (they may have been edited).
 */
async function seedDefaultSharedViewsInTx(
  tx: Parameters<Parameters<typeof withRls>[1]>[0],
  tenantId: string
): Promise<number> {
  const DEFAULTS: Array<{ name: string; filters: z.infer<typeof filterSchema> }> = [
    { name: "My open", filters: { assignedToId: "me", status: "OPEN" } },
    { name: "Unassigned", filters: { assignedToId: "unassigned" } },
    { name: "Urgent", filters: { priority: "URGENT" } },
    { name: "Awaiting my reply", filters: { assignedToId: "me", status: "PENDING" } },
  ];
  let created = 0;
  for (const d of DEFAULTS) {
    const existing = await tx.savedView.findFirst({
      where: { tenantId, ownerTeamMemberId: null, name: d.name },
    });
    if (existing) continue;
    try {
      await tx.savedView.create({
        data: {
          tenantId,
          ownerTeamMemberId: null,
          name: d.name,
          filters: d.filters as Prisma.InputJsonValue,
          sort: { key: "updatedAt", dir: "desc" } as Prisma.InputJsonValue,
        },
      });
      created += 1;
    } catch (e) {
      // A parallel /agent load can race us here. The partial unique
      // index on (tenantId, name) where ownerTeamMemberId IS NULL
      // ensures the second writer P2002s cleanly rather than duping.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") continue;
      throw e;
    }
  }
  return created;
}

/**
 * Public entry point for the lazy seed. Guarded by a fast existence
 * check so the write path only fires on tenants that have never had
 * defaults. Fire-and-forget from callers — failure is non-fatal.
 */
/**
 * Z6.1 (DoD closure) — returns { viewId → unread ticket count } for
 * every view the acting agent can see. Unread = matches this view's
 * filter AND (never viewed by this agent OR ticket.updatedAt is newer
 * than the agent's lastViewedAt row). Ticket-detail loads upsert
 * TicketView so the count decays the moment an agent opens something.
 */
export async function countViewMatches(): Promise<Record<string, number>> {
  const session = await requireSession({ minRole: "AGENT" });
  return withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const rows = await tx.savedView.findMany({
        where: {
          tenantId: session.tenantId,
          OR: [
            { ownerTeamMemberId: session.subjectId },
            { ownerTeamMemberId: null },
          ],
        },
        select: { id: true, filters: true },
      });
      // Pull the agent's TicketView map once — bounded to visible
      // tickets — so each per-view count doesn't re-query it.
      const viewedRows = await tx.ticketView.findMany({
        where: { tenantId: session.tenantId, subjectId: session.subjectId },
        select: { ticketId: true, lastViewedAt: true },
      });
      const viewedIds = viewedRows.map((v) => v.ticketId);

      const counts: Record<string, number> = {};
      for (const r of rows) {
        const f = parseFilters(r.filters);
        const assignedToId =
          f.assignedToId === "me" ? session.subjectId : f.assignedToId;

        // Two branches so the DB does the "never viewed" AND
        // "updated since last view" test in one query:
        //   - tickets whose id isn't in viewedIds → always unread
        //   - tickets whose id is in viewedIds but updatedAt is newer
        //     than the matching lastViewedAt → unread
        // Prisma has no "compare against a per-row lookup" primitive,
        // so we split into `id NOT IN (viewed)` plus a per-viewed
        // batched OR. Given at most a few hundred visible tickets per
        // agent this stays under the batch OR limit comfortably.
        const perViewedOr = viewedRows.map((v) => ({
          id: v.ticketId,
          updatedAt: { gt: v.lastViewedAt },
        }));

        counts[r.id] = await tx.ticket.count({
          where: {
            tenantId: session.tenantId,
            ...(f.status && { status: f.status }),
            ...(f.priority && { priority: f.priority }),
            ...(f.categoryId && { categoryId: f.categoryId }),
            ...(assignedToId === "unassigned"
              ? { assignedTeamMemberId: null }
              : assignedToId && assignedToId !== ""
                ? { assignedTeamMemberId: assignedToId }
                : {}),
            OR: [
              { id: { notIn: viewedIds } },
              ...(perViewedOr.length > 0 ? perViewedOr : []),
            ],
          },
        });
      }
      return counts;
    }
  );
}

export async function ensureDefaultSharedViews(): Promise<void> {
  const session = await requireSession({ minRole: "AGENT" });
  await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: "SUPER_ADMIN" },
    async (tx) => {
      const anyShared = await tx.savedView.findFirst({
        where: { tenantId: session.tenantId, ownerTeamMemberId: null },
        select: { id: true },
      });
      if (anyShared) return;
      await seedDefaultSharedViewsInTx(tx, session.tenantId);
    }
  );
}

/**
 * Z6 DoD closure — seed defaults at tenant-provisioning time, callable
 * from the signup path where there is no session yet. Runs under a
 * synthetic SUPER_ADMIN scope pinned to the freshly-created tenant.
 * Idempotent (same partial-unique-index backstop as the lazy seed).
 */
export async function seedDefaultSharedViewsForTenant(tenantId: string): Promise<number> {
  return withRls(
    { tenantId, userId: null, role: "SUPER_ADMIN" },
    (tx) => seedDefaultSharedViewsInTx(tx, tenantId)
  );
}

export async function listMyViews(): Promise<SavedViewRow[]> {
  const session = await requireSession({ minRole: "AGENT" });
  return withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const rows = await tx.savedView.findMany({
        where: {
          tenantId: session.tenantId,
          OR: [
            { ownerTeamMemberId: session.subjectId },
            { ownerTeamMemberId: null },
          ],
        },
        orderBy: [
          { isDefault: "desc" },
          // Personal views before shared, alphabetical within each group.
          { ownerTeamMemberId: "asc" },
          { name: "asc" },
        ],
      });
      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        filters: parseFilters(r.filters),
        sort: parseSort(r.sort),
        isDefault: r.isDefault,
        isShared: r.ownerTeamMemberId === null,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      }));
    }
  );
}

export async function createView(input: z.infer<typeof createViewSchema>) {
  const session = await requireSession({ minRole: "AGENT" });
  const data = createViewSchema.parse(input);
  if (data.shared && !roleAtLeast(session.role, "ADMIN")) {
    throw new Error("Only admins can create shared views.");
  }
  const ownerTeamMemberId = data.shared ? null : session.subjectId;
  const row = await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const created = await tx.savedView.create({
        data: {
          tenantId: session.tenantId,
          ownerTeamMemberId,
          name: data.name,
          filters: data.filters as Prisma.InputJsonValue,
          sort: data.sort as Prisma.InputJsonValue,
        },
      });
      await tx.auditLog.create({
        data: {
          tenantId: session.tenantId,
          ...actorCols(dualFkForUser(session.subjectId, session.role)),
          action: "CREATE_VIEW",
          toValue: `${created.name}${ownerTeamMemberId === null ? " (shared)" : ""}`,
        },
      });
      return created;
    }
  );
  revalidatePath("/agent");
  return { id: row.id, isShared: ownerTeamMemberId === null };
}

export async function updateView(input: z.infer<typeof updateViewSchema>) {
  const session = await requireSession({ minRole: "AGENT" });
  const data = updateViewSchema.parse(input);
  await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const existing = await tx.savedView.findFirst({
        where: { id: data.id, tenantId: session.tenantId },
      });
      if (!existing) throw new Error("View not found.");
      const isShared = existing.ownerTeamMemberId === null;
      if (isShared && !roleAtLeast(session.role, "ADMIN")) {
        throw new Error("Only admins can edit shared views.");
      }
      if (!isShared && existing.ownerTeamMemberId !== session.subjectId) {
        throw new Error("You can only edit your own views.");
      }
      await tx.savedView.update({
        where: { id: data.id },
        data: {
          ...(data.name !== undefined && { name: data.name }),
          ...(data.filters !== undefined && { filters: data.filters as Prisma.InputJsonValue }),
          ...(data.sort !== undefined && { sort: data.sort as Prisma.InputJsonValue }),
        },
      });
      await tx.auditLog.create({
        data: {
          tenantId: session.tenantId,
          ...actorCols(dualFkForUser(session.subjectId, session.role)),
          action: "UPDATE_VIEW",
          fromValue: existing.name,
          toValue: data.name ?? existing.name,
        },
      });
    }
  );
  revalidatePath("/agent");
  return { ok: true as const };
}

export async function deleteView(id: string) {
  const session = await requireSession({ minRole: "AGENT" });
  await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const existing = await tx.savedView.findFirst({
        where: { id, tenantId: session.tenantId },
      });
      if (!existing) throw new Error("View not found.");
      const isShared = existing.ownerTeamMemberId === null;
      if (isShared && !roleAtLeast(session.role, "ADMIN")) {
        throw new Error("Only admins can delete shared views.");
      }
      if (!isShared && existing.ownerTeamMemberId !== session.subjectId) {
        throw new Error("You can only delete your own views.");
      }
      await tx.savedView.delete({ where: { id } });
      await tx.auditLog.create({
        data: {
          tenantId: session.tenantId,
          ...actorCols(dualFkForUser(session.subjectId, session.role)),
          action: "DELETE_VIEW",
          fromValue: existing.name,
        },
      });
    }
  );
  revalidatePath("/agent");
  return { ok: true as const };
}

/**
 * Sets `id` as the acting agent's default view; unsets any previous
 * default in the same transaction so at most one row per (tenant, owner)
 * carries isDefault=true.
 */
export async function setDefaultView(id: string) {
  const session = await requireSession({ minRole: "AGENT" });
  await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const existing = await tx.savedView.findFirst({
        where: {
          id,
          tenantId: session.tenantId,
          ownerTeamMemberId: session.subjectId,
        },
      });
      if (!existing) {
        // Only personal views can be pinned as the acting agent's
        // default — the isDefault column is per-view, not per-(user,
        // view), so a "pin shared view as my default" would need a new
        // table. Kept out of scope for M2.
        throw new Error("Only your own views can be set as default.");
      }
      await tx.savedView.updateMany({
        where: {
          tenantId: session.tenantId,
          ownerTeamMemberId: session.subjectId,
          isDefault: true,
        },
        data: { isDefault: false },
      });
      await tx.savedView.update({
        where: { id },
        data: { isDefault: true },
      });
    }
  );
  revalidatePath("/agent");
  return { ok: true as const };
}

// viewToTicketFilter moved to src/lib/view-filter.ts — a "use server"
// file can only export async functions in Next 16.
