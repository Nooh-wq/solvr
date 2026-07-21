"use server";

// Phase 4c — Super Admin additions:
//   - System health snapshot
//   - Feature flag CRUD (per-tenant)
//   - Support tickets list (cross-tenant, for the INTERNAL host tenant)
//
// All actions gate on host-tenant SUPER_ADMIN via requireSession + a
// tenant-type check, matching super.ts's requireHostSuperAdmin().

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withRls, prisma } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { FEATURE_FLAGS, type FeatureFlagKey } from "@/lib/feature-flags";

async function requireHostSuperAdmin() {
  const session = await requireSession({ minRole: "SUPER_ADMIN" });
  const tenant = await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    (tx) => tx.tenant.findUniqueOrThrow({ where: { id: session.tenantId } })
  );
  if (tenant.type !== "INTERNAL") throw new Error("FORBIDDEN");
  return session;
}

// -- System health ----------------------------------------------------------

export type SystemHealth = {
  db: { ok: boolean; latencyMs: number };
  counts: {
    tenants: number;
    activeTenants: number;
    tickets: number;
    openTickets: number;
    users: number;
    messagesLast24h: number;
  };
  errors: {
    errorLogsLast24h: number;
    failedWebhooksLast24h: number;
    failedApiCallsLast24h: number;
  };
  queues: {
    csatQueueDepth: number;
    digestQueueDepth: number;
    pendingApprovals: number;
  };
  updatedAt: Date;
};

export async function getSystemHealth(): Promise<SystemHealth> {
  await requireHostSuperAdmin();
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const dbStart = Date.now();
  let dbOk = true;
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    dbOk = false;
  }
  const dbLatency = Date.now() - dbStart;

  // Super Admin sees every tenant (see M13 cross-tenant health pattern).
  const [
    tenants,
    activeTenants,
    tickets,
    openTickets,
    endUsers,
    teamMembers,
    recentMessages,
    failedWebhooks,
    failedApiCalls,
    csatDepth,
    digestDepth,
    pendingApprovals,
  ] = await Promise.all([
    prisma.tenant.count(),
    prisma.tenant.count({ where: { status: "ACTIVE" } }),
    prisma.ticket.count(),
    prisma.ticket.count({ where: { status: { in: ["OPEN", "IN_PROGRESS", "PENDING"] } } }),
    prisma.endUser.count(),
    prisma.teamMember.count(),
    prisma.message.count({ where: { createdAt: { gte: dayAgo } } }),
    prisma.webhookSubscription.count({
      where: { disabledAt: { not: null, gte: dayAgo } },
    }),
    prisma.apiUsageLog.count({
      where: { createdAt: { gte: dayAgo }, statusCode: { gte: 500 } },
    }),
    prisma.csatQueue.count({ where: { sentAt: null } }),
    // digest_queue rows are deleted after the daily send, so every
    // remaining row is by definition still pending.
    prisma.digestQueue.count(),
    prisma.approvalRequest.count({ where: { status: "PENDING" } }),
  ]);

  return {
    db: { ok: dbOk, latencyMs: dbLatency },
    counts: {
      tenants,
      activeTenants,
      tickets,
      openTickets,
      users: endUsers + teamMembers,
      messagesLast24h: recentMessages,
    },
    errors: {
      errorLogsLast24h: 0,
      failedWebhooksLast24h: failedWebhooks,
      failedApiCallsLast24h: failedApiCalls,
    },
    queues: {
      csatQueueDepth: csatDepth,
      digestQueueDepth: digestDepth,
      pendingApprovals,
    },
    updatedAt: new Date(),
  };
}

// -- Feature flags ----------------------------------------------------------

export type FeatureFlagRow = {
  tenantId: string;
  tenantName: string;
  slug: string;
  type: string;
  flags: Record<string, boolean>;
};

export async function listTenantsWithFlags(): Promise<FeatureFlagRow[]> {
  await requireHostSuperAdmin();
  const tenants = await prisma.tenant.findMany({
    orderBy: [{ type: "asc" }, { name: "asc" }],
    select: { id: true, name: true, slug: true, type: true, featureFlags: true },
  });
  return tenants.map((t) => ({
    tenantId: t.id,
    tenantName: t.name,
    slug: t.slug,
    type: t.type,
    flags: (t.featureFlags && typeof t.featureFlags === "object"
      ? (t.featureFlags as Record<string, boolean>)
      : {}) as Record<string, boolean>,
  }));
}

const setFlagSchema = z.object({
  tenantId: z.string().min(1),
  key: z.string().min(1),
  enabled: z.boolean(),
});

export async function setFeatureFlag(
  input: z.infer<typeof setFlagSchema>
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = setFlagSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input." };
  const knownKeys = new Set(FEATURE_FLAGS.map((f) => f.key));
  if (!knownKeys.has(parsed.data.key as FeatureFlagKey)) {
    return { ok: false, error: "Unknown flag." };
  }
  await requireHostSuperAdmin();

  const t = await prisma.tenant.findUniqueOrThrow({
    where: { id: parsed.data.tenantId },
    select: { featureFlags: true },
  });
  const current =
    t.featureFlags && typeof t.featureFlags === "object"
      ? (t.featureFlags as Record<string, boolean>)
      : {};
  const next = { ...current, [parsed.data.key]: parsed.data.enabled };
  await prisma.tenant.update({
    where: { id: parsed.data.tenantId },
    data: { featureFlags: next },
  });
  revalidatePath("/admin/super/flags");
  return { ok: true };
}

// -- Support tickets (cross-tenant) -----------------------------------------

export type SupportTicketRow = {
  id: string;
  reference: string;
  title: string;
  status: string;
  priority: string;
  tenantName: string;
  tenantSlug: string;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * Cross-tenant view of every ticket where the requester belongs to a
 * CLIENT tenant — i.e. tickets in the host INTERNAL tenant *and* the
 * customer's own tickets. Used by the Solvr support team to see what
 * customers are dealing with without leaving super-admin mode.
 *
 * Filter: default to OPEN + IN_PROGRESS + PENDING.
 */
export async function listSupportTickets(opts?: {
  includeClosed?: boolean;
  limit?: number;
}): Promise<SupportTicketRow[]> {
  await requireHostSuperAdmin();
  const limit = Math.min(opts?.limit ?? 100, 500);
  const rows = await prisma.ticket.findMany({
    where: opts?.includeClosed
      ? undefined
      : { status: { in: ["OPEN", "IN_PROGRESS", "PENDING"] } },
    orderBy: { updatedAt: "desc" },
    take: limit,
    select: {
      id: true,
      reference: true,
      title: true,
      status: true,
      priority: true,
      createdAt: true,
      updatedAt: true,
      tenant: { select: { name: true, slug: true, type: true } },
    },
  });

  return rows
    .filter((r) => r.tenant.type !== "INTERNAL") // customer tickets only
    .map((r) => ({
      id: r.id,
      reference: r.reference,
      title: r.title,
      status: r.status,
      priority: r.priority,
      tenantName: r.tenant.name,
      tenantSlug: r.tenant.slug,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));
}
