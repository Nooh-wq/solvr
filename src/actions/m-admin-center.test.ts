// src/actions/m-admin-center.test.ts
//
// M-admin-center pinning tests.

process.env.SESSION_SECRET = "test-secret-at-least-32-characters-long-please";
process.env.MFA_SECRET_KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { buildAdminNav, ADMIN_SECTIONS, ADMIN_PAGE_CATALOG } from "@/lib/admin-nav";

const LAYOUT_SRC = readFileSync("src/app/(admin)/admin/layout.tsx", "utf8");
const LANDING_SRC = readFileSync("src/app/(admin)/admin/page.tsx", "utf8");
const PALETTE_SRC = readFileSync("src/components/command-palette.tsx", "utf8");
const NEXT_CONFIG_SRC = readFileSync("next.config.ts", "utf8");

// ---------------------------------------------------------------------
// Section shape
// ---------------------------------------------------------------------
describe("M-admin — nav sections", () => {
  it("exposes 9 canonical sections including Super Admin", () => {
    const slugs = ADMIN_SECTIONS.map((s) => s.slug);
    assert.deepEqual(slugs, [
      "account",
      "people",
      "objects-rules",
      "workspaces",
      "channels",
      "apps",
      "ai",
      "analytics",
      "super",
    ]);
  });

  it("catalog is non-empty and every entry has an href, label, and section", () => {
    assert.ok(ADMIN_PAGE_CATALOG.length >= 30);
    for (const e of ADMIN_PAGE_CATALOG) {
      assert.ok(e.href.startsWith("/"));
      assert.ok(e.label.length > 0);
      assert.ok(e.section);
    }
  });
});

// ---------------------------------------------------------------------
// Role gating (spec §Permissions: hide, don't disable)
// ---------------------------------------------------------------------
describe("M-admin — role gating", () => {
  function build(role: "AGENT" | "ADMIN" | "SUPER_ADMIN") {
    return buildAdminNav({ role, tenantType: "CLIENT", pendingCount: 0, deletionCount: 0 });
  }

  it("Admin gets 8 sections (no Super Admin)", () => {
    const nav = build("ADMIN");
    const slugs = nav.sections.map((s) => s.slug);
    assert.equal(slugs.includes("super"), false, "Admin must not see Super Admin section");
    assert.equal(nav.sections.length, 8);
  });

  it("Super Admin gets all 9 sections including Super Admin", () => {
    const nav = build("SUPER_ADMIN");
    const slugs = nav.sections.map((s) => s.slug);
    assert.equal(slugs.includes("super"), true, "Super Admin must see Super Admin section");
    assert.equal(nav.sections.length, 9);
  });

  it("Super Admin section is never present in footer (moved into sections)", () => {
    const nav = build("SUPER_ADMIN");
    assert.equal(nav.footer.length, 0);
  });

  it("Super Admin section has expected sub-links", () => {
    const nav = build("SUPER_ADMIN");
    const superSection = nav.sections.find((s) => s.slug === "super");
    assert.ok(superSection);
    const hrefs = superSection!.links.map((l) => l.href);
    assert.ok(hrefs.includes("/admin/super"));
    assert.ok(hrefs.includes("/admin/super/flags"));
    assert.ok(hrefs.includes("/admin/super/health"));
    assert.ok(hrefs.includes("/admin/super/support"));
    assert.ok(hrefs.includes("/admin/super/impersonation"));
  });
});

// ---------------------------------------------------------------------
// Landing dashboard shape (spec §Landing page — 6 cards)
// ---------------------------------------------------------------------
describe("M-admin — landing dashboard", () => {
  it("renders the six landing cards", () => {
    assert.match(LANDING_SRC, /SetupProgressCard/);
    assert.match(LANDING_SRC, /Pending items/);
    assert.match(LANDING_SRC, /Recent activity/);
    assert.match(LANDING_SRC, /RecentlyViewedCard/);
    assert.match(LANDING_SRC, /System health/);
    assert.match(LANDING_SRC, /Quick actions/);
  });

  it("System health card is Super-Admin-only", () => {
    // The card renders inside an `isSuper` conditional.
    assert.match(LANDING_SRC, /isSuper\s*\?[\s\S]{0,400}System health/);
  });

  it("landing page is task-oriented, not the old analytics grid", () => {
    // Spec §"Not a general dashboard": analytics moved to /admin/analytics.
    assert.doesNotMatch(LANDING_SRC, /DonutChart|TrendChart|BarList/);
  });
});

// ---------------------------------------------------------------------
// Command palette (Cmd/Ctrl + K)
// ---------------------------------------------------------------------
describe("M-admin — command palette", () => {
  it("layout mounts the palette globally", () => {
    assert.match(LAYOUT_SRC, /CommandPalette/);
  });

  it("palette listens for Cmd/Ctrl+K", () => {
    assert.match(PALETTE_SRC, /metaKey \|\| e\.ctrlKey.*key\.toLowerCase\(\) === "k"/);
  });

  it("palette has both navigate and action modes", () => {
    assert.match(PALETTE_SRC, /isActionMode/);
    assert.match(PALETTE_SRC, /startsWith\("\>"\)/);
  });

  it("palette reads recent from localStorage under the same key the sidebar uses", () => {
    assert.match(PALETTE_SRC, /solvr:admin-recently-viewed/);
  });
});

// ---------------------------------------------------------------------
// URL redirects
// ---------------------------------------------------------------------
describe("M-admin — URL redirects", () => {
  it("next.config wires async redirects() from admin-url-map", () => {
    assert.match(NEXT_CONFIG_SRC, /ADMIN_URL_REDIRECTS/);
    assert.match(NEXT_CONFIG_SRC, /async redirects\(\)/);
  });
});
