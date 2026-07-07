"use server";

import { withRls } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { aiProvider } from "@/lib/ai";
import { retrieveContext } from "@/lib/ai/rag";

function formatThread(messages: { senderRole: string; body: string; isInternal: boolean }[], description: string) {
  const lines = [`Client's original request: ${description}`];
  for (const m of messages) {
    lines.push(`${m.senderRole}${m.isInternal ? " (internal note)" : ""}: ${m.body}`);
  }
  return lines.join("\n");
}

/**
 * Agent copilot job 1: conversation summary (TRD §6.1). Agent-only, drafts
 * only — never posted automatically.
 *
 * DB reads happen inside withRls (transactional); the LLM call happens
 * after that transaction has already closed — a slow model can otherwise
 * blow past Prisma's ~5s interactive-transaction timeout (that budget
 * belongs to DB round-trips, not a network call to an LLM provider).
 */
export async function summarizeTicket(ticketId: string) {
  const session = await requireSession({ minRole: "AGENT" });
  if (!aiProvider.isConfigured) return { error: "NOT_CONFIGURED" as const };

  const ticket = await withRls({ tenantId: session.tenantId, userId: session.subjectId, role: session.role }, (tx) =>
    tx.ticket.findFirstOrThrow({
      where: { id: ticketId, tenantId: session.tenantId },
      include: { messages: { orderBy: { createdAt: "asc" } } },
    })
  );

  const thread = formatThread(ticket.messages, ticket.description);
  const summary = await aiProvider.summarizeTicket(thread);
  return { ok: true as const, summary };
}

/** Agent copilot job 3: suggested reply grounded in KB + thread (TRD §6.1). Drafts only — agent sends. Same transaction/LLM split as summarizeTicket above. */
export async function suggestReply(ticketId: string) {
  const session = await requireSession({ minRole: "AGENT" });
  if (!aiProvider.isConfigured) return { error: "NOT_CONFIGURED" as const };

  const { ticket, context } = await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const ticket = await tx.ticket.findFirstOrThrow({
        where: { id: ticketId, tenantId: session.tenantId },
        include: { messages: { orderBy: { createdAt: "asc" } } },
      });
      const context = await retrieveContext(tx, session.tenantId, `${ticket.title} ${ticket.description}`);
      return { ticket, context };
    }
  );

  const thread = formatThread(ticket.messages, ticket.description);
  const kbContext = context.map((c) => `[${c.articleTitle}] ${c.content}`).join("\n\n");
  const reply = await aiProvider.suggestReply(thread, kbContext);
  return { ok: true as const, reply, citations: context.map((c) => c.articleTitle) };
}
