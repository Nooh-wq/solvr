// src/actions/m10-kb.test.ts
//
// M10 pinning tests. Pure-function pins on the clustering + stale
// pipeline + source-level pins on the load-bearing wire (spec §3 pins:
// PII redaction runs BEFORE excerpts leave for the model; internal notes
// filtered out; auto-publish forbidden).

process.env.SESSION_SECRET = "test-secret-at-least-32-characters-long-please";
process.env.MFA_SECRET_KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  redactPii,
  computeSourceDigest,
  materiallyMoreContent,
  extractLongTerms,
  clusterCandidates,
  topicHintFromTerms,
  RE_SUGGEST_GROWTH_MULTIPLIER,
  MIN_CLUSTER_SIZE,
  MIN_SHARED_TERMS,
  type ClusterCandidate,
} from "@/lib/ai/kb-cluster";
import { getStaleArticleIds, STALE_MONTHS } from "@/lib/ai/kb-stale";
import { UnconfiguredAiProvider } from "@/lib/ai/provider";

const PROVIDER_SRC = readFileSync("src/lib/ai/provider.ts", "utf8");
const CLAUDE_SRC = readFileSync("src/lib/ai/claude-provider.ts", "utf8");
const OPENROUTER_SRC = readFileSync("src/lib/ai/openrouter-provider.ts", "utf8");
const CRON_SRC = readFileSync(
  "src/lib/inngest/functions/cluster-kb-suggestions.ts",
  "utf8"
);
const ACTIONS_SRC = readFileSync("src/actions/kbSuggestions.ts", "utf8");
const SCHEMA_SRC = readFileSync("prisma/schema.prisma", "utf8");
const RLS_SRC = readFileSync("prisma/rls_policies.sql", "utf8");
const INNGEST_ROUTE_SRC = readFileSync("src/app/api/inngest/route.ts", "utf8");

// ---------------------------------------------------------------------
// Provider interface — every impl carries draftKbArticle
// ---------------------------------------------------------------------
describe("M10 — AiProvider.draftKbArticle", () => {
  it("provider.ts declares DraftKbInput + KbDraft + draftKbArticle", () => {
    assert.match(PROVIDER_SRC, /export type DraftKbInput/);
    assert.match(PROVIDER_SRC, /export type KbDraft/);
    assert.match(PROVIDER_SRC, /draftKbArticle\(input: DraftKbInput\)/);
  });

  it("UnconfiguredAiProvider throws NOT_CONFIGURED on draftKbArticle", async () => {
    const p = new UnconfiguredAiProvider();
    await assert.rejects(
      () => p.draftKbArticle({ topicHint: "x", resolutions: [] }),
      /NOT_CONFIGURED/
    );
  });

  it("Claude + OpenRouter providers implement draftKbArticle", () => {
    assert.match(CLAUDE_SRC, /async draftKbArticle\(input: DraftKbInput\)/);
    assert.match(OPENROUTER_SRC, /async draftKbArticle\(input: DraftKbInput\)/);
  });

  it("Provider prompt refuses to invent facts (grounded-only)", () => {
    // Both providers must instruct the model to ground strictly in
    // the resolved-ticket excerpts. Pinned via prompt substring.
    assert.match(CLAUDE_SRC, /grounded strictly in the provided/);
    assert.match(OPENROUTER_SRC, /grounded strictly in the provided/);
  });
});

// ---------------------------------------------------------------------
// PII redaction — spec §3 "do not include PII in draft articles"
// ---------------------------------------------------------------------
describe("M10 — redactPii", () => {
  it("strips email addresses", () => {
    const r = redactPii("Contact user at alice@example.com to confirm.");
    assert.doesNotMatch(r, /alice@example\.com/);
    assert.match(r, /\[email redacted\]/);
  });

  it("strips phone numbers", () => {
    const r = redactPii("Call +1 (555) 123-4567 for followup.");
    assert.doesNotMatch(r, /555/);
    assert.match(r, /\[number redacted\]/);
  });

  it("strips credit-card-ish digit runs", () => {
    const r = redactPii("Card 4532-1234-5678-9010 declined.");
    assert.doesNotMatch(r, /4532/);
    assert.match(r, /\[number redacted\]/);
  });

  it("strips long alphanumeric tokens (session ids, api keys)", () => {
    const r = redactPii("Session key ABCDEFGHIJKLMNOPQRSTUVWXYZ012345 expired.");
    assert.doesNotMatch(r, /ABCDEFGHIJKLMNOPQRSTUVWXYZ012345/);
    assert.match(r, /\[token redacted\]/);
  });

  it("strips URL query strings (session ids ride in them)", () => {
    const r = redactPii("Visit https://example.com/reset?token=verysecrettoken to continue.");
    assert.doesNotMatch(r, /verysecrettoken/);
    assert.match(r, /\?\[redacted\]/);
  });

  it("leaves plain prose untouched", () => {
    const s = "The printer PIN reset flow is documented in the setup guide.";
    assert.equal(redactPii(s), s);
  });
});

