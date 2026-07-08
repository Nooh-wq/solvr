"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@/generated/prisma";
import { withRls } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { actorCols, dualFkForUser } from "@/lib/z1-dual-fk";
import {
  createEscalationPathSchema,
  updateEscalationPathSchema,
  runEscalation,
} from "@/lib/escalations";

// Z8.4 — Escalation Path CRUD (admin) + triggerEscalation (agent). The
// runtime executor lives in lib/escalations.ts so the rule engine can
// call it without pulling in a "use server" module.

export type EscalationPathRow = {
  id: string;
  label: string;
  icon: string | null;
  categoryIds: string[];
  destKind: "TEAM" | "WEBHOOK" | "EMAIL" | "INTEGRATION";
  destConfig: Prisma.JsonValue;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export async function listEscalationPaths(): Promise<EscalationPathRow[]> {
  const session = await requireSession({ minRole: "AGENT" });
  const rows = await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    (tx) =>
      tx.escalationPath.findMany({
        where: { tenantId: session.tenantId },
        orderBy: [{ active: "desc" }, { label: "asc" }],
      })
  );
  return rows.map((r) => ({
    id: r.id,
    label: r.label,
    icon: r.icon,
    categoryIds: (r.categoryIds as unknown as string[]) ?? [],
    destKind: r.destKind as EscalationPathRow["destKind"],
    destConfig: r.destConfig,
    active: r.active,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }));
}

/**
 * Returns only the escalation paths that apply to this ticket — the
 * ticket-detail button rail uses this so the visible buttons match the
 * ticket's category. Empty categoryIds means "any category".
 */
export async function listEscalationPathsForTicket(ticketId: string): Promise<EscalationPathRow[]> {
  const session = await requireSession({ minRole: "AGENT" });
  const { paths, ticket } = await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const t = await tx.ticket.findFirst({
        where: { id: ticketId, tenantId: session.tenantId },
        select: { categoryId: true },
      });
      const paths = await tx.escalationPath.findMany({
        where: { tenantId: session.tenantId, active: true },
        orderBy: { label: "asc" },
      });
      return { paths, ticket: t };
    }
  );
  if (!ticket) return [];
  return paths
    .filter((p) => {
      const cats = (p.categoryIds as unknown as string[]) ?? [];
      if (cats.length === 0) return true;
      return ticket.categoryId ? cats.includes(ticket.categoryId) : false;
    })
    .map((p) => ({
      id: p.id,
      label: p.label,
      icon: p.icon,
      categoryIds: (p.categoryIds as unknown as string[]) ?? [],
      destKind: p.destKind as EscalationPathRow["destKind"],
      destConfig: p.destConfig,
      active: p.active,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    }));
}

export async function createEscalationPath(input: z.infer<typeof createEscalationPathSchema>) {
  const session = await requireSession({ minRole: "ADMIN" });
  const data = createEscalationPathSchema.parse(input);
  if (data.destKind === "INTEGRATION") {
    throw new Error("Integration destinations aren't available yet.");
  }
  const row = await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const r = await tx.escalationPath.create({
        data: {
          tenantId: session.tenantId,
          label: data.label,
          icon: data.icon,
          categoryIds: (data.categoryIds ?? []) as Prisma.InputJsonValue,
          destKind: data.destKind,
          destConfig: (data.destConfig ?? {}) as Prisma.InputJsonValue,
          active: data.active,
        },
      });
      await tx.auditLog.create({
        data: {
          tenantId: session.tenantId,
          ...actorCols(dualFkForUser(session.subjectId, session.role)),
          action: "CREATE_ESCALATION_PATH",
          toValue: `${r.label} (${r.destKind})`,
        },
      });
      return r;
    }
  );
  revalidatePath("/admin/escalation-paths");
  return { id: row.id };
}

export async function updateEscalationPath(input: z.infer<typeof updateEscalationPathSchema>) {
  const session = await requireSession({ minRole: "ADMIN" });
  const data = updateEscalationPathSchema.parse(input);
  await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const existing = await tx.escalationPath.findFirst({
        where: { id: data.id, tenantId: session.tenantId },
      });
      if (!existing) throw new Error("Escalation path not found.");
      await tx.escalationPath.update({
        where: { id: data.id },
        data: {
          ...(data.label !== undefined && { label: data.label }),
          ...(data.icon !== undefined && { icon: data.icon }),
          ...(data.categoryIds !== undefined && { categoryIds: data.categoryIds as Prisma.InputJsonValue }),
          ...(data.destKind !== undefined && { destKind: data.destKind }),
          ...(data.destConfig !== undefined && { destConfig: data.destConfig as Prisma.InputJsonValue }),
          ...(data.active !== undefined && { active: data.active }),
        },
      });
      await tx.auditLog.create({
        data: {
          tenantId: session.tenantId,
          ...actorCols(dualFkForUser(session.subjectId, session.role)),
          action: "UPDATE_ESCALATION_PATH",
          fromValue: existing.label,
          toValue: data.label ?? existing.label,
        },
      });
    }
  );
  revalidatePath("/admin/escalation-paths");
  return { ok: true as const };
}

export async function deleteEscalationPath(id: string) {
  const session = await requireSession({ minRole: "ADMIN" });
  await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const existing = await tx.escalationPath.findFirst({
        where: { id, tenantId: session.tenantId },
      });
      if (!existing) throw new Error("Escalation path not found.");
      await tx.escalationPath.delete({ where: { id } });
      await tx.auditLog.create({
        data: {
          tenantId: session.tenantId,
          ...actorCols(dualFkForUser(session.subjectId, session.role)),
          action: "DELETE_ESCALATION_PATH",
          fromValue: existing.label,
        },
      });
    }
  );
  revalidatePath("/admin/escalation-paths");
  return { ok: true as const };
}

/** Agent-invoked from the ticket detail Escalate button. */
export async function triggerEscalation(input: { escalationPathId: string; ticketId: string }) {
  const session = await requireSession({ minRole: "AGENT" });
  const schema = z.object({
    escalationPathId: z.string().min(1),
    ticketId: z.string().min(1),
  });
  const data = schema.parse(input);
  await runEscalation({
    escalationPathId: data.escalationPathId,
    ticketId: data.ticketId,
    session: { tenantId: session.tenantId, subjectId: session.subjectId, role: session.role },
    source: "button",
  });
  await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      await tx.auditLog.create({
        data: {
          tenantId: session.tenantId,
          ticketId: data.ticketId,
          ...actorCols(dualFkForUser(session.subjectId, session.role)),
          action: "TRIGGER_ESCALATION",
          toValue: data.escalationPathId,
        },
      });
    }
  );
  revalidatePath(`/agent/tickets/${data.ticketId}`);
  return { ok: true as const };
}
