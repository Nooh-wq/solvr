// src/lib/inngest/functions/score-reply.ts
//
// M11.2 — non-blocking QA scoring. A reply-send action fires
// `inngest.send({ name: "reply.score", data: { tenantId, messageId }})`
// after the Message row lands. This function:
//   1. Loads the message + a small thread excerpt (RLS-scoped).
//   2. Loads the tenant's active QaRubric (bails silently if none).
//   3. Asks the provider for per-dimension scores.
//   4. Persists a QaScore row (unique on messageId — safe against
//      Inngest retry re-firing).
//   5. Charges tokens against the tenant's aiTokensUsedThisMonth
//      counter — same budget bucket M9 uses.
//
// Spec §3 pin: the rubric prompt is generated fresh here and never
// logged; on any failure we swallow and return without persisting.
// Never fails the request path — this runs in Inngest, not on the
// reply-send hot path.

import { inngest } from "@/lib/inngest/client";
import { prisma, withRls } from "@/lib/db";
import { aiProvider } from "@/lib/ai";
import { loadTenantAiConfig } from "@/lib/ai/classify";
import { readRubric, computeOverall, computeFlags } from "@/lib/ai/qa";

type ScoreReplyEvent = {
  data: { tenantId: string; messageId: string };
};

const THREAD_CONTEXT_CHARS = 1500;

export const scoreReplyFn = inngest.createFunction(
  {
    id: "score-reply",
    retries: 2,
    triggers: { event: "reply.score" },
  },
  async ({ event, step }: {
    event: ScoreReplyEvent;
    step: { run: <T>(name: string, fn: () => Promise<T>) => Promise<T> };
  }) => {
    const { tenantId, messageId } = event.data;

    // Already scored — retry safety.
    const existing = await step.run("check-existing", () =>
      prisma.qaScore.findUnique({ where: { messageId } })
    );
    if (existing) return { skipped: true, reason: "already-scored" };

    const config = await step.run("load-config", () => loadTenantAiConfig(tenantId));
    if (!config.aiEnabled) return { skipped: true, reason: "ai-disabled" };
    if (!aiProvider.isConfigured) return { skipped: true, reason: "provider-unconfigured" };
    if (config.aiTokensUsedThisMonth >= config.aiMonthlyTokenCap) {
      return { skipped: true, reason: "budget-exhausted" };
    }

    const rubricRow = await step.run("load-rubric", () =>
      prisma.qaRubric.findFirst({ where: { tenantId, isActive: true } })
    );
    if (!rubricRow) return { skipped: true, reason: "no-active-rubric" };
    const rubric = readRubric(rubricRow.dimensions);
    if (!rubric) return { skipped: true, reason: "rubric-malformed" };

    const bundle = await step.run("load-message-bundle", async () =>
      withRls({ tenantId, userId: null, role: "SUPER_ADMIN" }, async (tx) => {
        const message = await tx.message.findFirst({
          where: {
            id: messageId,
            tenantId,
            // Spec §3: never score AI-drafted-but-not-sent. If it's in
            // the messages table, it was sent — but we also drop
            // isInternal (internal notes are coaching-irrelevant + would
            // pollute the tone signal) and BOT-thanks/close-outs.
            isInternal: false,
          },
          select: {
            id: true,
            body: true,
            senderRole: true,
            senderTeamMemberId: true,
            senderEndUserId: true,
            ticketId: true,
            createdAt: true,
          },
        });
        if (!message) return null;

        // A short slice of the thread up to (not including) this reply.
        const prior = await tx.message.findMany({
          where: {
            tenantId,
            ticketId: message.ticketId,
            createdAt: { lt: message.createdAt },
            isInternal: false,
          },
          orderBy: { createdAt: "desc" },
          take: 3,
          select: { body: true, senderRole: true },
        });
        const excerpt = prior
          .reverse()
          .map((m) => `${m.senderRole}: ${m.body}`)
          .join("\n\n")
          .slice(0, THREAD_CONTEXT_CHARS);
        return { message, excerpt };
      })
    );
    if (!bundle) return { skipped: true, reason: "message-missing" };

    let result: Awaited<ReturnType<typeof aiProvider.scoreReply>>;
    try {
      result = await step.run("provider-score", () =>
        aiProvider.scoreReply({
          dimensions: rubric,
          threadExcerpt: bundle.excerpt,
          replyBody: bundle.message.body,
        })
      );
    } catch {
      // Spec §3 — do NOT log the rubric prompt or reply body.
      return { skipped: true, reason: "provider-error" };
    }

    const scoresByKey: Record<string, number> = {};
    const scoresJson: Record<string, { score: number; rationale: string }> = {};
    for (const d of result.dimensions) {
      scoresByKey[d.key] = d.score;
      scoresJson[d.key] = { score: d.score, rationale: d.rationale };
    }
    const overall = computeOverall(rubric, scoresByKey);
    const flagged = computeFlags(rubric, scoresByKey);

    await step.run("persist-score", async () => {
      await prisma.$transaction([
        prisma.qaScore.create({
          data: {
            tenantId,
            rubricId: rubricRow.id,
            messageId: bundle.message.id,
            ticketId: bundle.message.ticketId,
            authorTeamMemberId: bundle.message.senderTeamMemberId,
            authorEndUserId: bundle.message.senderEndUserId,
            senderRole: bundle.message.senderRole,
            scoresJson: scoresJson as never,
            overall,
            isFlagged: flagged.length > 0,
            flaggedReasons: flagged.length > 0 ? (flagged as never) : undefined,
            tokensUsed: result.tokensUsed,
          },
        }),
        prisma.tenant.update({
          where: { id: tenantId },
          data: { aiTokensUsedThisMonth: { increment: result.tokensUsed } },
        }),
      ]);
    });

    return { ok: true, overall, flagged };
  }
);
