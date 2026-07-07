import { inngest } from "../client";
import { prisma, withRls } from "@/lib/db";
import { sendStatusChangeEmail } from "@/lib/email/events";
import { systemContext, getEndUsersByIds, getTeamMembersByIds } from "@/lib/shared-platform";
import { resolveUserLike } from "@/lib/z1-view-models";

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
          });

          for (const ticket of candidates) {
            await tx.ticket.update({ where: { id: ticket.id }, data: { status: "CLOSED" } });
            // Z1.4a null-actor allowed by audit_logs_actor_exclusive
            // <= 1 bound (see boundary doc §7.2).
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
            // Z1.4b: resolve client emails via wrapper batches.
            const wrapperCtx = systemContext(tenant.id);
            const euIds = new Set<string>();
            const tmIds = new Set<string>();
            for (const t of candidates) {
              if (t.clientEndUserId) euIds.add(t.clientEndUserId);
              if (t.clientTeamMemberId) tmIds.add(t.clientTeamMemberId);
            }
            const [endUsers, teamMembers] = await Promise.all([
              getEndUsersByIds(wrapperCtx, [...euIds]),
              getTeamMembersByIds(wrapperCtx, [...tmIds]),
            ]);
            const branding = await tx.tenantBranding.findUnique({ where: { tenantId: tenant.id } });
            for (const ticket of candidates) {
              const clientView = resolveUserLike(
                { endUserId: ticket.clientEndUserId, teamMemberId: ticket.clientTeamMemberId },
                endUsers,
                teamMembers,
              );
              if (!clientView) continue; // dropped notification if client resolution fails
              await sendStatusChangeEmail({ ...ticket, status: "CLOSED" }, clientView.email, branding);
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
