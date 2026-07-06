import type { PrismaClient } from "@/generated/prisma";

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
  tx: Pick<PrismaClient, "notification" | "user">,
  ...inputs: NotificationInput[]
): Promise<void> {
  if (inputs.length === 0) return;

  // Z1.4a: dual-write the recipient dual-FK columns. Batch a single
  // findMany() to resolve each recipient's role rather than N-per-notify
  // round-trips. RLS is scoped to tenantId (same tenant for every
  // recipient in one notify() call — server actions always pass one
  // tenantId), so this stays inside the caller's transaction.
  const userIds = Array.from(new Set(inputs.map((n) => n.userId)));
  const users = await tx.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, role: true },
  });
  const roleById = new Map(users.map((u) => [u.id, u.role]));

  await tx.notification.createMany({
    data: inputs.map((n) => {
      const role = roleById.get(n.userId);
      return {
        tenantId: n.tenantId,
        userId: n.userId,
        recipientEndUserId: role === "CLIENT" ? n.userId : null,
        recipientTeamMemberId:
          role === "AGENT" || role === "ADMIN" || role === "SUPER_ADMIN" ? n.userId : null,
        type: n.type,
        title: n.title,
        body: n.body,
        ticketId: n.ticketId,
      };
    }),
  });
}
