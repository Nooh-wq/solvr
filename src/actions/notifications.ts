"use server";

import { revalidatePath } from "next/cache";
import { withRls } from "@/lib/db";
import { requireSession } from "@/lib/auth";

const LIST_LIMIT = 20;

/** Latest notifications for the current user, newest first — bell dropdown. */
export async function listNotifications() {
  const session = await requireSession();
  const notifications = await withRls(
    { tenantId: session.tenantId, userId: session.id, role: session.role },
    (tx) =>
      tx.notification.findMany({
        where: { tenantId: session.tenantId, userId: session.id },
        orderBy: { createdAt: "desc" },
        take: LIST_LIMIT,
      })
  );

  // Ticket links differ by role (clients live under /portal, staff under
  // /agent) — resolved here so the bell component doesn't need to know
  // about routing.
  const ticketBase = session.role === "CLIENT" ? "/portal/tickets" : "/agent/tickets";
  return notifications.map((n) => ({
    ...n,
    href: n.ticketId ? `${ticketBase}/${n.ticketId}` : null,
  }));
}

export async function getUnreadNotificationCount() {
  const session = await requireSession();
  return withRls({ tenantId: session.tenantId, userId: session.id, role: session.role }, (tx) =>
    tx.notification.count({ where: { tenantId: session.tenantId, userId: session.id, isRead: false } })
  );
}

export async function markNotificationRead(notificationId: string) {
  const session = await requireSession();
  await withRls({ tenantId: session.tenantId, userId: session.id, role: session.role }, (tx) =>
    tx.notification.updateMany({
      where: { id: notificationId, tenantId: session.tenantId, userId: session.id },
      data: { isRead: true },
    })
  );
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function markAllNotificationsRead() {
  const session = await requireSession();
  await withRls({ tenantId: session.tenantId, userId: session.id, role: session.role }, (tx) =>
    tx.notification.updateMany({
      where: { tenantId: session.tenantId, userId: session.id, isRead: false },
      data: { isRead: true },
    })
  );
  revalidatePath("/", "layout");
  return { ok: true };
}
