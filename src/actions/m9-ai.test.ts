// src/actions/m9-ai.test.ts
//
// M9 pinning tests. Source-level pins on the load-bearing wire
// shapes + functional round-trips for the pure orchestrator helpers
// (content-hash + taxonomy-digest) and provider interface shape.

process.env.SESSION_SECRET = "test-secret-at-least-32-characters-long-please";
process.env.MFA_SECRET_KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  contentHash,
  taxonomyDigest,
  meetsConfidenceThreshold,
} from "@/lib/ai/classify";
import { UnconfiguredAiProvider } from "@/lib/ai/provider";

const PROVIDER_SRC = readFileSync("src/lib/ai/provider.ts", "utf8");
const CLAUDE_SRC = readFileSync("src/lib/ai/claude-provider.ts", "utf8");
const OPENROUTER_SRC = readFileSync("src/lib/ai/openrouter-provider.ts", "utf8");
const CLASSIFY_SRC = readFileSync("src/lib/ai/classify.ts", "utf8");
const CLASSIFY_FN_SRC = readFileSync(
  "src/lib/inngest/functions/classify-message.ts",
  "utf8"
);
const RULE_SCHEMA_SRC = readFileSync("src/lib/rule-schema.ts", "utf8");
const RULE_ENGINE_SRC = readFileSync("src/lib/rule-engine.ts", "utf8");
const ROUTING_SRC = readFileSync("src/lib/routing.ts", "utf8");
const OVERRIDE_SRC = readFileSync("src/actions/aiOverride.ts", "utf8");
const BANNER_SRC = readFileSync("src/components/ai/ai-signals-banner.tsx", "utf8");

