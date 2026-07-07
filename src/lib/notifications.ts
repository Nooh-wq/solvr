import type { PrismaClient } from "@/generated/prisma";
import { systemContext, getEndUsersByIds, getTeamMembersByIds } from "@/lib/shared-platform";

export type NotificationType =
  | "TICKET_REPLY"
  | "STATUS_CHANGE"
  | "ASSIGNED"
  | "REGISTRATION_PENDING"
  | "REGISTRATION_APPROVED"
  | "REGISTRATION_REJECTED";

export type NotificationInput = {
  tenantId: string;
  userId: string;
  type: NotificationType;
  title: string;
  body?: string;
  ticketId?: string;
};

/**
 * Writes one or more notifications inside an existing `withRls` transaction
 * — call this alongside the DB work in the same transaction that triggers
 * it (e.g. postAgentReply's message insert), not as a separate round trip.
 *
 * Always goes through `createMany`, never `.create()`: Prisma's `.create()`
 * does an implicit `RETURNING`, which Postgres checks against the table's
 * SELECT policies before returning the row — and the actor writing a
 * notification is essentially never its recipient (a client's reply
 * notifies the *assigned agent*), so that RETURNING check would fail under
 * RLS the same way it originally did on audit_logs (see rls_policies.sql's
 * comment on that table). `createMany` has no RETURNING, sidestepping the
 * problem entirely — nothing here needs the created row back anyway.
 */
export async function notify(
  tx: Pick<PrismaClient, "notification">,
  ...inputs: NotificationInput[]
): Promise<void> {
  if (inputs.length === 0) return;

  // Z1.4b: resolve recipient role via wrapper (batched). Notify()
  // callers pass tenantId per input; every call today groups its
  // notifications within a single tenant, so bucketing by tenantId is
  // a defense-in-depth: if a future caller ever mixes tenants, the
  // wrapper's tenant-scoped RLS naturally isolates each bucket.
  const idsByTenant = new Map<string, Set<string>>();
  for (const n of inputs) {
    if (!idsByTenant.has(n.tenantId)) idsByTenant.set(n.tenantId, new Set());
    idsByTenant.get(n.tenantId)!.add(n.userId);
  }
  const roleById = new Map<string, "END_USER" | "TEAM_MEMBER">();
  for (const [tenantId, idSet] of idsByTenant) {
    const wrapperCtx = systemContext(tenantId);
    const ids = [...idSet];
    const [endUsers, teamMembers] = await Promise.all([
      getEndUsersByIds(wrapperCtx, ids),
      getTeamMembersByIds(wrapperCtx, ids),
    ]);
    for (const id of ids) {
      if (endUsers.has(id)) roleById.set(id, "END_USER");
      else if (teamMembers.has(id)) roleById.set(id, "TEAM_MEMBER");
      // absent: recipient exists in legacy users only (e.g. a fresh
      // user created but never backfilled). Both dual-FK cols stay
      // null — allowed by notifications_recipient_exclusive (<=1).
    }
  }

  await tx.notification.createMany({
    data: inputs.map((n) => {
      const kind = roleById.get(n.userId);
      return {
        tenantId: n.tenantId,
        userId: n.userId,
        recipientEndUserId: kind === "END_USER" ? n.userId : null,
        recipientTeamMemberId: kind === "TEAM_MEMBER" ? n.userId : null,
        type: n.type,
        title: n.title,
        body: n.body,
        ticketId: n.ticketId,
      };
    }),
  });
}
