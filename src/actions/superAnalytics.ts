"use server";

import { prisma, withRls } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { getCurrentTenant } from "@/lib/current-tenant";

// M13.10 — cross-tenant health snapshot for host-tenant Super Admins.
// Never queried through the app runtime under a tenant-scoped RLS
// context — the host Super Admin session already lives on the
// INTERNAL tenant, so `withRls` set to that tenant would filter
// everyone else out. Instead we run these reads under `prisma`
// directly (the migration-owning connection that bypasses RLS by
// design for host-tenant ops) but only *after* an explicit gate
// verifies the caller is host-tenant SUPER_ADMIN.

async function requireHostSuperAdmin() {
  const user = await getSessionUser();
  if (!user) throw new Error("Unauthenticated.");
  if (user.role !== "SUPER_ADMIN") throw new Error("Super Admin only.");
  const tenant = await getCurrentTenant();
  if (tenant.type !== "INTERNAL") throw new Error("Host-tenant only.");
  return user;
}

export type TenantHealthRow = {
  tenantId: string;
  tenantName: string;
  slug: string;
  status: string;
  totalTickets30d: number;
  resolvedTickets30d: number;
  avgFirstResponseHours: number | null;
  outboundEmails30d: number;
  chatConversations30d: number;
};

export async function loadCrossTenantHealth(): Promise<TenantHealthRow[]> {
  await requireHostSuperAdmin();
  const since = new Date();
  since.setDate(since.getDate() - 30);

  const tenants = await prisma.tenant.findMany({
    where: { slug: { not: { startsWith: "_z18-staging-" } } },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, slug: true, status: true },
  });
  if (tenants.length === 0) return [];

  // Batched aggregates. Prisma `groupBy` respects the RLS-off root
  // client here so a single query fans out across every tenant.
  const [ticketAgg, resolvedAgg, chatAgg, firstReplies] = await Promise.all([
    prisma.ticket.groupBy({
      by: ["tenantId"],
      _count: { _all: true },
      where: { createdAt: { gte: since } },
    }),
    prisma.ticket.groupBy({
      by: ["tenantId"],
      _count: { _all: true },
      where: { createdAt: { gte: since }, resolvedAt: { not: null } },
    }),
    prisma.chatConversation.groupBy({
      by: ["tenantId"],
      _count: { _all: true },
      where: { createdAt: { gte: since } },
    }),
    prisma.ticket.findMany({
      where: { createdAt: { gte: since }, firstReplyAt: { not: null } },
      select: { tenantId: true, createdAt: true, firstReplyAt: true },
    }),
  ]);

  const ticketByTenant = new Map(ticketAgg.map((r) => [r.tenantId, r._count._all]));
  const resolvedByTenant = new Map(resolvedAgg.map((r) => [r.tenantId, r._count._all]));
  const chatByTenant = new Map(chatAgg.map((r) => [r.tenantId, r._count._all]));
  const responseAccByTenant = new Map<string, { sum: number; n: number }>();
  for (const r of firstReplies) {
    const delta = r.firstReplyAt!.getTime() - r.createdAt.getTime();
    const acc = responseAccByTenant.get(r.tenantId) ?? { sum: 0, n: 0 };
    acc.sum += delta;
    acc.n += 1;
    responseAccByTenant.set(r.tenantId, acc);
  }

  // Outbound email volume proxy: notifications rows created in-window.
  // Approximate — a per-recipient in-app notification is written for
  // most events; the exact count of *sent* emails would require an
  // outbound-email log, which we don't materialize per-tenant today.
  const notificationAgg = await prisma.notification.groupBy({
    by: ["tenantId"],
    _count: { _all: true },
    where: { createdAt: { gte: since } },
  });
  const notifByTenant = new Map(notificationAgg.map((r) => [r.tenantId, r._count._all]));

  return tenants.map((t) => {
    const acc = responseAccByTenant.get(t.id);
    return {
      tenantId: t.id,
      tenantName: t.name,
      slug: t.slug,
      status: t.status,
      totalTickets30d: ticketByTenant.get(t.id) ?? 0,
      resolvedTickets30d: resolvedByTenant.get(t.id) ?? 0,
      avgFirstResponseHours: acc && acc.n > 0 ? acc.sum / acc.n / (1000 * 60 * 60) : null,
      outboundEmails30d: notifByTenant.get(t.id) ?? 0,
      chatConversations30d: chatByTenant.get(t.id) ?? 0,
    };
  });
}
