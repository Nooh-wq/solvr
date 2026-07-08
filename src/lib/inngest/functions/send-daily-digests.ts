// M21.4 — Drains digest_queue once daily and sends one summary email
// per subject with pending items. Runs at 09:00 UTC. Requires
// `npx inngest-cli dev` running locally to actually fire on schedule
// (same as the auto-close job).

import { inngest } from "../client";
import { prisma, withRls } from "@/lib/db";
import { sendSystemNotice } from "@/lib/email/send";
import { systemContext, getEndUsersByIds, getTeamMembersByIds } from "@/lib/shared-platform";

function siteUrl() {
  return process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
}

export const sendDailyDigests = inngest.createFunction(
  {
    id: "send-daily-digests",
    // Both triggers: the daily 09:00 UTC cron drains for real users, and
    // the ad-hoc event lets ops/tests re-drain on demand without waiting
    // for the next cron tick.
    triggers: [
      { cron: "0 9 * * *" },
      { event: "notifications/daily-digest.run-now" },
    ],
  },
  async ({ step }) => {
    // digest_queue is RLS-scoped, so we can't ask "which subjects have
    // pending items" globally. Instead: iterate tenants (public-read),
    // then per tenant use a scoped withRls to read distinct subjects.
    // Same shape as auto-close.ts's per-tenant loop.
    const tenants = await step.run("list-tenants", () =>
      prisma.tenant.findMany({ select: { id: true } })
    );

    let totalSent = 0;
    for (const { id: tenantId } of tenants) {
      const subjectIds = await withRls(
        { tenantId, userId: null, role: "SUPER_ADMIN" },
        async (tx) => {
          const rows = await tx.digestQueue.findMany({
            where: { tenantId },
            distinct: ["subjectId"],
            select: { subjectId: true },
          });
          return rows.map((r) => r.subjectId);
        }
      );
      if (subjectIds.length === 0) continue;

      // (fallthrough) — the original per-tenant step body runs below.
      // Passing subjectIds down keeps the step.run boundary intact for
      // Inngest's retry semantics.
      const sentInTenant = await step.run(`digest-tenant-${tenantId}`, async () => {
        const wrapperCtx = systemContext(tenantId);
        const [endUsers, teamMembers, branding] = await Promise.all([
          getEndUsersByIds(wrapperCtx, subjectIds),
          getTeamMembersByIds(wrapperCtx, subjectIds),
          prisma.tenantBranding.findUnique({ where: { tenantId } }),
        ]);

        let sent = 0;
        for (const subjectId of subjectIds) {
          // Pull all queued events for this subject, send one summary,
          // then delete them — inside the tenant's RLS scope.
          const emailInfo = endUsers.get(subjectId) ?? teamMembers.get(subjectId);
          if (!emailInfo) continue;

          const drained = await withRls(
            { tenantId, userId: subjectId, role: "SUPER_ADMIN" },
            async (tx) => {
              const rows = await tx.digestQueue.findMany({
                where: { tenantId, subjectId },
                orderBy: { createdAt: "asc" },
              });
              if (rows.length === 0) return null;
              await tx.digestQueue.deleteMany({ where: { tenantId, subjectId } });
              return rows;
            }
          );
          if (!drained) continue;

          // One human-scannable list per email — reference + subject line
          // for each event, links back to the ticket. Kept plain text so
          // the existing sendSystemNotice template renders cleanly.
          const bulletList = drained
            .map((r) => `• ${r.subject}${r.ticketUrl ? ` — ${siteUrl()}${r.ticketUrl}` : ""}`)
            .join("\n");

          const productName = branding?.productName ?? "Support";
          await sendSystemNotice({
            to: emailInfo.email,
            branding,
            subject: `Your ${productName} digest — ${drained.length} update${drained.length === 1 ? "" : "s"}`,
            heading: "Your daily digest",
            body: `Here's what happened while your notifications were batched:\n\n${bulletList}`,
          });
          sent += 1;
        }
        return sent;
      });
      totalSent += sentInTenant;
    }

    return { totalSent };
  }
);
