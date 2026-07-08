import { inngest } from "../client";
import { prisma, withRls } from "@/lib/db";
import { runRulesForEvent } from "@/lib/rule-engine";
import type { Priority } from "@/generated/prisma";

// Z8 gap — SLA event emitters. Every 15 minutes, scan each tenant for
// tickets that have crossed the SLA warning line (80% of the
// per-priority threshold with no first reply) or the breach line
// (past the threshold with no first reply). Fires SLA_WARNING and
// SLA_BREACH on those tickets so any Trigger rules bound to those
// events run.
//
// Dedup: a JSON marker column would ideally track "already emitted",
// but there's no free scalar on Ticket for that. Instead we key
// dedup off the presence of the corresponding audit-log row —
// SLA_WARNING_EMITTED / SLA_BREACH_EMITTED. Idempotent per ticket.

// Duplicates the fixed thresholds from src/actions/admin.ts so this
// module doesn't have to reach across the "use server" boundary. If
// the numbers ever diverge, one grep on SLA_THRESHOLD_HOURS finds
// both.
const SLA_THRESHOLD_HOURS: Record<Priority, number> = {
  URGENT: 1,
  HIGH: 4,
  MEDIUM: 8,
  LOW: 24,
};

const WARNING_FRACTION = 0.8;

export const emitSlaEvents = inngest.createFunction(
  { id: "emit-sla-events", triggers: { cron: "*/15 * * * *" } }, // every 15m
  async ({ step }) => {
    const tenants = await step.run("list-tenants", () =>
      prisma.tenant.findMany({ select: { id: true } })
    );

    let totalWarned = 0;
    let totalBreached = 0;

    for (const tenant of tenants) {
      const summary = await step.run(`sla-${tenant.id}`, async () => {
        // Open/pending tickets with no first reply yet — the only ones
        // whose SLA can still tick. RESOLVED/CLOSED skipped.
        const candidates = await withRls(
          { tenantId: tenant.id, userId: null, role: "SUPER_ADMIN" },
          (tx) =>
            tx.ticket.findMany({
              where: {
                tenantId: tenant.id,
                status: { in: ["OPEN", "IN_PROGRESS", "PENDING"] },
                firstReplyAt: null,
              },
              select: { id: true, priority: true, createdAt: true },
            })
        );

        let warned = 0;
        let breached = 0;
        const now = Date.now();
        const emittedRows = await withRls(
          { tenantId: tenant.id, userId: null, role: "SUPER_ADMIN" },
          (tx) =>
            tx.auditLog.findMany({
              where: {
                tenantId: tenant.id,
                action: { in: ["SLA_WARNING_EMITTED", "SLA_BREACH_EMITTED"] },
              },
              select: { ticketId: true, action: true },
            })
        );
        const warnedIds = new Set(
          emittedRows.filter((r) => r.action === "SLA_WARNING_EMITTED").map((r) => r.ticketId)
        );
        const breachedIds = new Set(
          emittedRows.filter((r) => r.action === "SLA_BREACH_EMITTED").map((r) => r.ticketId)
        );

        for (const t of candidates) {
          const thresholdMs = SLA_THRESHOLD_HOURS[t.priority] * 60 * 60 * 1000;
          const elapsed = now - t.createdAt.getTime();
          const isBreach = elapsed >= thresholdMs;
          const isWarning = !isBreach && elapsed >= thresholdMs * WARNING_FRACTION;

          if (isBreach && !breachedIds.has(t.id)) {
            await runRulesForEvent({
              event: "SLA_BREACH",
              ticketId: t.id,
              session: { tenantId: tenant.id, subjectId: null, role: "SUPER_ADMIN" },
            });
            await withRls(
              { tenantId: tenant.id, userId: null, role: "SUPER_ADMIN" },
              async (tx) => {
                await tx.auditLog.create({
                  data: {
                    tenantId: tenant.id,
                    ticketId: t.id,
                    action: "SLA_BREACH_EMITTED",
                    toValue: `${t.priority} threshold ${SLA_THRESHOLD_HOURS[t.priority]}h exceeded`,
                  },
                });
              }
            );
            breached++;
          } else if (isWarning && !warnedIds.has(t.id)) {
            await runRulesForEvent({
              event: "SLA_WARNING",
              ticketId: t.id,
              session: { tenantId: tenant.id, subjectId: null, role: "SUPER_ADMIN" },
            });
            await withRls(
              { tenantId: tenant.id, userId: null, role: "SUPER_ADMIN" },
              async (tx) => {
                await tx.auditLog.create({
                  data: {
                    tenantId: tenant.id,
                    ticketId: t.id,
                    action: "SLA_WARNING_EMITTED",
                    toValue: `${Math.round((elapsed / thresholdMs) * 100)}% of ${SLA_THRESHOLD_HOURS[t.priority]}h ${t.priority} SLA`,
                  },
                });
              }
            );
            warned++;
          }
        }
        return { warned, breached };
      });
      totalWarned += summary.warned;
      totalBreached += summary.breached;
    }

    return { totalWarned, totalBreached };
  }
);
