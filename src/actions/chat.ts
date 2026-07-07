"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withRls } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { aiProvider } from "@/lib/ai";
import { retrieveContext } from "@/lib/ai/rag";
import { chatSendMessageSchema } from "@/lib/validation/kb";
import { createWithReference } from "@/lib/ticket-number";
import { checkRateLimitWithIp } from "@/lib/rate-limit";
import { systemContext, getEndUser } from "@/lib/shared-platform";
import {
  dualFkForUser,
  chatSubjectCols,
  chatSubjectWhereFor,
  ticketClientCols,
  actorCols,
} from "@/lib/z1-dual-fk";

/**
 * Client-facing deflection widget (TRD §6.1 job 1 + §6.2 RAG pipeline).
 * Creates the conversation on first message, retrieves KB context scoped to
 * the tenant (and RLS), and asks the model to answer only from that context.
 * Never changes ticket state or sends emails — that only happens via escalate().
 */
export async function sendChatMessage(input: z.infer<typeof chatSendMessageSchema>) {
  const session = await requireSession();
  const data = chatSendMessageSchema.parse(input);

  if (!aiProvider.isConfigured) {
    return { error: "NOT_CONFIGURED" as const };
  }

  // Every message triggers a paid Anthropic call, so cap how fast one user (or
  // one IP) can drive them — otherwise a logged-in client could loop and run
  // up the AI bill. SECURITY-DECISION: 20 msgs/user/min, 40/IP/min. Tune to
  // your cost tolerance; a normal support chat is a handful of turns.
  const rl = await checkRateLimitWithIp(`chat:${session.tenantId}:${session.subjectId}`, 20, 40, 60_000);
  if (!rl.allowed) {
    return { error: "RATE_LIMITED" as const };
  }

  const rlsCtx = { tenantId: session.tenantId, userId: session.subjectId, role: session.role };

  // Pass 1 (fast, transactional): persist the client message and gather
  // everything the model needs. Kept short so it never risks the Prisma
  // interactive-transaction timeout (5s default) — that budget belongs to
  // DB round-trips, not to a slow LLM call.
  const setup = await withRls(rlsCtx, async (tx) => {
    const config = await tx.chatbotConfig.findUnique({ where: { tenantId: session.tenantId } });
    if (!config?.isEnabled) return { disabled: true as const };

    const conversation = data.conversationId
      ? await tx.chatConversation.findFirstOrThrow({
          where: {
            id: data.conversationId,
            tenantId: session.tenantId,
            ...chatSubjectWhereFor(session.subjectId, session.role),
          },
        })
      : await tx.chatConversation.create({
          data: {
            tenantId: session.tenantId,
            ...chatSubjectCols(dualFkForUser(session.subjectId, session.role)),
            status: "active",
          },
        });

    await tx.chatMessage.create({
      data: { conversationId: conversation.id, role: "CLIENT", body: data.body },
    });

    const priorMessages = await tx.chatMessage.findMany({
      where: { conversationId: conversation.id },
      orderBy: { createdAt: "asc" },
    });

    const branding = await tx.tenantBranding.findUnique({ where: { tenantId: session.tenantId } });
    const context = await retrieveContext(tx, session.tenantId, data.body);

    return { disabled: false as const, config, conversation, priorMessages, branding, context };
  });

  if (setup.disabled) return { error: "DISABLED" as const };
  const { config, conversation, priorMessages, branding, context } = setup;

  // Pass 2 (slow, outside any transaction): the actual generation call.
  const contextText = context.map((c) => `[${c.articleTitle}] ${c.content}`).join("\n\n");
  const turnCount = priorMessages.filter((m) => m.role === "CLIENT").length;
  const shouldEscalate = turnCount >= config.escalateAfter && context.length === 0;
  const chatTurns = priorMessages.map((m) => ({
    role: m.role === "CLIENT" ? ("user" as const) : ("assistant" as const),
    content: m.body,
  }));

  const answer = shouldEscalate
    ? "I haven't been able to find a good answer to this in our knowledge base. Want me to create a support ticket so an agent can help?"
    : await aiProvider.generate({
        systemPrompt:
          `You are ${config.persona} for ${branding?.productName ?? "this product"}. ` +
          "Answer only using the knowledge base context below. Never invent prices, policies, or " +
          "commitments the context doesn't support. If the context doesn't cover the question, say so " +
          "plainly and offer to create a support ticket. Sentence case, short sentences, no filler." +
          (contextText ? `\n\nKnowledge base context:\n${contextText}` : "\n\nNo knowledge base context matched this question."),
        turns: chatTurns,
      });

  // Pass 3 (fast, transactional): persist the answer.
  const botMessage = await withRls(rlsCtx, (tx) =>
    tx.chatMessage.create({
      data: {
        conversationId: conversation.id,
        role: "BOT",
        body: answer,
        citations: context.length > 0 ? context.map((c) => ({ articleId: c.articleId, title: c.articleTitle })) : undefined,
      },
    })
  );

  return {
    ok: true as const,
    conversationId: conversation.id,
    message: { id: botMessage.id, body: answer, citations: context.map((c) => c.articleTitle) },
  };
}

