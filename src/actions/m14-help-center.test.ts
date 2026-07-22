// src/actions/m14-help-center.test.ts
//
// M14 pinning tests.

process.env.SESSION_SECRET = "test-secret-at-least-32-characters-long-please";
process.env.MFA_SECRET_KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const SCHEMA_SRC = readFileSync("prisma/schema.prisma", "utf8");
const RLS_SRC = readFileSync("prisma/rls_policies.sql", "utf8");
const HC_ACTIONS_SRC = readFileSync("src/actions/helpCenters.ts", "utf8");
const PUB_SRC = readFileSync("src/actions/publicHelpCenter.ts", "utf8");
const COMMUNITY_SRC = readFileSync("src/actions/community.ts", "utf8");
const HELP_HOME_SRC = readFileSync("src/app/help/[slug]/page.tsx", "utf8");
const HELP_ARTICLE_SRC = readFileSync(
  "src/app/help/[slug]/[article]/page.tsx",
  "utf8"
);
const COMMUNITY_HOME_SRC = readFileSync(
  "src/app/help/[slug]/community/page.tsx",
  "utf8"
);
const MW_SRC = readFileSync("src/middleware.ts", "utf8");

// ---------------------------------------------------------------------
// Schema + RLS
// ---------------------------------------------------------------------
describe("M14 — schema + RLS", () => {
  it("HelpCenter has (tenantId, slug) unique and customDomain globally unique", () => {
    assert.match(SCHEMA_SRC, /model HelpCenter[\s\S]*?@@unique\(\[tenantId,\s*slug\]\)/);
    assert.match(SCHEMA_SRC, /customDomain\s+String\?\s+@unique/);
  });

  it("HelpCenter defaults communityModerationDefault=true (spec §3)", () => {
    assert.match(
      SCHEMA_SRC,
      /communityModerationDefault\s+Boolean\s+@default\(true\)/
    );
  });

  it("HelpCenter defaults communityEnabled=false — opt-in", () => {
    assert.match(SCHEMA_SRC, /communityEnabled\s+Boolean\s+@default\(false\)/);
  });

  it("KbArticle gains helpCenterId + (tenantId, helpCenterId, slug) unique", () => {
    assert.match(SCHEMA_SRC, /model KbArticle[\s\S]*?helpCenterId\s+String\?/);
    assert.match(
      SCHEMA_SRC,
      /model KbArticle[\s\S]*?@@unique\(\[tenantId,\s*helpCenterId,\s*slug\]\)/
    );
  });

  it("CommunityPost defaults status to PENDING (moderation-first)", () => {
    assert.match(
      SCHEMA_SRC,
      /model CommunityPost[\s\S]*?status\s+String\s+@default\("PENDING"\)/
    );
  });

  it("all four M14 tables are RLS-enabled", () => {
    for (const t of [
      "help_centers",
      "community_posts",
      "community_replies",
      "community_upvotes",
    ]) {
      assert.match(RLS_SRC, new RegExp(`'${t}'`));
      assert.match(RLS_SRC, new RegExp(`tenant_isolation on ${t}`));
    }
  });
});

// ---------------------------------------------------------------------
// Fail-closed resolution
// ---------------------------------------------------------------------
describe("M14.2 — fail-closed resolution", () => {
  it("resolveHelpCenterByHost filters isActive=true and returns null on miss", () => {
    assert.match(HC_ACTIONS_SRC, /customDomain:\s*normalized,\s*isActive:\s*true/);
    assert.match(HC_ACTIONS_SRC, /if \(!row\) return null/);
  });

  it("resolveHelpCenterBySlug filters isActive=true and returns null on miss", () => {
    assert.match(HC_ACTIONS_SRC, /slug,\s*isActive:\s*true/);
  });

  it("public help center home 404s on unknown slug", () => {
    assert.match(HELP_HOME_SRC, /if \(!hc\) notFound\(\)/);
  });

  it("public article page 404s on unknown slug or article", () => {
    assert.match(HELP_ARTICLE_SRC, /if \(!hc\) notFound\(\)/);
    assert.match(HELP_ARTICLE_SRC, /if \(!a\) notFound\(\)/);
  });

  it("public community home 404s on unknown slug", () => {
    assert.match(COMMUNITY_HOME_SRC, /if \(!hc\) notFound\(\)/);
  });

  it("middleware treats /help as public — signed JWTs aren't the auth here", () => {
    assert.match(MW_SRC, /"\/help"/);
  });
});

