// src/lib/inngest/functions/classify-message.ts
//
// M9 — non-blocking classification path. A domain action calls
// `inngest.send({ name: "message.classify", data: { tenantId, messageId } })`
// after posting an inbound message. This function fetches the message
// body, runs classifyBody, stores the signals on the Message row, and
// (for M9.7) optionally invokes translate() and stores that too.
//
// Never fails a request. On any error, the Message row simply stays in
// "signals not yet available" state — the agent header renders that
// gracefully.

import { inngest } from "@/lib/inngest/client";
import { prisma } from "@/lib/db";
import { classifyBody, loadTenantAiConfig } from "@/lib/ai/classify";
import { aiProvider } from "@/lib/ai";
import { runRulesForEvent } from "@/lib/rule-engine";

type ClassifyEvent = {
  data: { tenantId: string; messageId: string };
};

export const classifyMessageFn = inngest.createFunction(
  {
    id: "classify-message",
    retries: 2,
    triggers: { event: "message.classify" },
  },
  async ({ event, step }: { event: ClassifyEvent; step: { run: <T>(name: string, fn: () => Promise<T>) => Promise<T> } }) => {
    const { tenantId, messageId } = event.data;

    const msg = await step.run("load-message", () =>
      prisma.message.findFirst({
        where: { id: messageId, tenantId },
        select: { id: true, body: true, senderRole: true, aiSignalsAt: true },
      })
    );
    if (!msg) return { skipped: true, reason: "message-missing" };
    if (msg.aiSignalsAt) return { skipped: true, reason: "already-classified" };
    // Only inbound customer / guest messages. Agent replies skip per M9 §3.
    if (msg.senderRole !== "CLIENT" && msg.senderRole !== "GUEST") {
      return { skipped: true, reason: "outbound-not-classified" };
    }
    const msgWithTicket = await step.run("load-message-ticket", () =>
      prisma.message.findFirst({
        where: { id: messageId, tenantId },
        select: { ticketId: true },
      })
    );

    const signals = await step.run("classify", () => classifyBody(tenantId, msg.body));
    if (!signals) {
      // No signals produced (AI disabled / over-cap / provider unconfigured).
      return { skipped: true, reason: "no-signals" };
    }

    await step.run("persist-signals", () =>
      prisma.message.update({
        where: { id: messageId },
        data: {
          aiIntent: signals.intent,
          aiSentiment: signals.sentiment,
          aiUrgency: signals.urgency,
          aiLanguage: signals.language,
          aiConfidence: signals.confidence,
          aiSignalsAt: new Date(),
        },
      })
    );

    // M9.5 — fire rule triggers when signals land. The rule engine reads
    // the current Message.ai* on the ticket via readField(), so we just
    // announce the event; the trigger conditions decide what matters.
    if (msgWithTicket && signals.intent) {
      await step.run("fire-intent-detected", () =>
        runRulesForEvent({
          event: "INTENT_DETECTED",
          ticketId: msgWithTicket.ticketId,
          session: { tenantId, subjectId: null, role: "SUPER_ADMIN" },
          invocationDepth: 0,
        }).catch(() => undefined)
      );
    }
    if (msgWithTicket && signals.sentiment) {
      await step.run("fire-sentiment-detected", () =>
        runRulesForEvent({
          event: "SENTIMENT_DETECTED",
          ticketId: msgWithTicket.ticketId,
          session: { tenantId, subjectId: null, role: "SUPER_ADMIN" },
          invocationDepth: 0,
        }).catch(() => undefined)
      );
    }

    // M9.7 — auto-translation. If tenant has aiAutoTranslate on and the
    // detected language differs from the primary, translate + store.
    const config = await step.run("load-config", () => loadTenantAiConfig(tenantId));
    if (
      config.aiAutoTranslate &&
      signals.language &&
      signals.language !== config.aiPrimaryLanguage &&
      aiProvider.isConfigured
    ) {
      const translation = await step.run("translate", () =>
        aiProvider.translate(msg.body, signals.language, config.aiPrimaryLanguage)
      );
      if (translation) {
        await step.run("persist-translation", async () => {
          await prisma.message.update({
            where: { id: messageId },
            data: { aiTranslatedBody: translation.text },
          });
          await prisma.tenant.update({
            where: { id: tenantId },
            data: { aiTokensUsedThisMonth: { increment: translation.tokensUsed } },
          });
        });
      }
    }

    return { ok: true, fromCache: signals.fromCache };
  }
);
