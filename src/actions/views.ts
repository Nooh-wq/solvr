"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@/generated/prisma";
import { withRls } from "@/lib/db";
import { requireSession } from "@/lib/auth";

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

export async function listMyViews(): Promise<SavedViewRow[]> {
  const session = await requireSession({ minRole: "AGENT" });
  return withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const rows = await tx.savedView.findMany({
        where: {
          tenantId: session.tenantId,
          ownerTeamMemberId: session.subjectId,
        },
        orderBy: [{ isDefault: "desc" }, { name: "asc" }],
      });
      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        filters: parseFilters(r.filters),
        sort: parseSort(r.sort),
        isDefault: r.isDefault,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      }));
    }
  );
}

export async function createView(input: z.infer<typeof createViewSchema>) {
  const session = await requireSession({ minRole: "AGENT" });
  const data = createViewSchema.parse(input);
  const row = await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    (tx) =>
      tx.savedView.create({
        data: {
          tenantId: session.tenantId,
          ownerTeamMemberId: session.subjectId,
          name: data.name,
          filters: data.filters as Prisma.InputJsonValue,
          sort: data.sort as Prisma.InputJsonValue,
        },
      })
  );
  revalidatePath("/agent");
  return { id: row.id };
}

export async function updateView(input: z.infer<typeof updateViewSchema>) {
  const session = await requireSession({ minRole: "AGENT" });
  const data = updateViewSchema.parse(input);
  await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const existing = await tx.savedView.findFirst({
        where: {
          id: data.id,
          tenantId: session.tenantId,
          ownerTeamMemberId: session.subjectId,
        },
      });
      if (!existing) throw new Error("View not found.");
      await tx.savedView.update({
        where: { id: data.id },
        data: {
          ...(data.name !== undefined && { name: data.name }),
          ...(data.filters !== undefined && { filters: data.filters as Prisma.InputJsonValue }),
          ...(data.sort !== undefined && { sort: data.sort as Prisma.InputJsonValue }),
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
        where: {
          id,
          tenantId: session.tenantId,
          ownerTeamMemberId: session.subjectId,
        },
      });
      if (!existing) throw new Error("View not found.");
      await tx.savedView.delete({ where: { id } });
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
      if (!existing) throw new Error("View not found.");
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
