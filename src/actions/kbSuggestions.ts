"use server";

// M10.2 — server actions for the KB Suggestions admin tab. Every write
// goes through requireSession({ minRole: "ADMIN" }) — the clustering
// cron is the only writer under SUPER_ADMIN + system context, everyone
// else is gated by this.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withRls } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { chunkArticleBody } from "@/lib/ai/rag";

const acceptSchema = z.object({
  id: z.string().min(1),
  // Admin can edit the title/body inline before accepting — pre-filled
  // with the AI draft.
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(50_000),
});

const rejectSchema = z.object({
  id: z.string().min(1),
  reason: z.string().max(500).optional(),
});

/**
 * Returns PENDING suggestions ordered newest-first, with a small
 * source-ticket preview (reference + first inbound line) so the admin
 * can spot-check the AI's grounding before accepting.
 */
export async function listKbSuggestions() {
  const session = await requireSession({ minRole: "ADMIN" });
  return withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const suggestions = await tx.kbSuggestion.findMany({
        where: { tenantId: session.tenantId, status: "PENDING" },
        orderBy: { createdAt: "desc" },
      });

      // Batch-load source tickets for previews.
      const allTicketIds = new Set<string>();
      for (const s of suggestions) {
        const ids = Array.isArray(s.sourceTicketIds) ? (s.sourceTicketIds as string[]) : [];
        for (const id of ids) allTicketIds.add(id);
      }
      const tickets = allTicketIds.size > 0
        ? await tx.ticket.findMany({
            where: { tenantId: session.tenantId, id: { in: [...allTicketIds] } },
            select: { id: true, reference: true, title: true },
          })
        : [];
      const byId = new Map(tickets.map((t) => [t.id, t]));

      return suggestions.map((s) => {
        const ids = Array.isArray(s.sourceTicketIds) ? (s.sourceTicketIds as string[]) : [];
        return {
          id: s.id,
          title: s.title,
          body: s.body,
          reason: s.reason,
          createdAt: s.createdAt.toISOString(),
          sourceTickets: ids
            .map((id) => byId.get(id))
            .filter((t): t is { id: string; reference: string; title: string } => Boolean(t)),
        };
      });
    }
  );
}

/**
 * Accept a suggestion: creates + publishes a KbArticle (routed through
 * the same chunkArticleBody pipeline as upsertKbArticle so retrieval
 * picks it up immediately), then marks the suggestion ACCEPTED with a
 * back-reference to the article.
 */
export async function acceptKbSuggestion(input: z.infer<typeof acceptSchema>) {
  const session = await requireSession({ minRole: "ADMIN" });
  const data = acceptSchema.parse(input);
  const chunks = chunkArticleBody(data.body);

  return withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const suggestion = await tx.kbSuggestion.findFirst({
        where: { id: data.id, tenantId: session.tenantId, status: "PENDING" },
      });
      if (!suggestion) throw new Error("Suggestion not found or already decided");

      const article = await tx.kbArticle.create({
        data: {
          tenantId: session.tenantId,
          title: data.title,
          body: data.body,
          isPublished: true,
          reviewedAt: new Date(),
        },
      });
      await tx.kbChunk.createMany({
        data: chunks.map((content) => ({
          tenantId: session.tenantId,
          articleId: article.id,
          content,
        })),
      });

      await tx.kbSuggestion.update({
        where: { id: suggestion.id },
        data: {
          status: "ACCEPTED",
          decidedAt: new Date(),
          decidedBySubjectId: session.subjectId,
          publishedArticleId: article.id,
        },
      });

      revalidatePath("/admin/kb");
      revalidatePath("/admin/kb/suggestions");
      return { ok: true, articleId: article.id };
    }
  );
}

/**
 * Reject a suggestion. The clustering job won't re-propose the same
 * cluster (same sourceDigest) unless materially more content arrives —
 * see materiallyMoreContent + RE_SUGGEST_GROWTH_MULTIPLIER in
 * src/lib/ai/kb-cluster.ts.
 */
export async function rejectKbSuggestion(input: z.infer<typeof rejectSchema>) {
  const session = await requireSession({ minRole: "ADMIN" });
  const data = rejectSchema.parse(input);
  return withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const suggestion = await tx.kbSuggestion.findFirst({
        where: { id: data.id, tenantId: session.tenantId, status: "PENDING" },
      });
      if (!suggestion) throw new Error("Suggestion not found or already decided");

      await tx.kbSuggestion.update({
        where: { id: suggestion.id },
        data: {
          status: "REJECTED",
          rejectionReason: data.reason ?? null,
          decidedAt: new Date(),
          decidedBySubjectId: session.subjectId,
        },
      });
      revalidatePath("/admin/kb/suggestions");
      return { ok: true };
    }
  );
}

export async function countPendingKbSuggestions(): Promise<number> {
  const session = await requireSession({ minRole: "ADMIN" });
  return withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    (tx) =>
      tx.kbSuggestion.count({
        where: { tenantId: session.tenantId, status: "PENDING" },
      })
  );
}
