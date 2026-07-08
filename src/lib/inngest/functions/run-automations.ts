import { inngest } from "../client";
import { prisma, withRls } from "@/lib/db";
import { runAutomationOnce } from "@/lib/rule-engine";

// Z8.3 — hourly automation scheduler. Iterates every tenant's active
// AUTOMATION rules; for each rule, if `lastRunAt` is older than
// `intervalHours`, invokes runAutomationOnce (same code path admins'
// "Run now" button uses). Missing lastRunAt (never run) is treated as
// due.
//
// Requires `npx inngest-cli dev` running locally to fire on schedule
// (same as auto-close).

export const runScheduledAutomations = inngest.createFunction(
  { id: "run-scheduled-automations", triggers: { cron: "0 * * * *" } }, // hourly
  async ({ step }) => {
    const tenants = await step.run("list-tenants", () =>
      prisma.tenant.findMany({ select: { id: true } })
    );

    let totalMatched = 0;
    let totalActions = 0;
    let totalErrors = 0;
    const now = Date.now();

    for (const tenant of tenants) {
      const summary = await step.run(`automations-${tenant.id}`, async () => {
        // Read under a SUPER_ADMIN scope inside the tenant — same as
        // auto-close, since there's no "acting user" for a cron. The
        // rule-engine's runAutomationOnce then uses this session
        // shape to open its own tenant-scoped RLS transactions.
        const rules = await withRls(
          { tenantId: tenant.id, userId: null, role: "SUPER_ADMIN" },
          (tx) =>
            tx.rule.findMany({
              where: {
                tenantId: tenant.id,
                kind: "AUTOMATION",
                active: true,
              },
              select: { id: true, intervalHours: true, lastRunAt: true },
            })
        );

        let matched = 0;
        let actions = 0;
        let errors = 0;
        for (const r of rules) {
          const interval = (r.intervalHours ?? 24) * 60 * 60 * 1000;
          const due =
            !r.lastRunAt || now - r.lastRunAt.getTime() >= interval;
          if (!due) continue;
          const result = await runAutomationOnce({
            ruleId: r.id,
            session: { tenantId: tenant.id, subjectId: null, role: "SUPER_ADMIN" },
          });
          matched += result.matched;
          actions += result.ranActionCount;
          errors += result.errors;
        }
        return { matched, actions, errors };
      });
      totalMatched += summary.matched;
      totalActions += summary.actions;
      totalErrors += summary.errors;
    }

    return { totalMatched, totalActions, totalErrors };
  }
);
