import Link from "next/link";
import { listKbArticles } from "@/actions/kb";
import { countPendingKbSuggestions } from "@/actions/kbSuggestions";
import { getStaleArticleIds, STALE_MONTHS } from "@/lib/ai/kb-stale";
import { KbManager } from "./kb-manager";

export default async function KbPage() {
  const [articles, pendingSuggestions] = await Promise.all([
    listKbArticles(),
    countPendingKbSuggestions(),
  ]);
  const staleIds = getStaleArticleIds(
    articles.map((a) => ({
      id: a.id,
      updatedAt: a.updatedAt,
      reviewedAt: a.reviewedAt,
    }))
  );
  return (
    <div>
      <div className="flex justify-between items-start gap-4 mb-1">
        <h1 className="text-2xl font-bold">Knowledge base</h1>
        <Link
          href="/admin/kb/suggestions"
          className="inline-flex items-center gap-2 text-[13px] font-medium text-[var(--color-primary)] hover:underline"
        >
          Suggestions
          {pendingSuggestions > 0 ? (
            <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-[var(--color-primary)] text-white text-[11px] font-semibold">
              {pendingSuggestions}
            </span>
          ) : null}
        </Link>
      </div>
      <p className="text-sm text-[var(--color-neutral-600)] mb-6">
        Published articles ground the client chatbot and the agent copilot — see the AI copilot panel on any
        ticket, and the chat widget in the client portal.
      </p>
      <KbManager
        articles={articles.map((a) => ({
          id: a.id,
          title: a.title,
          body: a.body,
          isPublished: a.isPublished,
          updatedAt: a.updatedAt.toISOString(),
          isStale: staleIds.has(a.id),
        }))}
        staleThresholdMonths={STALE_MONTHS}
      />
    </div>
  );
}
