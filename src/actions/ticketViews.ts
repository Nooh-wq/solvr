"use server";

import { withRls } from "@/lib/db";
import { requireSession } from "@/lib/auth";

// Z6 DoD closure — per-agent ticket-view tracking. `markTicketViewed`
// is called from the ticket-detail server component on every load;
// upsert semantics let a first visit and a re-visit both land as one
// row. RLS enforces owner-only writes (a row's subjectId must match
// the acting session's user id).

export async function markTicketViewed(ticketId: string): Promise<void> {
  const session = await requireSession({ minRole: "AGENT" });
  await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      await tx.ticketView.upsert({
        where: {
          subjectId_ticketId: {
            subjectId: session.subjectId,
            ticketId,
          },
        },
        create: {
          subjectId: session.subjectId,
          ticketId,
          tenantId: session.tenantId,
        },
        update: { lastViewedAt: new Date() },
      });
    }
  );
}
