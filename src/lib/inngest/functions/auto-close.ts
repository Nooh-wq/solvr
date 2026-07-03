import { inngest } from "../client";
import { prisma, withRls } from "@/lib/db";
import { sendStatusChangeEmail } from "@/lib/email/events";

const AUTO_CLOSE_AFTER_DAYS = 7;

/**
 * Resolved -> Closed after N days with no client activity (build spec §B-4).
 * Runs hourly. Iterates tenants one at a time and updates each tenant's own
 * resolved tickets inside that tenant's RLS context — reuses the existing
 * per-tenant `tenant_isolation` policies rather than needing a new
 * cross-tenant write bypass (unlike the SUPER_ADMIN provisioning writes in
 * src/actions/super.ts, this job has no "acting tenant" of its own to scope
 * from, so it has to go tenant-by-tenant).
 *
 * Requires `npx inngest-cli dev` running locally to actually fire on
 * schedule — see README "Background jobs".
 */
export const autoCloseResolvedTickets = inngest.createFunction(
  { id: "auto-close-resolved-tickets", triggers: { cron: "0 * * * *" } }, // hourly
  async ({ step }) => {
    const tenants = await step.run("list-tenants", () => prisma.tenant.findMany({ select: { id: true } }));

    let totalClosed = 0;
    for (const tenant of tenants) {
      const closedCount = await step.run(`close-tenant-${tenant.id}`, async () => {
        const cutoff = new Date(Date.now() - AUTO_CLOSE_AFTER_DAYS * 24 * 60 * 60 * 1000);

        return withRls({ tenantId: tenant.id, userId: null, role: "SUPER_ADMIN" }, async (tx) => {
          const candidates = await tx.ticket.findMany({
            where: { tenantId: tenant.id, status: "RESOLVED", resolvedAt: { lte: cutoff } },
            include: { client: true },
          });

          for (const ticket of candidates) {
            await tx.ticket.update({ where: { id: ticket.id }, data: { status: "CLOSED" } });
            await tx.auditLog.create({
              data: {
                tenantId: tenant.id,
                ticketId: ticket.id,
                action: "STATUS_CHANGE",
                fromValue: "RESOLVED",
                toValue: "CLOSED",
              },
            });
          }

          if (candidates.length > 0) {
            const branding = await tx.tenantBranding.findUnique({ where: { tenantId: tenant.id } });
            for (const ticket of candidates) {
              await sendStatusChangeEmail({ ...ticket, status: "CLOSED" }, ticket.client.email, branding);
            }
          }

          return candidates.length;
        });
      });
      totalClosed += closedCount;
    }

    return { totalClosed };
  }
);
