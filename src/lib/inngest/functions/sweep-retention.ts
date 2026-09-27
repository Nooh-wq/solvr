// M20.2 — nightly retention sweep.
//
// Reads per-tenant retention TTLs and deletes anything older. Runs
// under SUPER_ADMIN system context per-tenant so RLS still isolates
// the deletes.
//
// Deletion vs crypto-shred: for BYOK tenants whose key has been
// shredded (shreddedAt != null), the ciphertext is already unreadable
// — the sweep still deletes the rows so their storage is reclaimed.
// For PLATFORM-mode tenants, this is a hard DELETE.

import { inngest } from "../client";
import { prisma, withRls } from "@/lib/db";

export const sweepRetention = inngest.createFunction(
  { id: "sweep-retention", triggers: { cron: "0 3 * * *" } }, // 03:00 UTC daily
  async () => {
    const tenants = await prisma.tenant.findMany({
      where: {
        OR: [
          { retentionTicketsDays: { not: null } },
          { retentionMessagesDays: { not: null } },
          { retentionAuditLogsDays: { not: null } },
        ],
      },
      select: {
        id: true,
        retentionTicketsDays: true,
        retentionMessagesDays: true,
        retentionAuditLogsDays: true,
      },
    });
    const summary: Record<string, { tickets: number; messages: number; audit: number }> = {};
    for (const t of tenants) {
      const swept = await withRls(
        { tenantId: t.id, userId: null, role: "SUPER_ADMIN" },
        async (tx) => {
          const out = { tickets: 0, messages: 0, audit: 0 };
          if (t.retentionMessagesDays) {
            const cutoff = new Date(Date.now() - t.retentionMessagesDays * 86_400_000);
            const r = await tx.message.deleteMany({
              where: { tenantId: t.id, createdAt: { lt: cutoff } },
            });
            out.messages = r.count;
          }
          if (t.retentionTicketsDays) {
            const cutoff = new Date(Date.now() - t.retentionTicketsDays * 86_400_000);
            const r = await tx.ticket.deleteMany({
              where: {
                tenantId: t.id,
                status: { in: ["RESOLVED", "CLOSED"] },
                updatedAt: { lt: cutoff },
              },
            });
            out.tickets = r.count;
          }
          if (t.retentionAuditLogsDays) {
            const cutoff = new Date(Date.now() - t.retentionAuditLogsDays * 86_400_000);
            const r = await tx.auditLog.deleteMany({
              where: { tenantId: t.id, createdAt: { lt: cutoff } },
            });
            out.audit = r.count;
          }
          return out;
        }
      );
      summary[t.id] = swept;
    }
    return { tenantsSwept: tenants.length, summary };
  }
);
