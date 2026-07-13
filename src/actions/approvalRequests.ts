"use server";

// M15.3 — generalized ApprovalRequest actions.
//
// State machine:
//   PENDING → APPROVED (all steps decided approve)
//   PENDING → REJECTED (any step decides reject)
//   PENDING → EXPIRED  (cron sees expiresAt passed)
//
// Only the caller whose subject id equals approvers[currentStep] may
// act on a PENDING request. That's enforced twice: RLS is
// tenant-scoped, and we gate the decision check server-side. The
// spec §3 pin ("never let a request die silently") lives in the
// nightly expire cron below.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withRls, prisma } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { actorCols, dualFkForUser } from "@/lib/z1-dual-fk";

const decideSchema = z.object({
  id: z.string().min(1),
  note: z.string().max(500).optional(),
});

export type ApprovalDto = {
  id: string;
  ticketId: string;
  ticketReference: string | null;
  ticketTitle: string;
  status: string;
  currentStep: number;
  totalSteps: number;
  isMyTurn: boolean;
  approverSubjectIds: string[];
  expiresAt: string;
  createdAt: string;
};

/** Approvals whose current step is the caller. Ordered oldest-first. */
export async function listPendingApprovalsForMe(): Promise<ApprovalDto[]> {
  const session = await requireSession();
  return withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const rows = await tx.approvalRequest.findMany({
        where: { tenantId: session.tenantId, status: "PENDING" },
        orderBy: { createdAt: "asc" },
      });
      const mine = rows.filter((r) => {
        const approvers = Array.isArray(r.approverSubjectIds)
          ? (r.approverSubjectIds as string[])
          : [];
        return approvers[r.currentStep] === session.subjectId;
      });
      const ticketIds = mine.map((r) => r.ticketId);
      const tickets = ticketIds.length
        ? await tx.ticket.findMany({
            where: { tenantId: session.tenantId, id: { in: ticketIds } },
            select: { id: true, reference: true, title: true },
          })
        : [];
      const byId = new Map(tickets.map((t) => [t.id, t]));
      return mine.map((r) => {
        const t = byId.get(r.ticketId);
        return {
          id: r.id,
          ticketId: r.ticketId,
          ticketReference: t?.reference ?? null,
          ticketTitle: t?.title ?? "(untitled)",
          status: r.status,
          currentStep: r.currentStep,
          totalSteps: r.totalSteps,
          isMyTurn: true,
          approverSubjectIds: Array.isArray(r.approverSubjectIds)
            ? (r.approverSubjectIds as string[])
            : [],
          expiresAt: r.expiresAt.toISOString(),
          createdAt: r.createdAt.toISOString(),
        };
      });
    }
  );
}

async function decideCore(id: string, decision: "APPROVED" | "REJECTED", note?: string) {
  const session = await requireSession();
  return withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const row = await tx.approvalRequest.findFirst({
        where: { id, tenantId: session.tenantId, status: "PENDING" },
      });
      if (!row) throw new Error("Approval not found or already decided");
      const approvers = Array.isArray(row.approverSubjectIds)
        ? (row.approverSubjectIds as string[])
        : [];
      if (approvers[row.currentStep] !== session.subjectId) {
        throw new Error("Not your turn to decide");
      }
      const priorDecisions = Array.isArray(row.decisionsJson)
        ? (row.decisionsJson as Array<{
            step: number;
            subjectId: string;
            decision: string;
            note?: string;
            at: string;
          }>)
        : [];
      const decisions = [
        ...priorDecisions,
        {
          step: row.currentStep,
          subjectId: session.subjectId,
          decision,
          note,
          at: new Date().toISOString(),
        },
      ];

      // Reject terminates. Approve either advances the step or completes.
      const isFinalStep = row.currentStep + 1 >= row.totalSteps;
      const nextStatus =
        decision === "REJECTED"
          ? "REJECTED"
          : isFinalStep
            ? "APPROVED"
            : "PENDING";
      const nextStep = decision === "APPROVED" && !isFinalStep ? row.currentStep + 1 : row.currentStep;

      await tx.approvalRequest.update({
        where: { id: row.id },
        data: {
          status: nextStatus,
          currentStep: nextStep,
          decisionsJson: decisions as never,
          decidedAt: nextStatus === "PENDING" ? null : new Date(),
        },
      });

      // On final APPROVED, unlock the ticket for fulfilment. The
      // simplest, spec-aligned move: flip PENDING → OPEN. Downstream
      // M1 rules (auto_route etc.) still run against the updated
      // ticket via existing triggers.
      if (nextStatus === "APPROVED") {
        await tx.ticket.update({
          where: { id: row.ticketId },
          data: { status: "OPEN" },
        });
      }
      if (nextStatus === "REJECTED") {
        await tx.ticket.update({
          where: { id: row.ticketId },
          data: { status: "CLOSED" },
        });
      }

      const dual = dualFkForUser(session.subjectId, session.role);
      await tx.auditLog.create({
        data: {
          tenantId: session.tenantId,
          ticketId: row.ticketId,
          ...actorCols(dual),
          action: decision === "APPROVED" ? "APPROVAL_APPROVED" : "APPROVAL_REJECTED",
          toValue: `step ${row.currentStep + 1}/${row.totalSteps}`,
        },
      });

      revalidatePath("/portal/approvals");
      revalidatePath(`/agent/tickets/${row.ticketId}`);
      revalidatePath(`/portal/tickets/${row.ticketId}`);
      return { ok: true, status: nextStatus };
    }
  );
}

export async function approveRequest(input: z.infer<typeof decideSchema>) {
  const data = decideSchema.parse(input);
  return decideCore(data.id, "APPROVED", data.note);
}

export async function rejectRequest(input: z.infer<typeof decideSchema>) {
  const data = decideSchema.parse(input);
  return decideCore(data.id, "REJECTED", data.note);
}

/** M15.3 cron entry point — flip expired PENDING requests to EXPIRED. Emits AuditLog per row. */
export async function expireStaleApprovals(): Promise<{ expired: number }> {
  const now = new Date();
  const stale = await prisma.approvalRequest.findMany({
    where: { status: "PENDING", expiresAt: { lt: now } },
    select: { id: true, tenantId: true, ticketId: true },
  });
  for (const r of stale) {
    await prisma.$transaction([
      prisma.approvalRequest.update({
        where: { id: r.id },
        data: { status: "EXPIRED", decidedAt: now },
      }),
      prisma.auditLog.create({
        data: {
          tenantId: r.tenantId,
          ticketId: r.ticketId,
          action: "APPROVAL_EXPIRED",
        },
      }),
    ]);
  }
  return { expired: stale.length };
}

export async function countPendingApprovalsForMe(): Promise<number> {
  const session = await requireSession();
  const rows = await prisma.approvalRequest.findMany({
    where: { tenantId: session.tenantId, status: "PENDING" },
    select: { approverSubjectIds: true, currentStep: true },
  });
  let n = 0;
  for (const r of rows) {
    const approvers = Array.isArray(r.approverSubjectIds)
      ? (r.approverSubjectIds as string[])
      : [];
    if (approvers[r.currentStep] === session.subjectId) n++;
  }
  return n;
}
