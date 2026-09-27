// src/actions/m11-qa.test.ts
//
// M11 pinning tests. Every §3 invariant + the pure-function core of
// the scorer.

process.env.SESSION_SECRET = "test-secret-at-least-32-characters-long-please";
process.env.MFA_SECRET_KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  rubricSchema,
  computeOverall,
  computeFlags,
  readRubric,
  DEFAULT_RUBRIC,
} from "@/lib/ai/qa";
import { UnconfiguredAiProvider } from "@/lib/ai/provider";

const PROVIDER_SRC = readFileSync("src/lib/ai/provider.ts", "utf8");
const CLAUDE_SRC = readFileSync("src/lib/ai/claude-provider.ts", "utf8");
const OPENROUTER_SRC = readFileSync("src/lib/ai/openrouter-provider.ts", "utf8");
const CRON_SRC = readFileSync("src/lib/inngest/functions/score-reply.ts", "utf8");
const EMIT_SRC = readFileSync("src/lib/ai/emit-score.ts", "utf8");
const ACTIONS_SRC = readFileSync("src/actions/qaScores.ts", "utf8");
const RUBRIC_ACTIONS_SRC = readFileSync("src/actions/qaRubric.ts", "utf8");
const TICKETS_SRC = readFileSync("src/actions/tickets.ts", "utf8");
const SCHEMA_SRC = readFileSync("prisma/schema.prisma", "utf8");
const RLS_SRC = readFileSync("prisma/rls_policies.sql", "utf8");
const INNGEST_ROUTE_SRC = readFileSync("src/app/api/inngest/route.ts", "utf8");
const ADMIN_PAGE_SRC = readFileSync(
  "src/app/(admin)/admin/ai/qa/rubric/page.tsx",
  "utf8"
);
const AGENT_PAGE_SRC = readFileSync(
  "src/app/(agent)/agent/coaching/page.tsx",
  "utf8"
);

// ---------------------------------------------------------------------
// Provider extension
// ---------------------------------------------------------------------
describe("M11 — AiProvider.scoreReply", () => {
  it("provider.ts declares QaScoreInput + QaScoreResult + scoreReply", () => {
    assert.match(PROVIDER_SRC, /export type QaScoreInput/);
    assert.match(PROVIDER_SRC, /export type QaScoreResult/);
    assert.match(PROVIDER_SRC, /scoreReply\(input: QaScoreInput\)/);
  });

  it("UnconfiguredAiProvider throws NOT_CONFIGURED on scoreReply", async () => {
    const p = new UnconfiguredAiProvider();
    await assert.rejects(
      () =>
        p.scoreReply({
          dimensions: DEFAULT_RUBRIC,
          threadExcerpt: "",
          replyBody: "",
        }),
      /NOT_CONFIGURED/
    );
  });

  it("Claude + OpenRouter providers implement scoreReply", () => {
    assert.match(CLAUDE_SRC, /async scoreReply\(input: QaScoreInput\)/);
    assert.match(OPENROUTER_SRC, /async scoreReply\(input: QaScoreInput\)/);
  });
});

// ---------------------------------------------------------------------
// Rubric shape + pure math
// ---------------------------------------------------------------------
describe("M11 — rubric parsing + scoring math", () => {
  it("rubricSchema accepts a well-formed rubric", () => {
    const r = rubricSchema.safeParse(DEFAULT_RUBRIC);
    assert.equal(r.success, true);
  });

  it("rubricSchema rejects garbage", () => {
    assert.equal(rubricSchema.safeParse([]).success, false);
    assert.equal(rubricSchema.safeParse([{ key: "x" }]).success, false);
    assert.equal(
      rubricSchema.safeParse([
        { key: "BadCase", label: "l", description: "d", weight: 1, flagBelow: 1 },
      ]).success,
      false
    );
  });

  it("readRubric returns null on malformed input", () => {
    assert.equal(readRubric(null), null);
    assert.equal(readRubric([]), null);
    assert.ok(readRubric(DEFAULT_RUBRIC));
  });

  it("computeOverall is weight-normalised (weights don't need to sum to 1)", () => {
    const rubric = rubricSchema.parse([
      { key: "a", label: "A", description: "d", weight: 3, flagBelow: 1 },
      { key: "b", label: "B", description: "d", weight: 1, flagBelow: 1 },
    ]);
    // (5*3 + 1*1) / (3+1) = 16/4 = 4
    assert.equal(computeOverall(rubric, { a: 5, b: 1 }), 4);
  });

  it("computeOverall falls back to unweighted mean when total weight is 0", () => {
    const rubric = rubricSchema.parse([
      { key: "a", label: "A", description: "d", weight: 0, flagBelow: 1 },
      { key: "b", label: "B", description: "d", weight: 0, flagBelow: 1 },
    ]);
    assert.equal(computeOverall(rubric, { a: 4, b: 2 }), 3);
  });

  it("computeFlags collects dimensions below their flagBelow threshold", () => {
    const rubric = rubricSchema.parse([
      { key: "tone", label: "Tone", description: "d", weight: 1, flagBelow: 3 },
      { key: "acc", label: "Accuracy", description: "d", weight: 1, flagBelow: 4 },
    ]);
    assert.deepEqual(computeFlags(rubric, { tone: 2.5, acc: 4.5 }), ["tone"]);
    assert.deepEqual(computeFlags(rubric, { tone: 3, acc: 3 }), ["acc"]);
    assert.deepEqual(computeFlags(rubric, { tone: 5, acc: 4 }), []);
  });
});

