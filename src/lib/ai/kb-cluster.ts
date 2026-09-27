// src/lib/ai/kb-cluster.ts
//
// M10 — self-learning KB clustering pipeline. Runs in the nightly cron
// (src/lib/inngest/functions/cluster-kb-suggestions.ts). Pure functions
// live here so tests can pin their behaviour without spinning up the
// Prisma client.
//
// Pipeline shape:
//   1. Window: resolved tickets in the last N days.
//   2. Filter: keep tickets whose most-recent inbound message had no
//      strong KB match under the existing retrieveContext heuristic.
//   3. Cluster: group by shared long-token overlap in the inbound bodies.
//      A cluster is >= MIN_CLUSTER_SIZE tickets. (No embeddings — same
//      pragmatic call as retrieveContext itself: keyword bag suffices
//      until pgvector is provisioned.)
//   4. Redact: strip PII (emails, phone numbers, credit-card-ish digit
//      runs) from the resolution excerpts BEFORE they go to the model.
//   5. Diff-check rejection memory: sha256(sorted-ticket-ids) is the
//      cluster's identity; if the tenant already REJECTED a suggestion
//      with the same digest, skip unless materially more content has
//      arrived (see materiallyMoreContent below).
//   6. Draft: call aiProvider.draftKbArticle with the redacted excerpts.
//   7. Persist: KbSuggestion(status=PENDING).

import crypto from "node:crypto";

// ---------------------------------------------------------------------
// Windowing + thresholds. Kept as consts (not env) — the whole point of
// self-learning KB is opinionated defaults that just work.
// ---------------------------------------------------------------------
export const CLUSTER_WINDOW_DAYS = 14;
export const MIN_CLUSTER_SIZE = 3;
/** Score threshold below which retrieveContext is treated as "no strong match" — matches its scoring shape (# of matching terms). */
export const NO_STRONG_MATCH_SCORE = 2;
/** Term length floor for clustering — same 4-char floor retrieveContext uses so shared vocabulary lines up. */
export const MIN_TERM_LENGTH = 4;
/** Two tickets are in the same cluster if their long-token sets share at least this many terms. */
export const MIN_SHARED_TERMS = 3;
/**
 * Rejection memory: after admin rejects a cluster, don't re-suggest it
 * until the source-ticket count grows by at least this multiple. Prevents
 * "same 3 tickets keep coming back every night" churn.
 */
export const RE_SUGGEST_GROWTH_MULTIPLIER = 3;

// ---------------------------------------------------------------------
// PII redaction. Deliberately conservative: over-redacts rather than
// leaks. Runs BEFORE the model sees anything (spec §3 — internal notes
// filtered upstream, PII stripped here).
// ---------------------------------------------------------------------

const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
// Phone: 7+ digits with optional separators + optional leading +/country code.
const PHONE_RE = /\+?\d[\d\s().-]{6,}\d/g;
// Credit-card-ish: 13-19 digit runs, with or without spaces/dashes.
const CC_RE = /\b(?:\d[ -]?){13,19}\b/g;
// Long alphanumeric tokens likely to be tokens/keys/session ids.
const LONG_TOKEN_RE = /\b[A-Z0-9]{24,}\b/gi;
// URL query strings — session ids often ride in them.
const URL_QUERY_RE = /(https?:\/\/\S+?)\?[^\s]+/gi;

export function redactPii(text: string): string {
  return text
    .replace(URL_QUERY_RE, "$1?[redacted]")
    .replace(EMAIL_RE, "[email redacted]")
    .replace(CC_RE, "[number redacted]")
    .replace(PHONE_RE, "[number redacted]")
    .replace(LONG_TOKEN_RE, "[token redacted]");
}

// ---------------------------------------------------------------------
// Term extraction (shared with retrieval so clustering signals align).
// ---------------------------------------------------------------------

export function extractLongTerms(body: string): Set<string> {
  const terms = body
    .toLowerCase()
    .split(/\W+/)
    .filter((t) => t.length >= MIN_TERM_LENGTH);
  return new Set(terms);
}

// ---------------------------------------------------------------------
// Cluster identity — sha256 of sorted ticket ids. Same digest between
// runs guarantees rejection memory finds the prior REJECTED row.
// ---------------------------------------------------------------------

export function computeSourceDigest(ticketIds: string[]): string {
  return crypto
    .createHash("sha256")
    .update([...ticketIds].sort().join("|"))
    .digest("hex");
}

// ---------------------------------------------------------------------
// Rejection-memory gate. If a suggestion with the same digest was
// REJECTED, only allow re-suggest when the new count is materially
// larger than the rejected one.
// ---------------------------------------------------------------------

export function materiallyMoreContent(
  rejectedSourceCount: number,
  newSourceCount: number
): boolean {
  return newSourceCount >= rejectedSourceCount * RE_SUGGEST_GROWTH_MULTIPLIER;
}

// ---------------------------------------------------------------------
// Clustering. Bag-of-words, greedy: pick the ticket with the largest
// term set as the seed, sweep other unassigned tickets, attach those
// sharing >= MIN_SHARED_TERMS terms. Not O(n) elegant but n is small
// (windowed to CLUSTER_WINDOW_DAYS × #tickets-without-KB-match, which
// in practice is dozens, not thousands).
// ---------------------------------------------------------------------

export type ClusterCandidate = {
  ticketId: string;
  reference: string;
  inboundBody: string;
  resolutionExcerpt: string;
  terms: Set<string>;
};

export type Cluster = {
  ticketIds: string[];
  references: string[];
  topicTerms: string[];       // 3-5 most-shared terms — becomes topicHint
  resolutions: Array<{ ticketReference: string; excerpt: string }>;
};

export function clusterCandidates(candidates: ClusterCandidate[]): Cluster[] {
  const remaining = new Map(candidates.map((c) => [c.ticketId, c]));
  const clusters: Cluster[] = [];

  while (remaining.size > 0) {
    // Seed = the largest remaining term set.
    let seed: ClusterCandidate | undefined;
    for (const c of remaining.values()) {
      if (!seed || c.terms.size > seed.terms.size) seed = c;
    }
    if (!seed) break;
    remaining.delete(seed.ticketId);

    const members: ClusterCandidate[] = [seed];
    const sharedTermCounts = new Map<string, number>();
    for (const t of seed.terms) sharedTermCounts.set(t, 1);

    for (const c of [...remaining.values()]) {
      let shared = 0;
      for (const t of c.terms) if (seed.terms.has(t)) shared++;
      if (shared >= MIN_SHARED_TERMS) {
        members.push(c);
        remaining.delete(c.ticketId);
        for (const t of c.terms) {
          sharedTermCounts.set(t, (sharedTermCounts.get(t) ?? 0) + 1);
        }
      }
    }

    if (members.length >= MIN_CLUSTER_SIZE) {
      const topicTerms = [...sharedTermCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([t]) => t);
      clusters.push({
        ticketIds: members.map((m) => m.ticketId),
        references: members.map((m) => m.reference),
        topicTerms,
        resolutions: members.map((m) => ({
          ticketReference: m.reference,
          excerpt: redactPii(m.resolutionExcerpt),
        })),
      });
    }
  }
  return clusters;
}

// ---------------------------------------------------------------------
// Topic-hint stringify — used to nudge the model + display in admin UI
// while it's PENDING.
// ---------------------------------------------------------------------

export function topicHintFromTerms(terms: string[]): string {
  if (terms.length === 0) return "Untitled cluster";
  return terms.slice(0, 3).map((t) => t[0].toUpperCase() + t.slice(1)).join(" ");
}