/** Chat-to-ticket escalation contract (TRD §6.3): summarizes the transcript into a pre-filled ticket. */
export async function escalateChatToTicket(conversationId: string) {
  const session = await requireSession();
  const rlsCtx = { tenantId: session.tenantId, userId: session.subjectId, role: session.role };

  const conversation = await withRls(rlsCtx, (tx) =>
    tx.chatConversation.findFirstOrThrow({
      where: {
        id: conversationId,
        tenantId: session.tenantId,
        ...chatSubjectWhereFor(session.subjectId, session.role),
      },
      include: { messages: { orderBy: { createdAt: "asc" } } },
    })
  );

  const transcript = conversation.messages.map((m) => `${m.role}: ${m.body}`).join("\n");
  const firstClientMessage = conversation.messages.find((m) => m.role === "CLIENT")?.body ?? "Chat escalation";
  const title = firstClientMessage.slice(0, 100);

  // Outside any transaction — same reasoning as sendChatMessage above.
  let priority: "LOW" | "MEDIUM" | "HIGH" | "URGENT" = "MEDIUM";
  if (aiProvider.isConfigured) {
    try {
      const triage = await aiProvider.suggestTriage(title, transcript);
      priority = triage.priority;
    } catch {
      // fall through with defaults — triage is a nice-to-have, not required to escalate
    }
  }

  return withRls(rlsCtx, async (tx) => {
    const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: session.tenantId } });

    const clientDual = dualFkForUser(session.subjectId, session.role);
    // Z1.5b: read organizationId from wrapper EndUser (not legacy users.companyId).
    // CLIENT users have EndUser rows post-Z1.3; staff have null organizationId.
    const clientEndUser =
      session.role === "CLIENT"
        ? await getEndUser(systemContext(session.tenantId), session.subjectId)
        : null;

    const ticket = await createWithReference(tenant.name, ({ reference, ticketNumber }) =>
      tx.ticket.create({
        data: {
          tenantId: session.tenantId,
          reference,
          ticketNumber,
          title,
          description: `Escalated from chat.\n\n${transcript}`,
          ...ticketClientCols(clientDual),
          organizationId: clientEndUser?.organizationId ?? null,
          priority,
          status: "OPEN",
          source: "chatbot",
        },
      })
    );

    await tx.chatConversation.update({
      where: { id: conversation.id },
      data: { status: "escalated", ticketId: ticket.id },
    });

    await tx.auditLog.create({
      data: {
        tenantId: session.tenantId,
        ticketId: ticket.id,
        ...actorCols(clientDual),
        action: "CREATE",
        toValue: "OPEN",
      },
    });

    revalidatePath("/portal");
    return { ok: true, ticket };
  });
}
