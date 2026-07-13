// src/lib/inngest/functions/cluster-kb-suggestions.ts
//
// M10.1 — nightly clustering job. Windowed, tenant-by-tenant fan-out
// (same shape as auto-close-resolved-tickets so RLS gets scoped to the
// tenant on each iteration instead of needing a cross-tenant read).
//
// Non-goals for this cron:
//   - It does NOT publish anything. Every draft is filed as PENDING and
//     an admin must accept in the Suggestions tab. Enforced twice:
//     - status defaults to "PENDING" on the model
//     - acceptKbSuggestion is the only path that flips status + publishes
//   - It does NOT include internal notes. The message filter is
//     senderRole in ("CLIENT", "GUEST") and isInternal=false. Even one
//     internal note leaking into a draft is unacceptable (spec §3).
//   - It does NOT touch the tenant's aiTokensUsedThisMonth counter
//     if aiEnabled is false OR the provider is unconfigured.

import { inngest } from "../client";
import { prisma, withRls } from "@/lib/db";
import { retrieveContext } from "@/lib/ai/rag";
import { aiProvider } from "@/lib/ai";
import { loadTenantAiConfig } from "@/lib/ai/classify";
import {
  CLUSTER_WINDOW_DAYS,
  MIN_CLUSTER_SIZE,
  NO_STRONG_MATCH_SCORE,
  clusterCandidates,
  computeSourceDigest,
  extractLongTerms,
  materiallyMoreContent,
  redactPii,
  topicHintFromTerms,
  type ClusterCandidate,
} from "@/lib/ai/kb-cluster";

const RESOLUTION_EXCERPT_CHARS = 1500;

export const clusterKbSuggestions = inngest.createFunction(
  { id: "cluster-kb-suggestions", triggers: { cron: "0 3 * * *" } }, // 03:00 UTC nightly
  async ({ step }) => {
    const tenants = await step.run("list-tenants", () =>
      prisma.tenant.findMany({
        where: { aiEnabled: true },
        select: { id: true },
      })
    );

    let totalDrafted = 0;
    let totalSkippedRejected = 0;

    for (const tenant of tenants) {
      const drafted = await step.run(`tenant-${tenant.id}`, () =>
        processTenant(tenant.id)
      );
      totalDrafted += drafted.drafted;
      totalSkippedRejected += drafted.skippedRejected;
    }

    return { totalDrafted, totalSkippedRejected };
  }
);