// ---------------------------------------------------------------------
// Spec §3 pins
// ---------------------------------------------------------------------
describe("M11 — spec §3 pins", () => {
  it("scoring is async / non-blocking — emit-score.ts uses inngest.send fire-and-forget", () => {
    assert.match(EMIT_SRC, /inngest\.send\(/);
    assert.match(EMIT_SRC, /catch/);
  });

  it("scorer only runs on sent messages (isInternal:false, senderRole excluded elsewhere)", () => {
    assert.match(CRON_SRC, /isInternal:\s*false/);
  });

  it("scorer never re-scores the same message (unique constraint + retry-safe branch)", () => {
    assert.match(SCHEMA_SRC, /messageId\s+String\s+@unique/);
    assert.match(CRON_SRC, /already-scored/);
  });

  it("scorer swallows provider errors silently — never logs the rubric prompt or reply body", () => {
    // The provider call is inside a try/catch; the catch body returns
    // without logging.
    assert.match(CRON_SRC, /catch \{[\s\S]*?return \{\s*skipped:\s*true,\s*reason:\s*"provider-error"/);
    assert.doesNotMatch(CRON_SRC, /console\.(log|error)\([^)]*rubric/);
    assert.doesNotMatch(CRON_SRC, /console\.(log|error)\([^)]*replyBody/);
  });

  it("QaScore visibility limited to AGENT+ (end users can't read qa_scores via any action)", () => {
    assert.match(ACTIONS_SRC, /requireSession\(\{\s*minRole:\s*"AGENT"\s*\}\)/);
    assert.doesNotMatch(ACTIONS_SRC, /minRole:\s*"CLIENT"/);
  });

  it("agent coaching view uses AGENT-gated actions (no CLIENT reachable route)", () => {
    assert.match(AGENT_PAGE_SRC, /getComplianceTrend/);
    assert.match(AGENT_PAGE_SRC, /listQaScores/);
  });

  it("admin rubric page requires ADMIN+", () => {
    assert.match(RUBRIC_ACTIONS_SRC, /requireSession\(\{\s*minRole:\s*"ADMIN"\s*\}\)/);
    assert.match(ADMIN_PAGE_SRC, /listQaRubrics/);
  });

  it("qa_rubrics + qa_scores are RLS-enabled", () => {
    assert.match(RLS_SRC, /'qa_rubrics','qa_scores'/);
    assert.match(RLS_SRC, /tenant_isolation on qa_rubrics/);
    assert.match(RLS_SRC, /tenant_isolation on qa_scores/);
  });

  it("score-reply is registered in the Inngest route", () => {
    assert.match(INNGEST_ROUTE_SRC, /scoreReplyFn/);
  });

  it("postAgentReply fires the score event only on public replies", () => {
    assert.match(TICKETS_SRC, /emitScoreReplyEvent\(/);
    // The emit call sits inside the `if (!data.isInternal)` branch —
    // grep for both in close proximity.
    assert.match(
      TICKETS_SRC,
      /if \(!data\.isInternal\)[\s\S]{0,500}emitScoreReplyEvent/
    );
  });

  it("QaScore uniqueness on messageId prevents double-scoring on Inngest retry", () => {
    assert.match(SCHEMA_SRC, /model QaScore[\s\S]*?messageId\s+String\s+@unique/);
  });

  it("only one active rubric per tenant — upsert flips prior actives", () => {
    assert.match(RUBRIC_ACTIONS_SRC, /updateMany\([\s\S]*?isActive:\s*true[\s\S]*?data:\s*\{\s*isActive:\s*false/);
  });
});

// ---------------------------------------------------------------------
// Team-lead scoping — the visibility rule
// ---------------------------------------------------------------------
describe("M11 — team scoping (spec §3: no cross-agent visibility)", () => {
  it("listQaScores narrows to session.subjectId when role isn't ADMIN+ / Team Lead", () => {
    // Encoded via the canSeeOthers() gate + authorTeamMemberId filter.
    assert.match(ACTIONS_SRC, /canSeeOthers/);
    assert.match(ACTIONS_SRC, /authorTeamMemberId:\s*session\.subjectId/);
  });
});
