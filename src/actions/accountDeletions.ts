"use server";

// M21.6 admin side — list + approve/reject account deletion requests.
// The user-submitted rows land here from actions/dangerZone.ts's
// requestAccountDeletion(). Approve calls through the wrapper's
// deleteEndUser / deleteTeamMember which enforce the same last-Super-Admin
// guard as the manual admin delete path — a doomed request lands as
// PENDING and gets rejected here, rather than silently accepted.

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { withRls } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import {
  systemContext,
  getEndUsersByIds,
  getTeamMembersByIds,
  deleteEndUser,
  deleteTeamMember,
} from "@/lib/shared-platform";

export type PendingDeletionRow = {
  id: string;
  subjectId: string;
  name: string | null;
  email: string;
  kind: "END_USER" | "TEAM_MEMBER" | "UNKNOWN";
  reason: string | null;
  createdAt: Date;
};

export async function listPendingAccountDeletions(): Promise<PendingDeletionRow[]> {
  const session = await requireSession({ minRole: "ADMIN" });
  const rows = await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    (tx) =>
      tx.accountDeletionRequest.findMany({
        where: { tenantId: session.tenantId, status: "PENDING" },
        orderBy: { createdAt: "asc" },
      })
  );
  if (rows.length === 0) return [];

  const ctx = systemContext(session.tenantId);
  const ids = rows.map((r) => r.subjectId);
  const [endUsers, teamMembers] = await Promise.all([
    getEndUsersByIds(ctx, ids),
    getTeamMembersByIds(ctx, ids),
  ]);
  return rows.map((r) => {
    const eu = endUsers.get(r.subjectId);
    const tm = teamMembers.get(r.subjectId);
    if (eu) return { id: r.id, subjectId: r.subjectId, name: eu.name, email: eu.email, kind: "END_USER", reason: r.reason, createdAt: r.createdAt };
    if (tm) return { id: r.id, subjectId: r.subjectId, name: tm.name, email: tm.email, kind: "TEAM_MEMBER", reason: r.reason, createdAt: r.createdAt };
    return {
      id: r.id,
      subjectId: r.subjectId,
      name: null,
      email: "(unknown)",
      kind: "UNKNOWN",
      reason: r.reason,
      createdAt: r.createdAt,
    };
  });
}

const idSchema = z.object({ requestId: z.string().min(1) });

export async function approveAccountDeletion(input: z.infer<typeof idSchema>): Promise<
  { ok: true } | { error: string }
> {
  const session = await requireSession({ minRole: "ADMIN" });
  const data = idSchema.parse(input);

  const request = await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    (tx) =>
      tx.accountDeletionRequest.findFirst({
        where: { id: data.requestId, tenantId: session.tenantId, status: "PENDING" },
      })
  );
  if (!request) return { error: "Request no longer pending." };

  // Route through the wrapper's tenant-aware delete. It re-checks the
  // last-Super-Admin guard, so even if state changed between submission
  // and approval this stays safe.
  const ctx = systemContext(session.tenantId);
  try {
    const [euMap, tmMap] = await Promise.all([
      getEndUsersByIds(ctx, [request.subjectId]),
      getTeamMembersByIds(ctx, [request.subjectId]),
    ]);
    if (tmMap.has(request.subjectId)) {
      await deleteTeamMember(ctx, request.subjectId);
    } else if (euMap.has(request.subjectId)) {
      await deleteEndUser(ctx, request.subjectId);
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : "Deletion failed.";
    return { error: message };
  }

  await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    (tx) =>
      tx.accountDeletionRequest.update({
        where: { id: request.id },
        data: {
          status: "APPROVED",
          reviewedById: session.subjectId,
          reviewedAt: new Date(),
        },
      })
  );

  revalidatePath("/admin/account-deletions");
  revalidatePath("/admin/team");
  return { ok: true };
}

export async function rejectAccountDeletion(input: z.infer<typeof idSchema>): Promise<
  { ok: true } | { error: string }
> {
  const session = await requireSession({ minRole: "ADMIN" });
  const data = idSchema.parse(input);
  const result = await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const r = await tx.accountDeletionRequest.updateMany({
        where: { id: data.requestId, tenantId: session.tenantId, status: "PENDING" },
        data: {
          status: "REJECTED",
          reviewedById: session.subjectId,
          reviewedAt: new Date(),
        },
      });
      return r.count;
    }
  );
  if (result === 0) return { error: "Request no longer pending." };
  revalidatePath("/admin/account-deletions");
  return { ok: true };
}
