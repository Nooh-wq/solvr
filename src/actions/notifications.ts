"use server";

import { revalidatePath } from "next/cache";
import { withRls } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { notificationRecipientWhereFor } from "@/lib/z1-dual-fk";

const LIST_LIMIT = 20;

/** Latest notifications for the current user, newest first — bell dropdown. */
export async function listNotifications() {
  const session = await requireSession();
  const recipient = notificationRecipientWhereFor(session.subjectId, session.role);
  const notifications = await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    (tx) =>
      tx.notification.findMany({
        where: { tenantId: session.tenantId, ...recipient },
        orderBy: { createdAt: "desc" },
        take: LIST_LIMIT,
      })
  );

  const ticketBase = session.role === "CLIENT" ? "/portal/tickets" : "/agent/tickets";
  return notifications.map((n) => ({
    ...n,
    href: n.ticketId ? `${ticketBase}/${n.ticketId}` : null,
  }));
}

/**
 * List + unread count in a SINGLE transaction. The bell polls both every 30s;
 * fetching them as two parallel server actions meant two transactions racing
 * for the same pooled connection, so the second reliably threw P2028 ("unable
 * to start a transaction in time") whenever the pool was busy. One round-trip
 * removes that self-inflicted contention entirely.
 */
export async function getNotificationSnapshot() {
  const session = await requireSession();
  const ctx = { tenantId: session.tenantId, userId: session.subjectId, role: session.role };
  const recipient = notificationRecipientWhereFor(session.subjectId, session.role);
  const { notifications, unreadCount } = await withRls(ctx, async (tx) => {
    const notifications = await tx.notification.findMany({
      where: { tenantId: session.tenantId, ...recipient },
      orderBy: { createdAt: "desc" },
      take: LIST_LIMIT,
    });
    const unreadCount = await tx.notification.count({
      where: { tenantId: session.tenantId, ...recipient, isRead: false },
    });
    return { notifications, unreadCount };
  });

  const ticketBase = session.role === "CLIENT" ? "/portal/tickets" : "/agent/tickets";
  return {
    unreadCount,
    notifications: notifications.map((n) => ({
      ...n,
      href: n.ticketId ? `${ticketBase}/${n.ticketId}` : null,
    })),
  };
}

export async function markNotificationRead(notificationId: string) {
  const session = await requireSession();
  const recipient = notificationRecipientWhereFor(session.subjectId, session.role);
  await withRls({ tenantId: session.tenantId, userId: session.subjectId, role: session.role }, (tx) =>
    tx.notification.updateMany({
      where: { id: notificationId, tenantId: session.tenantId, ...recipient },
      data: { isRead: true },
    })
  );
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function markAllNotificationsRead() {
  const session = await requireSession();
  const recipient = notificationRecipientWhereFor(session.subjectId, session.role);
  await withRls({ tenantId: session.tenantId, userId: session.subjectId, role: session.role }, (tx) =>
    tx.notification.updateMany({
      where: { tenantId: session.tenantId, ...recipient, isRead: false },
      data: { isRead: true },
    })
  );
  revalidatePath("/", "layout");
  return { ok: true };
}
