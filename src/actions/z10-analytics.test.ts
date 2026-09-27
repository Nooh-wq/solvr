// src/actions/z10-analytics.test.ts
//
// Z10 pinning tests. Every §3 invariant + the new wire pieces.

process.env.SESSION_SECRET = "test-secret-at-least-32-characters-long-please";
process.env.MFA_SECRET_KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { signPurposeToken, verifyPurposeToken } from "@/core/auth/tokens";
import { analyticsFilterSchema } from "@/lib/validation/admin";
import {
  filterFieldsForShare,
  filterValuesForShare,
} from "@/lib/analytics/shared-cf-filter";

const SCHEMA_SRC = readFileSync("prisma/schema.prisma", "utf8");
const FILTER_BAR_SRC = readFileSync(
  "src/app/(admin)/admin/analytics/filter-bar.tsx",
  "utf8"
);
const ADMIN_SRC = readFileSync("src/actions/admin.ts", "utf8");
const ORG_SHARE_SRC = readFileSync("src/actions/orgShare.ts", "utf8");
const ORG_ANALYTICS_PAGE_SRC = readFileSync(
  "src/app/(admin)/admin/organizations/[id]/analytics/page.tsx",
  "utf8"
);
const SHARE_PAGE_SRC = readFileSync(
  "src/app/share/org/[token]/page.tsx",
  "utf8"
);
const MW_SRC = readFileSync("src/middleware.ts", "utf8");
const TOKENS_TYPES_SRC = readFileSync("src/core/auth/types.ts", "utf8");
const TOKENS_SRC = readFileSync("src/core/auth/tokens.ts", "utf8");

// ---------------------------------------------------------------------
// Schema + filter shape
// ---------------------------------------------------------------------
describe("Z10 — schema + filter", () => {
  it("CustomFieldDefinition.isInternal exists on the schema", () => {
    assert.match(SCHEMA_SRC, /isInternal\s+Boolean\s+@default\(false\)/);
    // Ensure the field is attached to the right model — grep in a
    // radius of the model declaration.
    assert.match(SCHEMA_SRC, /model CustomFieldDefinition[\s\S]{0,1500}isInternal/);
  });

  it("analyticsFilterSchema accepts groupBy: category | organization | group | tag | agent", () => {
    for (const g of ["category", "organization", "group", "tag", "agent"] as const) {
      const r = analyticsFilterSchema.safeParse({ range: "30d", groupBy: g });
      assert.equal(r.success, true, `groupBy=${g} should validate`);
    }
    const bad = analyticsFilterSchema.safeParse({ range: "30d", groupBy: "hallucinated" });
    assert.equal(bad.success, false);
  });
});

// ---------------------------------------------------------------------
// Filter bar UI wiring
// ---------------------------------------------------------------------
describe("Z10.1 — filter bar CF + groupBy", () => {
  it("filter bar renders CF dropdowns", () => {
    assert.match(FILTER_BAR_SRC, /customFieldDefinitionId/);
    assert.match(FILTER_BAR_SRC, /customFieldValue/);
  });

  it("filter bar exposes groupBy dropdown", () => {
    assert.match(FILTER_BAR_SRC, /Group by:/);
  });

  it("filter bar can hide the org dropdown for per-org pages", () => {
    assert.match(FILTER_BAR_SRC, /hideOrganization/);
  });

  it("clearing CF definition also clears the CF value (coherent state)", () => {
    assert.match(
      FILTER_BAR_SRC,
      /key === "customFieldDefinitionId"[\s\S]{0,200}params\.delete\("customFieldValue"\)/
    );
  });
});

// ---------------------------------------------------------------------
// Overview action returns customFieldDefinitions + primaryBreakdown
// ---------------------------------------------------------------------
describe("Z10.2 — overview returns primaryBreakdown + CF definitions", () => {
  it("filterOptions carries customFieldDefinitions", () => {
    assert.match(ADMIN_SRC, /customFieldDefinitions:\s*allCustomFieldDefs/);
  });

  it("overview returns primaryBreakdown pivot", () => {
    assert.match(ADMIN_SRC, /primaryBreakdown/);
    assert.match(ADMIN_SRC, /computePrimaryBreakdown/);
  });

  it("computePrimaryBreakdown handles organization / group / tag / agent dims", () => {
    for (const d of ["organization", "group", "tag", "agent"]) {
      assert.match(ADMIN_SRC, new RegExp(`dim === "${d}"`));
    }
  });
});

