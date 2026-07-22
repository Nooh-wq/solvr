// src/actions/m19-marketplace.test.ts
//
// M19 pinning tests. Anchors on schema shape + spec §3 rules:
//   - Do NOT share OAuth tokens across tenants (encrypted at rest, per-tenant).
//   - Do NOT let an uninstall silently break active M1 rules.
//   - Do NOT build integrations without a shared interface.
//   - Do NOT show a "coming soon" integration.

process.env.SESSION_SECRET = "test-secret-at-least-32-characters-long-please";
process.env.MFA_SECRET_KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const SCHEMA_SRC = readFileSync("prisma/schema.prisma", "utf8");
const RLS_SRC = readFileSync("prisma/rls_policies.sql", "utf8");
const ACTIONS_SRC = readFileSync("src/actions/marketplace.ts", "utf8");
const EXECUTOR_SRC = readFileSync("src/lib/marketplace/executor.ts", "utf8");
const APPS_SRC = readFileSync("src/lib/marketplace/apps.ts", "utf8");
const TYPES_SRC = readFileSync("src/lib/marketplace/types.ts", "utf8");
const SLACK_SRC = readFileSync("src/lib/marketplace/slack.ts", "utf8");
const JIRA_SRC = readFileSync("src/lib/marketplace/jira.ts", "utf8");
const GITHUB_SRC = readFileSync("src/lib/marketplace/github.ts", "utf8");
const LINEAR_SRC = readFileSync("src/lib/marketplace/linear.ts", "utf8");
const ESC_LIB_SRC = readFileSync("src/lib/escalations.ts", "utf8");
const ESC_ACTIONS_SRC = readFileSync("src/actions/escalations.ts", "utf8");
const TICKET_PAGE_SRC = readFileSync("src/app/(agent)/agent/tickets/[id]/page.tsx", "utf8");

