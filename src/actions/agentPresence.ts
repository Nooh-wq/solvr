"use server";

// M4.1 — agent presence heartbeat + availability toggle. Kept in its
// own action module (not merged into agentProfile) because presence is
// high-churn (~30s heartbeats) and agentProfile is semi-static routing
// metadata. Spec §3: presence NEVER crosses tenant boundaries — every
// read/write is scoped by session.tenantId + withRls.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withRls, prisma } from "@/lib/db";
import { requireSession } from "@/lib/auth";

const PRESENCE_STATUSES = ["ONLINE", "AWAY", "OFFLINE"] as const;
export type PresenceStatus = (typeof PRESENCE_STATUSES)[number];

/** After this window with no heartbeat, the sweep flips status → OFFLINE. */
export const STALE_HEARTBEAT_MS = 90_000;

const setStatusSchema = z.object({ status: z.enum(PRESENCE_STATUSES) });

/**
 * Bump the caller's lastHeartbeatAt. Idempotent; safe to poll from
 * the agent workspace on an interval. Auto-inserts the row on first
 * heartbeat.
 */
export async function heartbeat(): Promise<{ ok: true }> {
  const session = await requireSession({ minRole: "AGENT" });
  await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      await tx.agentPresence.upsert({
        where: {
          tenantId_teamMemberId: {
            tenantId: session.tenantId,
            teamMemberId: session.subjectId,
          },
        },
        create: {
          tenantId: session.tenantId,
          teamMemberId: session.subjectId,
          status: "ONLINE",
          lastHeartbeatAt: new Date(),
        },
        update: { lastHeartbeatAt: new Date() },
      });
    }
  );
  return { ok: true };
}

export async function setPresenceStatus(input: z.infer<typeof setStatusSchema>) {
  const session = await requireSession({ minRole: "AGENT" });
  const { status } = setStatusSchema.parse(input);
  await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      await tx.agentPresence.upsert({
        where: {
          tenantId_teamMemberId: {
            tenantId: session.tenantId,
            teamMemberId: session.subjectId,
          },
        },
        create: {
          tenantId: session.tenantId,
          teamMemberId: session.subjectId,
          status,
          lastHeartbeatAt: new Date(),
        },
        update: { status, lastHeartbeatAt: new Date() },
      });
    }
  );
  revalidatePath("/agent");
  revalidatePath("/agent/live-chat");
  return { ok: true, status };
}

export async function getMyPresence(): Promise<{ status: PresenceStatus }> {
  const session = await requireSession({ minRole: "AGENT" });
  return withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const row = await tx.agentPresence.findUnique({
        where: {
          tenantId_teamMemberId: {
            tenantId: session.tenantId,
            teamMemberId: session.subjectId,
          },
        },
      });
      return { status: (row?.status as PresenceStatus) ?? "OFFLINE" };
    }
  );
}

/**
 * List of team-member ids currently ONLINE within the caller's tenant.
 * Used by the live-chat handoff to route to an available human.
 */
export async function listOnlineAgentIds(tenantId: string): Promise<string[]> {
  const cutoff = new Date(Date.now() - STALE_HEARTBEAT_MS);
  return withRls({ tenantId, userId: null, role: "SUPER_ADMIN" }, async (tx) => {
    const rows = await tx.agentPresence.findMany({
      where: {
        tenantId,
        status: "ONLINE",
        lastHeartbeatAt: { gte: cutoff },
      },
      select: { teamMemberId: true },
    });
    return rows.map((r) => r.teamMemberId);
  });
}

/**
 * Sweep cron entry point — flips stale ONLINE / AWAY rows to OFFLINE.
 * Runs under prisma directly (system context); the tenantId lives on
 * each row so RLS is not the isolation surface here.
 */
export async function sweepStalePresence(): Promise<{ swept: number }> {
  const cutoff = new Date(Date.now() - STALE_HEARTBEAT_MS);
  const stale = await prisma.agentPresence.findMany({
    where: {
      lastHeartbeatAt: { lt: cutoff },
      status: { in: ["ONLINE", "AWAY"] },
    },
    select: { id: true },
  });
  if (stale.length === 0) return { swept: 0 };
  await prisma.agentPresence.updateMany({
    where: { id: { in: stale.map((r) => r.id) } },
    data: { status: "OFFLINE" },
  });
  return { swept: stale.length };
}