// ---------------------------------------------------------------------
// Provider interface — every impl carries classifyMessage + translate
// ---------------------------------------------------------------------
describe("M9 — AiProvider interface", () => {
  it("provider.ts declares ClassifySignals and ClassifyInput types", () => {
    assert.match(PROVIDER_SRC, /export type ClassifySignals/);
    assert.match(PROVIDER_SRC, /export type ClassifyInput/);
    assert.match(PROVIDER_SRC, /classifyMessage\(input: ClassifyInput\)/);
    assert.match(PROVIDER_SRC, /translate\(/);
  });

  it("UnconfiguredAiProvider throws NOT_CONFIGURED on classify + translate", async () => {
    const p = new UnconfiguredAiProvider();
    await assert.rejects(() => p.classifyMessage({ body: "x", intents: [] }), /NOT_CONFIGURED/);
    await assert.rejects(() => p.translate("x", "en", "es"), /NOT_CONFIGURED/);
  });

  it("Claude + OpenRouter providers implement classifyMessage + translate", () => {
    assert.match(CLAUDE_SRC, /async classifyMessage\(input: ClassifyInput\)/);
    assert.match(CLAUDE_SRC, /async translate\(/);
    assert.match(OPENROUTER_SRC, /async classifyMessage\(input: ClassifyInput\)/);
    assert.match(OPENROUTER_SRC, /async translate\(/);
  });
});

// ---------------------------------------------------------------------
// classify.ts — orchestrator invariants
// ---------------------------------------------------------------------
describe("M9 — classify orchestrator", () => {
  it("content-hash is SHA-256 hex", () => {
    const h = contentHash("hello");
    assert.equal(h.length, 64);
    // Known SHA-256 of "hello"
    assert.equal(h, "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
  });

  it("same body → same hash; different body → different hash", () => {
    assert.equal(contentHash("same"), contentHash("same"));
    assert.notEqual(contentHash("a"), contentHash("b"));
  });

  it("taxonomy digest is order-invariant (sorted before hashing)", () => {
    assert.equal(taxonomyDigest(["a", "b", "c"]), taxonomyDigest(["c", "b", "a"]));
    assert.notEqual(taxonomyDigest(["a", "b"]), taxonomyDigest(["a", "c"]));
  });

  it("meetsConfidenceThreshold gates below/at/above threshold correctly", () => {
    assert.equal(meetsConfidenceThreshold(0.5, 0.7), false);
    assert.equal(meetsConfidenceThreshold(0.7, 0.7), true);
    assert.equal(meetsConfidenceThreshold(0.9, 0.7), true);
    assert.equal(meetsConfidenceThreshold(null, 0.7), false);
  });

  it("classify.ts salts the cache per-tenant via composite unique key", () => {
    assert.match(
      CLASSIFY_SRC,
      /tenantId_contentHash_taxonomyDigest/
    );
  });

  it("classify.ts never logs raw content — catch swallows silently (spec §3)", () => {
    // The try/catch around the provider call MUST NOT contain any
    // console.log / console.error of the body. This test greps for that.
    assert.doesNotMatch(CLASSIFY_SRC, /console\.(log|error)\([^)]*body/);
    // The catch block must exist and return null cleanly.
    assert.match(CLASSIFY_SRC, /}\s*catch\s*\{[^}]*return null/);
  });

  it("classify.ts enforces budget — over-cap without cache returns null", () => {
    assert.match(CLASSIFY_SRC, /aiTokensUsedThisMonth\s*>=\s*config\.aiMonthlyTokenCap/);
    assert.match(CLASSIFY_SRC, /return null/);
  });
});

// ---------------------------------------------------------------------
// classify-message Inngest function — non-blocking + skips outbound
// ---------------------------------------------------------------------
describe("M9 — classify-message Inngest function", () => {
  it("only classifies inbound (CLIENT | GUEST) messages, skips outbound", () => {
    assert.match(CLASSIFY_FN_SRC, /msg\.senderRole !== "CLIENT" && msg\.senderRole !== "GUEST"/);
  });

  it("bails when message is already classified (aiSignalsAt set)", () => {
    assert.match(CLASSIFY_FN_SRC, /if \(msg\.aiSignalsAt\).*already-classified/s);
  });

  it("fires INTENT_DETECTED and SENTIMENT_DETECTED rule events on success (M9.5)", () => {
    assert.match(CLASSIFY_FN_SRC, /fire-intent-detected/);
    assert.match(CLASSIFY_FN_SRC, /fire-sentiment-detected/);
    assert.match(CLASSIFY_FN_SRC, /INTENT_DETECTED/);
    assert.match(CLASSIFY_FN_SRC, /SENTIMENT_DETECTED/);
  });
});

// ---------------------------------------------------------------------
// M9.5 — rule schema + engine hookup
// ---------------------------------------------------------------------
describe("M9.5 — rule engine hookup", () => {
  it("triggerEventSchema includes INTENT_DETECTED + SENTIMENT_DETECTED", () => {
    assert.match(RULE_SCHEMA_SRC, /"INTENT_DETECTED"/);
    assert.match(RULE_SCHEMA_SRC, /"SENTIMENT_DETECTED"/);
  });

  it("CONDITION_FIELDS includes aiIntent + aiSentiment + aiUrgency + aiLanguage", () => {
    for (const f of ["aiIntent", "aiSentiment", "aiUrgency", "aiLanguage"]) {
      assert.match(RULE_SCHEMA_SRC, new RegExp(`"${f}"`));
    }
  });

  it("readField() resolves the AI fields from the ticket-with-signals shape", () => {
    assert.match(RULE_ENGINE_SRC, /case "aiIntent":/);
    assert.match(RULE_ENGINE_SRC, /case "aiSentiment":/);
    assert.match(RULE_ENGINE_SRC, /case "aiUrgency":/);
    assert.match(RULE_ENGINE_SRC, /case "aiLanguage":/);
  });

  it("engine reads the latest inbound message's signals into the ticket for evaluation", () => {
    assert.match(RULE_ENGINE_SRC, /senderRole:\s*\{\s*in:\s*\["CLIENT",\s*"GUEST"\]\s*\}/);
    assert.match(RULE_ENGINE_SRC, /aiSignalsAt:\s*\{\s*not:\s*null\s*\}/);
    assert.match(RULE_ENGINE_SRC, /evaluateConditions\(rule\.conditions,\s*ticketWithSignals\)/);
  });
});

// ---------------------------------------------------------------------
// M9.6 — routing preferredIntent tie-break
// ---------------------------------------------------------------------
describe("M9.6 — routing preferredIntent", () => {
  it("RouteTicketInput carries preferredIntent as a soft preference", () => {
    assert.match(ROUTING_SRC, /preferredIntent\?:\s*string/);
  });

  it("SKILLS_BASED tiebreak prefers agents whose skills include the intent", () => {
    assert.match(ROUTING_SRC, /preferredIntent[\s\S]{0,300}skills/);
  });
});

// ---------------------------------------------------------------------
// M9.4 — override + confidence-gated UI
// ---------------------------------------------------------------------
describe("M9.4 — override + confidence gating", () => {
  it("overrideMessageSignals sets aiOverriddenBySubjectId + high confidence", () => {
    assert.match(OVERRIDE_SRC, /aiOverriddenBySubjectId:\s*session\.subjectId/);
    assert.match(OVERRIDE_SRC, /aiConfidence.*=.*1/);
  });

  it("banner renders muted below threshold; solid above (M9.4)", () => {
    assert.match(BANNER_SRC, /belowThreshold/);
    assert.match(BANNER_SRC, /low confidence/);
  });
});