// ---------------------------------------------------------------------
// Source digest — identity for rejection memory + dedup
// ---------------------------------------------------------------------
describe("M10 — computeSourceDigest", () => {
  it("is sha256 hex (64 chars)", () => {
    const d = computeSourceDigest(["a", "b", "c"]);
    assert.equal(d.length, 64);
    assert.match(d, /^[0-9a-f]+$/);
  });

  it("is order-invariant (sorted before hashing)", () => {
    assert.equal(
      computeSourceDigest(["t1", "t2", "t3"]),
      computeSourceDigest(["t3", "t1", "t2"])
    );
  });

  it("different sets produce different digests", () => {
    assert.notEqual(
      computeSourceDigest(["t1", "t2"]),
      computeSourceDigest(["t1", "t3"])
    );
  });
});

// ---------------------------------------------------------------------
// Rejection memory gate
// ---------------------------------------------------------------------
describe("M10.4 — materiallyMoreContent", () => {
  it("blocks re-suggest until growth multiplier reached", () => {
    assert.equal(materiallyMoreContent(3, 3), false);
    assert.equal(materiallyMoreContent(3, 5), false);
    assert.equal(materiallyMoreContent(3, 3 * RE_SUGGEST_GROWTH_MULTIPLIER), true);
    assert.equal(materiallyMoreContent(3, 3 * RE_SUGGEST_GROWTH_MULTIPLIER + 10), true);
  });
});

// ---------------------------------------------------------------------
// Clustering — greedy shared-term grouping
// ---------------------------------------------------------------------
describe("M10 — clusterCandidates", () => {
  const mk = (id: string, body: string): ClusterCandidate => ({
    ticketId: id,
    reference: `TCK-${id}`,
    inboundBody: body,
    resolutionExcerpt: `Resolution for ${id}`,
    terms: extractLongTerms(body),
  });

  it("groups tickets sharing enough long terms and drops singletons", () => {
    // Four tickets about resetting a printer PIN — share printer/reset/pin
    const a = mk("a", "Cannot reset my printer PIN, keeps saying wrong password");
    const b = mk("b", "Printer PIN reset failing on model 4520, password error shown");
    const c = mk("c", "How do I reset the printer PIN after password change?");
    const d = mk("d", "Locked out of company VPN configuration troubleshooting"); // unrelated
    const e = mk("e", "Where do I find quarterly analytics dashboard exports"); // unrelated
    const clusters = clusterCandidates([a, b, c, d, e]);
    assert.equal(clusters.length, 1, "one printer-pin cluster should form");
    const ids = new Set(clusters[0].ticketIds);
    assert.ok(ids.has("a") && ids.has("b") && ids.has("c"));
    assert.ok(!ids.has("d") && !ids.has("e"));
  });

  it("respects MIN_CLUSTER_SIZE (2 tickets alone don't cluster)", () => {
    const a = mk("a", "printer reset password pin issue printer");
    const b = mk("b", "printer reset password pin issue printer");
    assert.equal(clusterCandidates([a, b]).length, 0);
  });

  it("PII redaction is applied to resolutions in the cluster output", () => {
    const withPii = (id: string, body: string): ClusterCandidate => ({
      ticketId: id,
      reference: `TCK-${id}`,
      inboundBody: body,
      resolutionExcerpt: `Contacted user at leaked@example.com for details.`,
      terms: extractLongTerms(body),
    });
    const clusters = clusterCandidates([
      withPii("a", "printer reset password pin issue printer"),
      withPii("b", "printer reset password pin issue printer"),
      withPii("c", "printer reset password pin issue printer"),
    ]);
    assert.equal(clusters.length, 1);
    for (const r of clusters[0].resolutions) {
      assert.doesNotMatch(r.excerpt, /leaked@example\.com/);
    }
  });

  it("thresholds MIN_CLUSTER_SIZE and MIN_SHARED_TERMS are exposed as pinnable consts", () => {
    assert.equal(MIN_CLUSTER_SIZE, 3);
    assert.ok(MIN_SHARED_TERMS >= 1);
  });
});