// ---------------------------------------------------------------------
// Cross-tenant isolation
// ---------------------------------------------------------------------
describe("M14.2 §3 — no cross-tenant article leak", () => {
  it("public listPublicHelpCenterArticles filters by BOTH tenantId + helpCenterId", () => {
    assert.match(
      PUB_SRC,
      /findMany\({\s*where:\s*\{\s*tenantId,\s*helpCenterId,\s*isPublished:\s*true/
    );
  });

  it("public getPublicArticleBySlugOrId filters by tenantId + helpCenterId + isPublished", () => {
    assert.match(
      PUB_SRC,
      /findFirst\({\s*where:\s*\{\s*tenantId,\s*helpCenterId,\s*isPublished:\s*true/
    );
  });

  it("public community listing filters by tenantId + helpCenterId + APPROVED/SOLVED status", () => {
    assert.match(
      PUB_SRC,
      /tenantId,\s*helpCenterId,\s*status:\s*\{\s*in:\s*\["APPROVED",\s*"SOLVED"\]/
    );
  });
});

// ---------------------------------------------------------------------
// Community + M10 feed
// ---------------------------------------------------------------------
describe("M14.3/M14.4 — community + KB suggestion feed", () => {
  it("createCommunityPost defaults status from HelpCenter.communityModerationDefault", () => {
    assert.match(
      COMMUNITY_SRC,
      /status:\s*hc\.communityModerationDefault\s*\?\s*"PENDING"\s*:\s*"APPROVED"/
    );
  });

  it("createCommunityPost rejects non-CLIENT authors (community is customer-to-customer)", () => {
    assert.match(COMMUNITY_SRC, /Only community members can post/);
  });

  it("upvote enforces exactly-one of postId or replyId", () => {
    assert.match(COMMUNITY_SRC, /Upvote must target exactly one of post or reply/);
  });

  it("upvote is idempotent per voter (unique dupe check before insert)", () => {
    assert.match(
      COMMUNITY_SRC,
      /communityUpvote\.findFirst[\s\S]{0,300}alreadyVoted:\s*true/
    );
  });

  it("markReplyAsBestAnswer flips post → SOLVED", () => {
    assert.match(COMMUNITY_SRC, /status:\s*"SOLVED",\s*bestReplyId/);
  });

  it("KB feed requires SOLVED + upvoteCount >= HelpCenter.communityUpvoteThreshold (spec §3)", () => {
    assert.match(COMMUNITY_SRC, /status:\s*"SOLVED"/);
    assert.match(
      COMMUNITY_SRC,
      /upvoteCount\s*<\s*post\.helpCenter\.communityUpvoteThreshold/
    );
  });

  it("KB feed is idempotent — feedIntoKbSuggestionAt gates re-fire", () => {
    assert.match(COMMUNITY_SRC, /feedIntoKbSuggestionAt:\s*null/);
    assert.match(COMMUNITY_SRC, /feedIntoKbSuggestionAt:\s*new Date\(\)/);
  });

  it("KB feed uses upsert with deterministic sourceDigest (no duplicates)", () => {
    assert.match(COMMUNITY_SRC, /kbSuggestion\.upsert/);
    assert.match(COMMUNITY_SRC, /community:\$\{tenantId\}:\$\{post\.id\}/);
  });

  it("moderateItem requires AGENT+", () => {
    assert.match(
      COMMUNITY_SRC,
      /moderateItem[\s\S]{0,300}requireSession\(\{\s*minRole:\s*"AGENT"\s*\}\)/
    );
  });
});
