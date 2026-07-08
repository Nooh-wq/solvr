"use server";

// Z3.5 — small aggregate loader for the ticket-detail customer-context
// panel. Returns a subject's prior-ticket count (excluding the current
// ticket) and their CSAT summary. Kept isolated from the heavier
// loadUserProfile so ticket detail doesn't pull the full timeline just
// to render "4 prior tickets · CSAT 4.3".

import { withRls } from "@/lib/db";
import { requireSession } from "@/lib/auth";

export type PriorActivitySummary = {
  priorTicketCount: number;
  csatAvg: number | null;
  csatCount: number;
};

export async function getPriorActivityForClient(
  clientEndUserId: string,
  excludingTicketId: string
): Promise<PriorActivitySummary> {
  const session = await requireSession({ minRole: "AGENT" });
  return withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const [priorCount, csatRows] = await Promise.all([
        tx.ticket.count({
          where: {
            tenantId: session.tenantId,
            clientEndUserId,
            id: { not: excludingTicketId },
          },
        }),
        tx.surveyResponse.findMany({
          where: {
            tenantId: session.tenantId,
            ticket: { clientEndUserId },
          },
          select: { rating: true },
        }),
      ]);
      return {
        priorTicketCount: priorCount,
        csatAvg:
          csatRows.length === 0
            ? null
            : csatRows.reduce((s, r) => s + r.rating, 0) / csatRows.length,
        csatCount: csatRows.length,
      };
    }
  );
}