async function processTenant(
  tenantId: string
): Promise<{ drafted: number; skippedRejected: number }> {
  const config = await loadTenantAiConfig(tenantId);
  if (!config.aiEnabled || !aiProvider.isConfigured) {
    return { drafted: 0, skippedRejected: 0 };
  }
  if (config.aiTokensUsedThisMonth >= config.aiMonthlyTokenCap) {
    return { drafted: 0, skippedRejected: 0 };
  }

  const cutoff = new Date(Date.now() - CLUSTER_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  return withRls(
    { tenantId, userId: null, role: "SUPER_ADMIN" },
    async (tx) => {
      // Resolved tickets in-window with at least one inbound message.
      const tickets = await tx.ticket.findMany({
        where: {
          tenantId,
          status: { in: ["RESOLVED", "CLOSED"] },
          resolvedAt: { gte: cutoff },
        },
        select: {
          id: true,
          reference: true,
          messages: {
            where: {
              senderRole: { in: ["CLIENT", "GUEST"] },
              isInternal: false,
            },
            orderBy: { createdAt: "asc" },
            select: { body: true, createdAt: true },
          },
        },
      });

      // For each ticket:
      //  - inboundBody = first client-side inbound message body (the ask)
      //  - resolutionExcerpt = concatenated agent-visible resolution text
      //    (we pull agent+system messages separately below)
      const ticketIds = tickets.map((t) => t.id).filter((_, i) => tickets[i].messages.length > 0);
      if (ticketIds.length < MIN_CLUSTER_SIZE) {
        return { drafted: 0, skippedRejected: 0 };
      }

      // Pull the agent-side reply excerpts in a batched follow-up query
      // instead of an include{} nest: keeps the initial fetch small and
      // lets us bound the excerpt to RESOLUTION_EXCERPT_CHARS/ticket.
      const agentMsgs = await tx.message.findMany({
        where: {
          tenantId,
          ticketId: { in: ticketIds },
          senderRole: { in: ["AGENT", "ADMIN"] },
          isInternal: false,
        },
        orderBy: { createdAt: "asc" },
        select: { ticketId: true, body: true },
      });
      const resolutionByTicket = new Map<string, string>();
      for (const m of agentMsgs) {
        const prev = resolutionByTicket.get(m.ticketId) ?? "";
        const next = prev ? `${prev}\n\n${m.body}` : m.body;
        resolutionByTicket.set(m.ticketId, next.slice(0, RESOLUTION_EXCERPT_CHARS));
      }

      // KB-match filter: keep tickets whose inbound question already has
      // no strong KB coverage (score <= NO_STRONG_MATCH_SCORE).
      const candidates: ClusterCandidate[] = [];
      for (const t of tickets) {
        const inbound = t.messages[0];
        if (!inbound) continue;
        const resolution = resolutionByTicket.get(t.id);
        if (!resolution) continue; // no agent reply → nothing to draft from

        const retrieved = await retrieveContext(tx, tenantId, inbound.body, 1);
        // retrieveContext returns 0..1 chunks; if 1 chunk with strong
        // overlap comes back, we treat this ticket as already-covered.
        // Approximation: chunk-count as a proxy for "some match", since
        // retrieveContext doesn't expose its internal score. Good enough
        // pending pgvector — spec §M10.1 explicitly accepts heuristic.
        const scoreProxy = retrieved.length;
        if (scoreProxy > NO_STRONG_MATCH_SCORE) continue;

        candidates.push({
          ticketId: t.id,
          reference: t.reference,
          inboundBody: inbound.body,
          resolutionExcerpt: resolution,
          terms: extractLongTerms(inbound.body),
        });
      }

      if (candidates.length < MIN_CLUSTER_SIZE) {
        return { drafted: 0, skippedRejected: 0 };
      }

      const clusters = clusterCandidates(candidates);

      let drafted = 0;
      let skippedRejected = 0;

      for (const cluster of clusters) {
        const digest = computeSourceDigest(cluster.ticketIds);

        // Dedup + rejection memory (M10.4).
        const existing = await tx.kbSuggestion.findUnique({
          where: { tenantId_sourceDigest: { tenantId, sourceDigest: digest } },
        });
        if (existing) {
          if (existing.status === "PENDING" || existing.status === "ACCEPTED") continue;
          // REJECTED — only re-suggest if materially more content arrived
          // (compare current cluster size vs the rejected suggestion's
          // recorded source count).
          const prior = Array.isArray(existing.sourceTicketIds)
            ? (existing.sourceTicketIds as string[]).length
            : 0;
          if (!materiallyMoreContent(prior, cluster.ticketIds.length)) {
            skippedRejected++;
            continue;
          }
          // Otherwise, delete the old REJECTED row and let the new one
          // land — same digest can only appear once per tenant thanks
          // to the composite unique index.
          await tx.kbSuggestion.delete({ where: { id: existing.id } });
        }

        // Budget check just before spending.
        const fresh = await tx.tenant.findUnique({
          where: { id: tenantId },
          select: { aiTokensUsedThisMonth: true, aiMonthlyTokenCap: true },
        });
        if (!fresh || fresh.aiTokensUsedThisMonth >= fresh.aiMonthlyTokenCap) break;

        let draft: Awaited<ReturnType<typeof aiProvider.draftKbArticle>>;
        try {
          draft = await aiProvider.draftKbArticle({
            topicHint: topicHintFromTerms(cluster.topicTerms),
            resolutions: cluster.resolutions,
          });
        } catch {
          // Spec §3 — never log the excerpt body. Simply skip this cluster.
          continue;
        }

        await tx.kbSuggestion.create({
          data: {
            tenantId,
            status: "PENDING",
            title: draft.title,
            body: draft.body,
            sourceTicketIds: cluster.ticketIds,
            sourceDigest: digest,
            reason: `Cluster of ${cluster.ticketIds.length} resolved tickets with no strong KB match. Redacted excerpt sample: "${redactPii(cluster.resolutions[0]?.excerpt ?? "").slice(0, 200)}"`,
          },
        });

        await tx.tenant.update({
          where: { id: tenantId },
          data: { aiTokensUsedThisMonth: { increment: draft.tokensUsed } },
        });

        drafted++;
      }

      return { drafted, skippedRejected };
    }
  );
}
