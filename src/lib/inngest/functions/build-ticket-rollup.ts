import { inngest } from "../client";
import { prisma, withRls } from "@/lib/db";

// M13 gap 3 — nightly rollup builder. Runs at 03:15 UTC (comfortably
// after end-of-day for most tenants) and (re)builds yesterday's row.
// Idempotent upsert on (tenantId, date) so a retry or backfill never
// double-counts.
//
// Backfill: on first deploy the table is empty. A one-shot admin
// action (`rebuildTicketRollups` in src/actions/reports.ts) walks
// backwards day-by-day.

function dayKey(d: Date): Date {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  return x;
}

export const buildTicketRollup = inngest.createFunction(
  { id: "build-ticket-rollup", triggers: { cron: "15 3 * * *" } }, // 03:15 UTC daily
  async ({ step }) => {
    const yesterday = new Date();
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const start = dayKey(yesterday);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 1);

    const tenants = await step.run("list-tenants", () =>
      prisma.tenant.findMany({ select: { id: true } })
    );

    let totalRows = 0;
    for (const tenant of tenants) {
      await step.run(`rollup-${tenant.id}`, async () => {
        await rebuildRollupFor(tenant.id, start, end);
        totalRows++;
      });
    }
    return { day: start.toISOString().slice(0, 10), tenants: totalRows };
  }
);

/**
 * Shared helper — used by the nightly cron above AND by the manual
 * backfill action. Reads the tenant's tickets under a scoped withRls
 * so tenant_isolation stays in force even when we're aggregating.
 */
export async function rebuildRollupFor(tenantId: string, dayStart: Date, dayEnd: Date): Promise<void> {
  const stats = await withRls(
    { tenantId, userId: null, role: "SUPER_ADMIN" },
    async (tx) => {
      const [createdRows, resolvedCount] = await Promise.all([
        tx.ticket.findMany({
          where: {
            tenantId,
            createdAt: { gte: dayStart, lt: dayEnd },
          },
          select: { createdAt: true, firstReplyAt: true },
        }),
        tx.ticket.count({
          where: {
            tenantId,
            resolvedAt: { gte: dayStart, lt: dayEnd },
          },
        }),
      ]);
      let firstReplyCount = 0;
      let firstReplySumMs = 0n;
      for (const r of createdRows) {
        if (!r.firstReplyAt) continue;
        firstReplyCount += 1;
        firstReplySumMs += BigInt(r.firstReplyAt.getTime() - r.createdAt.getTime());
      }
      return {
        createdCount: createdRows.length,
        resolvedCount,
        firstReplyCount,
        firstReplySumMs,
      };
    }
  );

  await withRls({ tenantId, userId: null, role: "SUPER_ADMIN" }, (tx) =>
    tx.ticketDailyRollup.upsert({
      where: { tenantId_date: { tenantId, date: dayStart } },
      create: {
        tenantId,
        date: dayStart,
        createdCount: stats.createdCount,
        resolvedCount: stats.resolvedCount,
        firstReplyCount: stats.firstReplyCount,
        firstReplySumMs: stats.firstReplySumMs,
      },
      update: {
        createdCount: stats.createdCount,
        resolvedCount: stats.resolvedCount,
        firstReplyCount: stats.firstReplyCount,
        firstReplySumMs: stats.firstReplySumMs,
      },
    })
  );
}