describe("M10 — topicHintFromTerms", () => {
  it("title-cases the top terms", () => {
    assert.equal(topicHintFromTerms(["printer", "reset", "pin"]), "Printer Reset Pin");
  });
  it("degrades gracefully to Untitled cluster", () => {
    assert.equal(topicHintFromTerms([]), "Untitled cluster");
  });
});

// ---------------------------------------------------------------------
// Stale detection
// ---------------------------------------------------------------------
describe("M10.3 — getStaleArticleIds", () => {
  const now = new Date("2026-07-13T00:00:00Z");

  it("flags articles never reviewed and older than STALE_MONTHS by updatedAt", () => {
    const long = new Date(now);
    long.setUTCMonth(long.getUTCMonth() - (STALE_MONTHS + 1));
    const fresh = new Date(now);
    fresh.setUTCMonth(fresh.getUTCMonth() - 1);
    const stale = getStaleArticleIds(
      [
        { id: "old", updatedAt: long, reviewedAt: null },
        { id: "new", updatedAt: fresh, reviewedAt: null },
      ],
      now
    );
    assert.ok(stale.has("old"));
    assert.ok(!stale.has("new"));
  });

  it("reviewedAt beats updatedAt when set (admin re-approval refreshes)", () => {
    const oldEdit = new Date(now);
    oldEdit.setUTCMonth(oldEdit.getUTCMonth() - (STALE_MONTHS + 2));
    const recentReview = new Date(now);
    recentReview.setUTCMonth(recentReview.getUTCMonth() - 1);
    const stale = getStaleArticleIds(
      [{ id: "x", updatedAt: oldEdit, reviewedAt: recentReview }],
      now
    );
    assert.equal(stale.has("x"), false);
  });
});

// ---------------------------------------------------------------------
// Spec §3 pins — must-not-happen invariants
// ---------------------------------------------------------------------
describe("M10 — spec §3 pins", () => {
  it("cron filters internal notes out before candidates are formed", () => {
    // Message queries on the cron pin the isInternal:false filter, so an
    // internal note can never contribute to a draft.
    assert.match(CRON_SRC, /isInternal:\s*false/);
  });

  it("cron only considers CLIENT/GUEST inbound messages for the ask", () => {
    assert.match(CRON_SRC, /senderRole:\s*\{\s*in:\s*\["CLIENT",\s*"GUEST"\]\s*\}/);
  });

  it("cron never auto-publishes: KbSuggestion.status default is PENDING", () => {
    assert.match(SCHEMA_SRC, /status\s+String\s+@default\("PENDING"\)/);
    // And the cron only creates rows with status: "PENDING"
    assert.match(CRON_SRC, /status:\s*"PENDING"/);
  });

  it("acceptKbSuggestion is the only path that publishes an article", () => {
    // Guard: publishing (creating a KbArticle isPublished=true from a
    // suggestion) lives only in acceptKbSuggestion.
    assert.match(ACTIONS_SRC, /acceptKbSuggestion/);
    assert.match(ACTIONS_SRC, /isPublished:\s*true/);
  });

  it("KbSuggestion has a unique (tenantId, sourceDigest) — rejection memory works", () => {
    assert.match(SCHEMA_SRC, /@@unique\(\[tenantId,\s*sourceDigest\]\)/);
  });

  it("kb_suggestions is RLS-enabled at the schema level", () => {
    assert.match(RLS_SRC, /'kb_suggestions'/);
    assert.match(RLS_SRC, /tenant_isolation on kb_suggestions/);
  });

  it("cluster-kb-suggestions is registered in the Inngest route", () => {
    assert.match(INNGEST_ROUTE_SRC, /clusterKbSuggestions/);
  });
});
