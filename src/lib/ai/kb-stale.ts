// src/lib/ai/kb-stale.ts
//
// M10.3 — stale-article detection. A pure predicate over the article's
// reviewedAt/updatedAt so it can be computed alongside listKbArticles
// without a second DB round trip. "Stale" today means "no admin has
// reviewed or edited it in STALE_MONTHS." The M10 spec also allows a
// "contradicted by more recent resolutions" flavour of stale — that
// needs the KbSuggestion→publishedArticle back-reference to detect
// (i.e. a NEWER accepted suggestion touching the same topic supersedes
// an older article). Left as a follow-up until the accepted-suggestion
// dataset is large enough to matter; the age check alone is what admins
// will actually notice first.

export const STALE_MONTHS = 6;

function isStale(now: Date, threshold: Date, articleDate: Date): boolean {
  return articleDate.getTime() < threshold.getTime();
}

/**
 * Returns the set of article ids that are stale relative to `now`. An
 * article is stale when the most recent of its reviewedAt or updatedAt
 * is older than STALE_MONTHS. reviewedAt takes precedence because
 * "admin explicitly re-approved this" is a stronger signal than "some
 * unrelated edit bumped updatedAt."
 */
export function getStaleArticleIds(
  articles: Array<{ id: string; updatedAt: Date; reviewedAt: Date | null }>,
  now: Date = new Date()
): Set<string> {
  const threshold = new Date(now);
  threshold.setUTCMonth(threshold.getUTCMonth() - STALE_MONTHS);

  const stale = new Set<string>();
  for (const a of articles) {
    const anchor = a.reviewedAt ?? a.updatedAt;
    if (isStale(now, threshold, anchor)) stale.add(a.id);
  }
  return stale;
}
