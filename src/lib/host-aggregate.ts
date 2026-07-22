// F1 (QA follow-up) — count-only cross-tenant aggregates for the host
// super-admin health dashboard.
//
// This is the ONLY module in the app that connects on the migration-owning
// role (DIRECT_URL), which bypasses RLS. Its blast radius is deliberately
// one file, and its public contract is strict:
//
//   * It performs ONLY `.count()` aggregates and returns ONLY integers —
//     never row content. The host operator gets full cross-tenant visibility
//     into *how many* without any ability to read another tenant's rows, so
//     RLS stays the boundary for everything that carries data (principle of
//     least privilege + auditability — see docs/qa/findings.md F1).
//   * Callers MUST already have passed requireHostSuperAdmin(). This module
//     does no auth of its own; it assumes the caller gated on host SUPER_ADMIN.
//
// Contrast with `withRls` (src/lib/db.ts): that path is tenant-scoped and is
// the ONLY way to touch tenant *data*. This path is bypass + count-only and
// exists solely so the health tiles read true cross-tenant totals instead of
// the host-tenant-only subset a SUPER_ADMIN withRls context would return for
// tenant_isolation-only tables.

import { PrismaClient } from "@/generated/prisma";

declare global {
  // eslint-disable-next-line no-var
  var __hostAggregatePrisma: PrismaClient | undefined;
}

// DIRECT_URL is the migration owner (superuser/BYPASSRLS on this deployment —
// verified: it reads every tenant's rows with no app.* GUC set). Fall back to
// DATABASE_URL only if DIRECT_URL is unset (local PGlite dev, where there is
// no meaningful RLS-bypass distinction anyway).
const ownerUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL;

const hostAggregatePrisma =
  globalThis.__hostAggregatePrisma ??
  new PrismaClient({ datasources: { db: { url: ownerUrl } } });
if (process.env.NODE_ENV !== "production") globalThis.__hostAggregatePrisma = hostAggregatePrisma;

export type HostHealthCounts = {
  tenants: number;
  activeTenants: number;
  tickets: number;
  openTickets: number;
  users: number;
  messagesLast24h: number;
  failedWebhooksLast24h: number;
  failedApiCallsLast24h: number;
  csatQueueDepth: number;
  digestQueueDepth: number;
  pendingApprovals: number;
};

/**
 * Cross-tenant count-only health aggregates for the host super-admin
 * dashboard. Runs on the BYPASSRLS owner connection.
 *
 * CONTRACT: performs only `.count()` aggregates; returns only integers.
 * The caller MUST have already passed requireHostSuperAdmin() — this
 * function does not authenticate.
 *
 * @param dayAgo cutoff for the "last 24h" tiles (messages, failed webhooks/API).
 */
export async function getHostHealthCounts(dayAgo: Date): Promise<HostHealthCounts> {
  const p = hostAggregatePrisma;
  const [
    tenants,
    activeTenants,
    tickets,
    openTickets,
    endUsers,
    teamMembers,
    messagesLast24h,
    failedWebhooksLast24h,
    failedApiCallsLast24h,
    csatQueueDepth,
    digestQueueDepth,
    pendingApprovals,
  ] = await Promise.all([
    p.tenant.count(),
    p.tenant.count({ where: { status: "ACTIVE" } }),
    p.ticket.count(),
    p.ticket.count({ where: { status: { in: ["OPEN", "IN_PROGRESS", "PENDING"] } } }),
    p.endUser.count(),
    p.teamMember.count(),
    p.message.count({ where: { createdAt: { gte: dayAgo } } }),
    p.webhookSubscription.count({ where: { disabledAt: { not: null, gte: dayAgo } } }),
    p.apiUsageLog.count({ where: { createdAt: { gte: dayAgo }, statusCode: { gte: 500 } } }),
    p.csatQueue.count({ where: { sentAt: null } }),
    // digest_queue rows are deleted after the daily send, so every
    // remaining row is by definition still pending.
    p.digestQueue.count(),
    p.approvalRequest.count({ where: { status: "PENDING" } }),
  ]);

  return {
    tenants,
    activeTenants,
    tickets,
    openTickets,
    users: endUsers + teamMembers,
    messagesLast24h,
    failedWebhooksLast24h,
    failedApiCallsLast24h,
    csatQueueDepth,
    digestQueueDepth,
    pendingApprovals,
  };
}
