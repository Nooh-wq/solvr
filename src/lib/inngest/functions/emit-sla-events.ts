import { inngest } from "../client";
import { prisma, withRls } from "@/lib/db";
import { runRulesForEvent } from "@/lib/rule-engine";

// M2.5 — SLA warning + breach event emitter. Reads TicketSla rows,
// NOT tickets, so nothing here walks business hours (spec §3: "do
// not calculate on-read"). Windowed query: for each tenant, load
// only unresolved rows whose dueAt is inside the warning window OR
// past due, and fire the corresponding rule event once per row.
//
// Dedup: `warnedAt` and `breachedAt` columns on TicketSla itself.
// Set them the moment we fire, so a re-run within the same window
// no-ops.

const WARNING_WINDOW_MS = 60 * 60 * 1000; // 1 hour ahead of dueAt

export const emitSlaEvents = inngest.createFunction(
  { id: "emit-sla-events", triggers: { cron: "* * * * *" } }, // every minute
  async ({ step }) => {
    const tenants = await step.run("list-tenants", () =>
      prisma.tenant.findMany({ select: { id: true } })
    );

    let totalWarned = 0;
    let totalBreached = 0;
    const now = new Date();
    const warningHorizon = new Date(now.getTime() + WARNING_WINDOW_MS);

    for (const tenant of tenants) {
      const summary = await step.run(`sla-${tenant.id}`, async () => {
        // WARNING scan: dueAt in the next hour, not yet warned, not
        // yet breached, not yet satisfied, clock not paused. Anything
        // else would either double-fire or wake a paused clock.
        const warningCandidates = await withRls(
          { tenantId: tenant.id, userId: null, role: "SUPER_ADMIN" },
          (tx) =>
            tx.ticketSla.findMany({
              where: {
                tenantId: tenant.id,
                warnedAt: null,
                breachedAt: null,
                satisfiedAt: null,
                pauseStartedAt: null,
                dueAt: { gt: now, lte: warningHorizon },
              },
              select: { id: true, ticketId: true },
            })
        );

        // BREACH scan: dueAt already past, not yet breached, not yet
        // satisfied, clock not paused.
        const breachCandidates = await withRls(
          { tenantId: tenant.id, userId: null, role: "SUPER_ADMIN" },
          (tx) =>
            tx.ticketSla.findMany({
              where: {
                tenantId: tenant.id,
                breachedAt: null,
                satisfiedAt: null,
                pauseStartedAt: null,
                dueAt: { lte: now },
              },
              select: { id: true, ticketId: true },
            })
        );

        for (const row of warningCandidates) {
          await runRulesForEvent({
            event: "SLA_WARNING",
            ticketId: row.ticketId,
            session: { tenantId: tenant.id, subjectId: null, role: "SUPER_ADMIN" },
          });
          await withRls(
            { tenantId: tenant.id, userId: null, role: "SUPER_ADMIN" },
            (tx) => tx.ticketSla.update({ where: { id: row.id }, data: { warnedAt: now } })
          );
        }

        for (const row of breachCandidates) {
          await runRulesForEvent({
            event: "SLA_BREACH",
            ticketId: row.ticketId,
            session: { tenantId: tenant.id, subjectId: null, role: "SUPER_ADMIN" },
          });
          await withRls(
            { tenantId: tenant.id, userId: null, role: "SUPER_ADMIN" },
            (tx) => tx.ticketSla.update({ where: { id: row.id }, data: { breachedAt: now } })
          );
        }

        return { warned: warningCandidates.length, breached: breachCandidates.length };
      });
      totalWarned += summary.warned;
      totalBreached += summary.breached;
    }

    return { totalWarned, totalBreached };
  }
);