// ---------------------------------------------------------------------
// Z10.3 — per-org route pre-scopes + hides org filter
// ---------------------------------------------------------------------
describe("Z10.3 — per-org route", () => {
  it("per-org route forces organizationId to the URL param, never ?organizationId", () => {
    assert.match(ORG_ANALYTICS_PAGE_SRC, /organizationId:\s*id,/);
  });

  it("per-org page hides the organization dropdown", () => {
    assert.match(ORG_ANALYTICS_PAGE_SRC, /hideOrganization/);
  });
});

// ---------------------------------------------------------------------
// Z10.4 — signed share token invariants
// ---------------------------------------------------------------------
describe("Z10.4 — signed share token", () => {
  it("org_analytics_share purpose is declared in TokenPurpose + PurposePayloads", () => {
    assert.match(TOKENS_TYPES_SRC, /"org_analytics_share"/);
    assert.match(TOKENS_TYPES_SRC, /OrgAnalyticsShareTokenPayload/);
    assert.match(
      TOKENS_TYPES_SRC,
      /org_analytics_share:\s*OrgAnalyticsShareTokenPayload/
    );
  });

  it("org_analytics_share has a TTL entry", () => {
    assert.match(TOKENS_SRC, /org_analytics_share:\s*60\s*\*\s*60\s*\*\s*24/);
  });

  it("createOrgShareLink signs the org_analytics_share purpose", () => {
    assert.match(ORG_SHARE_SRC, /signPurposeToken\(\s*"org_analytics_share",/);
    assert.match(ORG_SHARE_SRC, /organizationId:\s*org\.id/);
    assert.match(ORG_SHARE_SRC, /tenantId:\s*session\.tenantId/);
  });

  it("createOrgShareLink checks the org belongs to the acting tenant", () => {
    assert.match(ORG_SHARE_SRC, /tx\.organization\.findFirst\(/);
    assert.match(ORG_SHARE_SRC, /Organization not found/);
  });

  it("public share page verifies purpose = org_analytics_share", () => {
    assert.match(SHARE_PAGE_SRC, /verifyPurposeToken\(token,\s*"org_analytics_share"\)/);
  });

  it("public share page uses ONLY claims.organizationId (never a URL param)", () => {
    assert.match(SHARE_PAGE_SRC, /organizationId:\s*claims\.organizationId/);
    // No place in the file should thread a search-param org id.
    assert.doesNotMatch(SHARE_PAGE_SRC, /searchParams.*organizationId/);
  });

  it("public share page renders no FilterBar (holders can't broaden scope)", () => {
    assert.doesNotMatch(SHARE_PAGE_SRC, /<FilterBar/);
  });

  it("middleware treats /share as public (JWT is the auth)", () => {
    assert.match(MW_SRC, /"\/share"/);
  });

  it("token round-trip: {tenantId, organizationId} survives sign → verify", async () => {
    const token = await signPurposeToken(
      "org_analytics_share",
      { tenantId: "tenant-abc", organizationId: "org-xyz" },
      { ttlSeconds: 60 }
    );
    const decoded = await verifyPurposeToken(token, "org_analytics_share");
    assert.ok(decoded);
    assert.equal(decoded?.tenantId, "tenant-abc");
    assert.equal(decoded?.organizationId, "org-xyz");
  });

  it("token verified under WRONG purpose returns null (spec §3 confusion protection)", async () => {
    const token = await signPurposeToken(
      "org_analytics_share",
      { tenantId: "t", organizationId: "o" },
      { ttlSeconds: 60 }
    );
    const decoded = await verifyPurposeToken(token, "analytics_share");
    assert.equal(decoded, null);
  });
});

// ---------------------------------------------------------------------
// Internal-CF gate
// ---------------------------------------------------------------------
describe("Z10 §3 — internal CF gate for shared views", () => {
  const fields = [
    { id: "1", key: "phone", label: "Phone", isInternal: false },
    { id: "2", key: "risk_score", label: "Risk score", isInternal: true },
    { id: "3", key: "region", label: "Region", isInternal: false },
  ];

  it("filterFieldsForShare drops internal fields", () => {
    const kept = filterFieldsForShare(fields);
    assert.deepEqual(kept.map((f) => f.key), ["phone", "region"]);
  });

  it("filterValuesForShare drops values whose def is internal", () => {
    const values = { "1": "555", "2": "88", "3": "US" };
    const byId = new Map(fields.map((f) => [f.id, f]));
    const kept = filterValuesForShare(values, byId);
    assert.deepEqual(Object.keys(kept).sort(), ["1", "3"]);
  });
});
