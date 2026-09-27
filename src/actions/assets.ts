"use server";

// M15.4 — Asset registry actions. Admin CRUD + link/unlink from a
// ticket. Spec §3 pin: "Asset creation is explicit" — nothing here
// auto-creates assets from ticket bodies.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withRls } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { actorCols, dualFkForUser } from "@/lib/z1-dual-fk";

const ASSET_KINDS = ["LAPTOP", "MONITOR", "LICENSE", "ACCESS", "OTHER"] as const;
const ASSET_STATUSES = ["IN_STOCK", "ASSIGNED", "RETIRED"] as const;

const upsertSchema = z.object({
  id: z.string().min(1).optional(),
  assetTag: z.string().min(1).max(80),
  name: z.string().min(1).max(200),
  kind: z.enum(ASSET_KINDS),
  status: z.enum(ASSET_STATUSES),
  serialNumber: z.string().max(200).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  // Dual-FK: at most one of these two is set. Both null when
  // status = IN_STOCK or RETIRED.
  assignedEndUserId: z.string().min(1).optional().nullable(),
  assignedTeamMemberId: z.string().min(1).optional().nullable(),
});

const linkSchema = z.object({
  assetId: z.string().min(1),
  ticketId: z.string().min(1),
});

export type AssetDto = {
  id: string;
  assetTag: string;
  name: string;
  kind: string;
  status: string;
  serialNumber: string | null;
  notes: string | null;
  assignedEndUserId: string | null;
  assignedTeamMemberId: string | null;
  updatedAt: string;
};

export async function listAssets(): Promise<AssetDto[]> {
  const session = await requireSession({ minRole: "AGENT" });
  return withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const rows = await tx.asset.findMany({
        where: { tenantId: session.tenantId },
        orderBy: [{ status: "asc" }, { assetTag: "asc" }],
      });
      return rows.map((r) => ({
        id: r.id,
        assetTag: r.assetTag,
        name: r.name,
        kind: r.kind,
        status: r.status,
        serialNumber: r.serialNumber,
        notes: r.notes,
        assignedEndUserId: r.assignedEndUserId,
        assignedTeamMemberId: r.assignedTeamMemberId,
        updatedAt: r.updatedAt.toISOString(),
      }));
    }
  );
}

export async function upsertAsset(input: z.infer<typeof upsertSchema>) {
  const session = await requireSession({ minRole: "ADMIN" });
  const data = upsertSchema.parse(input);

  // Dual-FK invariant: at most one assignee.
  if (data.assignedEndUserId && data.assignedTeamMemberId) {
    throw new Error("Asset can be assigned to at most one subject");
  }
  if (data.status === "ASSIGNED" && !data.assignedEndUserId && !data.assignedTeamMemberId) {
    throw new Error("Assigned assets must have an assignee");
  }
  if (data.status !== "ASSIGNED" && (data.assignedEndUserId || data.assignedTeamMemberId)) {
    throw new Error("Only ASSIGNED assets can carry an assignee");
  }

  return withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const row = data.id
        ? await tx.asset.update({
            where: { id: data.id },
            data: {
              assetTag: data.assetTag,
              name: data.name,
              kind: data.kind,
              status: data.status,
              serialNumber: data.serialNumber ?? null,
              notes: data.notes ?? null,
              assignedEndUserId: data.assignedEndUserId ?? null,
              assignedTeamMemberId: data.assignedTeamMemberId ?? null,
            },
          })
        : await tx.asset.create({
            data: {
              tenantId: session.tenantId,
              assetTag: data.assetTag,
              name: data.name,
              kind: data.kind,
              status: data.status,
              serialNumber: data.serialNumber ?? null,
              notes: data.notes ?? null,
              assignedEndUserId: data.assignedEndUserId ?? null,
              assignedTeamMemberId: data.assignedTeamMemberId ?? null,
            },
          });
      const dual = dualFkForUser(session.subjectId, session.role);
      await tx.auditLog.create({
        data: {
          tenantId: session.tenantId,
          ...actorCols(dual),
          action: data.id ? "ASSET_UPDATE" : "ASSET_CREATE",
          toValue: row.assetTag,
        },
      });
      revalidatePath("/admin/assets");
      return { ok: true, id: row.id };
    }
  );
}

export async function deleteAsset(id: string) {
  const session = await requireSession({ minRole: "ADMIN" });
  return withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const asset = await tx.asset.findFirst({
        where: { id, tenantId: session.tenantId },
      });
      if (!asset) throw new Error("Asset not found");
      await tx.asset.delete({ where: { id: asset.id } });
      const dual = dualFkForUser(session.subjectId, session.role);
      await tx.auditLog.create({
        data: {
          tenantId: session.tenantId,
          ...actorCols(dual),
          action: "ASSET_DELETE",
          fromValue: asset.assetTag,
        },
      });
      revalidatePath("/admin/assets");
      return { ok: true };
    }
  );
}

export async function linkAssetToTicket(input: z.infer<typeof linkSchema>) {
  const session = await requireSession({ minRole: "AGENT" });
  const data = linkSchema.parse(input);
  return withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const [asset, ticket] = await Promise.all([
        tx.asset.findFirst({ where: { id: data.assetId, tenantId: session.tenantId } }),
        tx.ticket.findFirst({ where: { id: data.ticketId, tenantId: session.tenantId } }),
      ]);
      if (!asset) throw new Error("Asset not found");
      if (!ticket) throw new Error("Ticket not found");
      await tx.assetLink.create({
        data: {
          tenantId: session.tenantId,
          assetId: asset.id,
          ticketId: ticket.id,
        },
      });
      const dual = dualFkForUser(session.subjectId, session.role);
      await tx.auditLog.create({
        data: {
          tenantId: session.tenantId,
          ticketId: ticket.id,
          ...actorCols(dual),
          action: "ASSET_LINK",
          toValue: asset.assetTag,
        },
      });
      revalidatePath(`/agent/tickets/${ticket.id}`);
      return { ok: true };
    }
  );
}

export async function unlinkAssetFromTicket(input: z.infer<typeof linkSchema>) {
  const session = await requireSession({ minRole: "AGENT" });
  const data = linkSchema.parse(input);
  return withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      await tx.assetLink.deleteMany({
        where: {
          tenantId: session.tenantId,
          assetId: data.assetId,
          ticketId: data.ticketId,
        },
      });
      revalidatePath(`/agent/tickets/${data.ticketId}`);
      return { ok: true };
    }
  );
}

export async function listAssetsForTicket(ticketId: string): Promise<AssetDto[]> {
  const session = await requireSession({ minRole: "AGENT" });
  return withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const links = await tx.assetLink.findMany({
        where: { tenantId: session.tenantId, ticketId },
        select: { assetId: true },
      });
      const assetIds = links.map((l) => l.assetId);
      if (assetIds.length === 0) return [];
      const assets = await tx.asset.findMany({
        where: { tenantId: session.tenantId, id: { in: assetIds } },
      });
      return assets.map((a) => ({
        id: a.id,
        assetTag: a.assetTag,
        name: a.name,
        kind: a.kind,
        status: a.status,
        serialNumber: a.serialNumber,
        notes: a.notes,
        assignedEndUserId: a.assignedEndUserId,
        assignedTeamMemberId: a.assignedTeamMemberId,
        updatedAt: a.updatedAt.toISOString(),
      }));
    }
  );
}