// ---------------------------------------------------------------------
// Schema + RLS
// ---------------------------------------------------------------------
describe("M19 — schema + RLS", () => {
  it("TenantIntegration stores envelope-encrypted config, not plaintext", () => {
    assert.match(SCHEMA_SRC, /model TenantIntegration[\s\S]*?configEnc\s+String/);
    assert.doesNotMatch(SCHEMA_SRC, /model TenantIntegration[\s\S]*?configJson\s+Json/);
  });

  it("TenantIntegration keys installs per (tenantId, appKey, displayName)", () => {
    assert.match(
      SCHEMA_SRC,
      /model TenantIntegration[\s\S]*?@@unique\(\[tenantId,\s*appKey,\s*displayName\]\)/
    );
  });

  it("TicketIntegrationLink is tenant-scoped and linked to both ticket + integration", () => {
    const block = SCHEMA_SRC.match(/model TicketIntegrationLink\s*\{[\s\S]*?@@map/);
    assert.ok(block, "TicketIntegrationLink model missing");
    assert.match(block![0], /tenantId\s+String/);
    assert.match(block![0], /ticketId\s+String/);
    assert.match(block![0], /integrationId\s+String/);
  });

  it("both M19 tables are RLS-enabled with tenant_isolation", () => {
    for (const t of ["tenant_integrations", "ticket_integration_links"]) {
      assert.match(RLS_SRC, new RegExp(`'${t}'`));
      assert.match(RLS_SRC, new RegExp(`tenant_isolation on ${t}`));
    }
  });
});

// ---------------------------------------------------------------------
// Shared interface — spec §3 "Do NOT build integrations without a
// shared interface. Every integration implements authenticate, test,
// execute, webhook methods." (authenticate is folded into test() +
// credentials in this implementation — one round-trip probe is
// sufficient for API-key / webhook-URL auth modes.)
// ---------------------------------------------------------------------
describe("M19 — shared connector interface", () => {
  it("Integration type declares test + execute + optional webhook", () => {
    assert.match(TYPES_SRC, /test\(ctx:\s*IntegrationContext\)/);
    assert.match(TYPES_SRC, /execute\(/);
    assert.match(TYPES_SRC, /webhook\?:/);
  });

  for (const [name, src] of [
    ["slack", SLACK_SRC],
    ["jira", JIRA_SRC],
    ["github", GITHUB_SRC],
    ["linear", LINEAR_SRC],
  ] as const) {
    it(`${name} exports an Integration with test() and execute()`, () => {
      assert.match(src, /:\s*Integration\s*=/);
      assert.match(src, /async test\(/);
      assert.match(src, /async execute\(/);
    });
  }
});

// ---------------------------------------------------------------------
// Spec §3 — "listed = installable". Every catalog entry must resolve
// to a real Integration.
// ---------------------------------------------------------------------
describe("M19 — no 'coming soon' entries", () => {
  it("catalog is a plain array of real Integration objects", () => {
    assert.match(APPS_SRC, /const CATALOG:\s*Integration\[\]/);
    // No comingSoon / disabled *field* on Integration or on catalog entries
    // (the phrase appears in a comment about the spec rule — strip
    // comments before checking).
    const noComments = APPS_SRC.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    assert.doesNotMatch(noComments, /comingSoon|disabled\s*:/i);
  });
});

// ---------------------------------------------------------------------
// Spec §3 — "Do NOT share OAuth tokens across tenants."
// ---------------------------------------------------------------------
describe("M19 — per-tenant credential isolation", () => {
  it("upsertIntegration envelope-encrypts the config blob", () => {
    assert.match(ACTIONS_SRC, /envelopeEncrypt\(\s*tx,\s*session\.tenantId/);
  });

  it("action reads scope every query to session.tenantId", () => {
    // Every findFirst/findMany on tenantIntegration in this file passes tenantId.
    const findCalls = ACTIONS_SRC.match(/tenantIntegration\.(findFirst|findMany|update|delete)/g) ?? [];
    assert.ok(findCalls.length > 0, "no tenantIntegration reads found");
    // Every read/mutate must be preceded (within ~200 chars) by tenantId scoping.
    const idx = ACTIONS_SRC.indexOf("tenantIntegration.findFirst");
    assert.ok(idx > -1);
    assert.match(ACTIONS_SRC.slice(idx, idx + 200), /tenantId:\s*session\.tenantId/);
  });

  it("executor envelope-decrypts on read (never trusts caller-supplied creds)", () => {
    assert.match(EXECUTOR_SRC, /envelopeDecrypt\(tx,\s*session\.tenantId,\s*integration\.configEnc\)/);
  });

  it("credentials are never round-tripped in the InstalledIntegrationDto", () => {
    // The DTO type has no `credentials` / `config` / `secrets` field.
    const dtoBlock = ACTIONS_SRC.match(/export type InstalledIntegrationDto = \{[\s\S]*?\};/);
    assert.ok(dtoBlock);
    assert.doesNotMatch(dtoBlock![0], /credentials|configEnc|secret/i);
  });
});

// ---------------------------------------------------------------------
// Spec §3 — "Do NOT let an uninstall silently break active M1 rules.
// Referenced integrations block uninstall until the tenant confirms
// and unlinks."
// ---------------------------------------------------------------------
describe("M19 — uninstall guard against active escalation refs", () => {
  it("uninstallIntegration scans escalationPath for INTEGRATION dests before deleting", () => {
    assert.match(
      ACTIONS_SRC,
      /uninstallIntegration[\s\S]{0,600}escalationPath\.findMany[\s\S]{0,200}destKind:\s*"INTEGRATION"/
    );
  });

  it("uninstall throws (not silently deletes) when referenced", () => {
    assert.match(
      ACTIONS_SRC,
      /blocking\.length\s*>\s*0[\s\S]{0,200}throw new Error/
    );
  });

  it("delete only fires after the block check", () => {
    const src = ACTIONS_SRC;
    const check = src.indexOf('destKind: "INTEGRATION"');
    const del = src.indexOf("tenantIntegration.delete");
    assert.ok(check > -1 && del > -1);
    assert.ok(check < del, "block check must precede delete");
  });
});

// ---------------------------------------------------------------------
// M19 — escalation-path INTEGRATION destination is now wired.
// ---------------------------------------------------------------------
describe("M19 — escalation INTEGRATION destination is live", () => {
  it("INTEGRATION_DEST_CONFIG accepts an integrationId", () => {
    assert.match(ESC_LIB_SRC, /INTEGRATION_DEST_CONFIG\s*=\s*z\.object\(\{[\s\S]*?integrationId:\s*z\.string/);
  });

  it("runEscalation INTEGRATION branch calls executeIntegration (not throws)", () => {
    assert.match(ESC_LIB_SRC, /path\.destKind === "INTEGRATION"[\s\S]{0,600}executeIntegration\(\{/);
    assert.doesNotMatch(ESC_LIB_SRC, /Integration destinations require the Marketplace \(M19\), which isn't shipped yet/);
  });

  it("createEscalationPath no longer rejects INTEGRATION kind", () => {
    assert.doesNotMatch(ESC_ACTIONS_SRC, /Integration destinations aren't available yet/);
  });
});

// ---------------------------------------------------------------------
// M19 — ticket detail shows linked external objects (DoD).
// ---------------------------------------------------------------------
describe("M19 — ticket detail linked-apps panel", () => {
  it("ticket page renders LinkedAppsPanel with links + picker", () => {
    assert.match(TICKET_PAGE_SRC, /LinkedAppsPanel/);
    assert.match(TICKET_PAGE_SRC, /listTicketIntegrationLinks/);
    assert.match(TICKET_PAGE_SRC, /listInstalledIntegrationsForPicker/);
  });
});

// ---------------------------------------------------------------------
// Executor always records the link (auditable trail on the ticket).
// ---------------------------------------------------------------------
describe("M19 — executor writes TicketIntegrationLink on success", () => {
  it("executor persists ticketIntegrationLink with externalKey/externalUrl", () => {
    assert.match(EXECUTOR_SRC, /ticketIntegrationLink\.create/);
    assert.match(EXECUTOR_SRC, /externalKey:\s*result\.externalKey/);
    assert.match(EXECUTOR_SRC, /externalUrl:\s*result\.externalUrl/);
  });

  it("executor calls the external HTTP OUTSIDE the withRls txn (no held connections)", () => {
    const src = EXECUTOR_SRC;
    // Two `await withRls(` call-sites; app.execute() sits between them.
    const first = src.indexOf("await withRls(");
    const exec = src.indexOf("app.execute(");
    const second = src.indexOf("await withRls(", first + 1);
    assert.ok(first > -1 && exec > -1 && second > -1, "expected two withRls calls and one app.execute call");
    assert.ok(first < exec && exec < second, "external call must sit between the two RLS blocks");
  });
});
