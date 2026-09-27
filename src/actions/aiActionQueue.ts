"use server";

// M8.3 — agent approval queue actions. Gated on AGENT+. Approving
// runs the tool via the executor (which handles retries + audit);
// rejecting simply flips status. Every decision leaves a durable
// AiActionLog row.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withRls, prisma } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { executeApprovedAction } from "@/lib/ai/tools/executor";
import { actorCols, dualFkForUser } from "@/lib/z1-dual-fk";

const decideSchema = z.object({
  id: z.string().min(1),
  reason: z.string().max(500).optional(),
});

export type QueuedActionDto = {
  id: string;
  toolName: string;
  requiresApproval: boolean;
  argsJson: string;
  ticketReference: string | null;
  ticketId: string | null;
  proposedByRole: string;
  createdAt: string;
};

export async function listPendingAiActions(): Promise<QueuedActionDto[]> {
  const session = await requireSession({ minRole: "AGENT" });
  return withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const rows = await tx.aiActionLog.findMany({
        where: { tenantId: session.tenantId, status: "PROPOSED" },
        orderBy: { createdAt: "desc" },
        include: { tool: { select: { requiresApproval: true } } },
      });
      const ticketIds = rows
        .map((r) => r.ticketId)
        .filter((id): id is string => Boolean(id));
      const tickets = ticketIds.length
        ? await tx.ticket.findMany({
            where: { tenantId: session.tenantId, id: { in: ticketIds } },
            select: { id: true, reference: true },
          })
        : [];
      const refById = new Map(tickets.map((t) => [t.id, t.reference]));

      // A PROPOSED row where requiresApproval=false is a race — the
      // executor should have run it. Surface both, tagged.
      return rows.map((r) => ({
        id: r.id,
        toolName: r.toolName,
        requiresApproval: r.tool.requiresApproval,
        argsJson: JSON.stringify(r.argsJson, null, 2),
        ticketReference: r.ticketId ? refById.get(r.ticketId) ?? null : null,
        ticketId: r.ticketId,
        proposedByRole: r.proposedByRole,
        createdAt: r.createdAt.toISOString(),
      }));
    }
  );
}

export async function approveAiAction(input: z.infer<typeof decideSchema>) {
  const session = await requireSession({ minRole: "AGENT" });
  const data = decideSchema.parse(input);

  // Flip status APPROVED under RLS, then run via executor (which uses
  // prisma directly for its own log updates — the intent here is the
  // agent's decision to approve, cleanly separated from execution).
  await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const row = await tx.aiActionLog.findFirst({
        where: { id: data.id, tenantId: session.tenantId, status: "PROPOSED" },
      });
      if (!row) throw new Error("action not found or already decided");
      await tx.aiActionLog.update({
        where: { id: row.id },
        data: {
          status: "APPROVED",
          approvedBySubjectId: session.subjectId,
          decidedAt: new Date(),
        },
      });
      const dual = dualFkForUser(session.subjectId, session.role);
      await tx.auditLog.create({
        data: {
          tenantId: session.tenantId,
          ticketId: row.ticketId,
          ...actorCols(dual),
          action: "AI_ACTION_APPROVED",
          toValue: row.toolName,
        },
      });
    }
  );

  const outcome = await executeApprovedAction(data.id);
  revalidatePath("/agent/ai-actions");
  return outcome;
}

export async function rejectAiAction(input: z.infer<typeof decideSchema>) {
  const session = await requireSession({ minRole: "AGENT" });
  const data = decideSchema.parse(input);
  return withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const row = await tx.aiActionLog.findFirst({
        where: { id: data.id, tenantId: session.tenantId, status: "PROPOSED" },
      });
      if (!row) throw new Error("action not found or already decided");
      await tx.aiActionLog.update({
        where: { id: row.id },
        data: {
          status: "REJECTED",
          approvedBySubjectId: session.subjectId,
          decidedAt: new Date(),
          errorMessage: data.reason ?? null,
        },
      });
      const dual = dualFkForUser(session.subjectId, session.role);
      await tx.auditLog.create({
        data: {
          tenantId: session.tenantId,
          ticketId: row.ticketId,
          ...actorCols(dual),
          action: "AI_ACTION_REJECTED",
          toValue: row.toolName,
          fromValue: data.reason ?? undefined,
        },
      });
      revalidatePath("/agent/ai-actions");
      return { ok: true };
    }
  );
}

export async function countPendingAiActions(): Promise<number> {
  const session = await requireSession({ minRole: "AGENT" });
  return prisma.aiActionLog.count({
    where: { tenantId: session.tenantId, status: "PROPOSED" },
  });
}
