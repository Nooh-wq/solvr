import { inngest } from "../client";
import { prisma, withRls } from "@/lib/db";
import { signPurposeToken } from "@/core/auth/tokens";
import { sendCsatRequestEmail } from "@/lib/email/events";
import { getEmailDecision } from "@/lib/notification-prefs";

// M5.1 — CsatQueue drainer. Fires every 5 minutes; for each tenant,
// picks up rows whose scheduledFor <= now, sendAt is null, failedAt
// is null, and either sends (respecting the recipient's email prefs)
// or marks failed with a reason.
//
// Dedup: sentAt/failedAt columns. Enqueue path already refuses to
// double-queue a ticket for the same surveyType, so this loop never
// races itself.

const siteUrl = () => process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export const sendCsatQueue = inngest.createFunction(
  { id: "send-csat-queue", triggers: { cron: "*/5 * * * *" } }, // every 5 min
  async ({ step }) => {
    const tenants = await step.run("list-tenants", () =>
      prisma.tenant.findMany({ select: { id: true } })
    );

    let totalSent = 0;
    let totalFailed = 0;
    const now = new Date();

    for (const tenant of tenants) {
      const summary = await step.run(`csat-${tenant.id}`, async () => {
        const rows = await withRls(
          { tenantId: tenant.id, userId: null, role: "SUPER_ADMIN" },
          (tx) =>
            tx.csatQueue.findMany({
              where: {
                tenantId: tenant.id,
                sentAt: null,
                failedAt: null,
                scheduledFor: { lte: now },
              },
              orderBy: { scheduledFor: "asc" },
              take: 100,
            })
        );

        let sent = 0;
        let failed = 0;
        for (const row of rows) {
          try {
            const { clientEmail, branding } = await withRls(
              { tenantId: tenant.id, userId: null, role: "SUPER_ADMIN" },
              async (tx) => {
                const ticket = await tx.ticket.findFirst({
                  where: { id: row.ticketId, tenantId: tenant.id },
                  select: {
                    clientEndUserId: true,
                    clientTeamMemberId: true,
                  },
                });
                if (!ticket) throw new Error("Ticket not found.");
                let email: string | null = null;
                let clientId: string | null = null;
                if (ticket.clientEndUserId) {
                  const u = await tx.endUser.findFirst({
                    where: { id: ticket.clientEndUserId, tenantId: tenant.id },
                    select: { id: true, email: true },
                  });
                  email = u?.email ?? null;
                  clientId = u?.id ?? null;
                } else if (ticket.clientTeamMemberId) {
                  const t = await tx.teamMember.findFirst({
                    where: { id: ticket.clientTeamMemberId, tenantId: tenant.id },
                    select: { id: true, email: true },
                  });
                  email = t?.email ?? null;
                  clientId = t?.id ?? null;
                }
                if (!email || !clientId) throw new Error("No client email on ticket.");
                const branding = await tx.tenantBranding.findUnique({
                  where: { tenantId: tenant.id },
                });
                // Respect the recipient's per-event email preference —
                // matches the pre-M5 behaviour that lived in updateTicket.
                const decision = await getEmailDecision(tenant.id, clientId, "csatRequest");
                if (decision !== "send") {
                  throw new Error(`SKIPPED_${decision.toUpperCase()}`);
                }
                return { clientEmail: email, branding };
              }
            );

            const token = await signPurposeToken("csat", {
              ticketId: row.ticketId,
              tenantId: tenant.id,
            });
            const rateUrl = `${siteUrl()}/rate/${encodeURIComponent(token)}`;
            await sendCsatRequestEmail(clientEmail, rateUrl, branding);

            await withRls(
              { tenantId: tenant.id, userId: null, role: "SUPER_ADMIN" },
              (tx) =>
                tx.csatQueue.update({
                  where: { id: row.id },
                  data: { sentAt: new Date() },
                })
            );
            sent++;
          } catch (e) {
            const message = e instanceof Error ? e.message : "Unknown";
            // SKIPPED_* isn't really a failure — the recipient opted
            // out. Mark sentAt so we don't retry every 5 min.
            const skipped = message.startsWith("SKIPPED_");
            await withRls(
              { tenantId: tenant.id, userId: null, role: "SUPER_ADMIN" },
              (tx) =>
                tx.csatQueue.update({
                  where: { id: row.id },
                  data: skipped
                    ? { sentAt: new Date(), failureReason: message }
                    : { failedAt: new Date(), failureReason: message },
                })
            );
            if (!skipped) failed++;
          }
        }
        return { sent, failed };
      });
      totalSent += summary.sent;
      totalFailed += summary.failed;
    }

    return { totalSent, totalFailed };
  }
);
