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
export async function notify(tx: Pick<PrismaClient, "notification">, ...inputs: NotificationInput[]): Promise<void> {
  if (inputs.length === 0) return;
  await tx.notification.createMany({
    data: inputs.map((n) => ({
      tenantId: n.tenantId,
      userId: n.userId,
      type: n.type,
      title: n.title,
      body: n.body,
      ticketId: n.ticketId,
    })),
  });
}
