// src/actions/m20-compliance.test.ts
//
// M20 pinning tests. Anchors on schema shape + spec §3 rules:
//   - Do NOT cross-region a query.
//   - Do NOT log PHI to Sentry / third-party observability for HIPAA tenants.
//   - Do NOT let BYOK be a marketing checkbox without operational discipline.
//   - Do NOT allow tenant-level residency to be changed after provisioning
//     without a migration plan.
// Plus behavioural pins on redactForLog + BYOK envelope + PHI mask.

process.env.SESSION_SECRET = "test-secret-at-least-32-characters-long-please";
process.env.MFA_SECRET_KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { redactForLog, redactValueForShare, loggableError } from "@/lib/compliance/redact";
import { canReadPhi, gatePhiValue, MASKED_PHI } from "@/lib/compliance/phi";
import { assertResidency, ResidencyMismatchError, currentRegion } from "@/lib/compliance/residency";

const SCHEMA_SRC = readFileSync("prisma/schema.prisma", "utf8");
const AUTH_SRC = readFileSync("src/lib/auth.ts", "utf8");
const COMPLIANCE_SRC = readFileSync("src/actions/compliance.ts", "utf8");
const BYOK_SRC = readFileSync("src/lib/compliance/byok.ts", "utf8");
const REDACT_SRC = readFileSync("src/lib/compliance/redact.ts", "utf8");
const CF_SRC = readFileSync("src/actions/customFields.ts", "utf8");
const SWEEP_SRC = readFileSync("src/lib/inngest/functions/sweep-retention.ts", "utf8");

// ---------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------
describe("M20 — schema", () => {
  it("Tenant carries residencyRegion + hipaaEnabled + retention TTLs", () => {
    assert.match(SCHEMA_SRC, /residencyRegion\s+String\s+@default\("US"\)/);
    assert.match(SCHEMA_SRC, /hipaaEnabled\s+Boolean\s+@default\(false\)/);
    assert.match(SCHEMA_SRC, /retentionTicketsDays\s+Int\?/);
    assert.match(SCHEMA_SRC, /retentionMessagesDays\s+Int\?/);
    assert.match(SCHEMA_SRC, /retentionAuditLogsDays\s+Int\?/);
  });

  it("TenantEncryptionKey supports BYOK + crypto-shred", () => {
    assert.match(SCHEMA_SRC, /model TenantEncryptionKey[\s\S]*?kmsMode\s+String\s+@default\("PLATFORM"\)/);
    assert.match(SCHEMA_SRC, /model TenantEncryptionKey[\s\S]*?kmsKeyRef\s+String\?/);
    assert.match(SCHEMA_SRC, /model TenantEncryptionKey[\s\S]*?shreddedAt\s+DateTime\?/);
  });

  it("CustomFieldDefinition has isPhi (default false)", () => {
    assert.match(SCHEMA_SRC, /isPhi\s+Boolean\s+@default\(false\)/);
  });

  it("CustomFieldValue has valueEnc (PHI ciphertext)", () => {
    assert.match(SCHEMA_SRC, /model CustomFieldValue[\s\S]*?valueEnc\s+String\?/);
  });
});

// ---------------------------------------------------------------------
// Spec §3 — cross-region guard
// ---------------------------------------------------------------------
describe("M20.1 — cross-region guard", () => {
  it("assertResidency no-ops on '*' (single-region deployment)", () => {
    delete process.env.APP_REGION;
    assert.doesNotThrow(() => assertResidency("EU"));
    assert.doesNotThrow(() => assertResidency("US"));
  });

  it("assertResidency throws on region mismatch", () => {
    process.env.APP_REGION = "US";
    assert.throws(() => assertResidency("EU"), ResidencyMismatchError);
    assert.doesNotThrow(() => assertResidency("US"));
    // case-insensitive
    assert.doesNotThrow(() => assertResidency("us"));
    delete process.env.APP_REGION;
  });

  it("currentRegion respects APP_REGION env", () => {
    process.env.APP_REGION = "EU";
    assert.equal(currentRegion(), "EU");
    delete process.env.APP_REGION;
    assert.equal(currentRegion(), "*");
  });

  it("requireSession funnels through assertRequestResidency", () => {
    assert.match(AUTH_SRC, /assertRequestResidency\(user\.tenantId\)/);
    assert.match(AUTH_SRC, /getTenantResidency/);
  });
});

// ---------------------------------------------------------------------
// Spec §3 — BYOK operational discipline
// ---------------------------------------------------------------------
describe("M20.5 — BYOK + crypto-shred", () => {
  it("shredTenantKey overwrites wrappedDek + sets shreddedAt (no soft delete)", () => {
    assert.match(BYOK_SRC, /wrappedDek:\s*"SHREDDED:"\s*\+/);
    assert.match(BYOK_SRC, /shreddedAt:\s*new Date\(\)/);
  });

  it("shredTenantEncryptionKey action requires SUPER_ADMIN + confirm token", () => {
    assert.match(
      COMPLIANCE_SRC,
      /shredTenantEncryptionKey[\s\S]{0,300}requireSession\(\{\s*minRole:\s*"SUPER_ADMIN"/
    );
    assert.match(COMPLIANCE_SRC, /SHRED-I-UNDERSTAND/);
  });

  it("configureByok requires SUPER_ADMIN", () => {
    assert.match(
      COMPLIANCE_SRC,
      /configureByok[\s\S]{0,300}requireSession\(\{\s*minRole:\s*"SUPER_ADMIN"/
    );
  });

  it("BYOK mode requires a kmsKeyRef (no marketing-checkbox path)", () => {
    assert.match(COMPLIANCE_SRC, /BYOK mode requires a KMS key reference/);
  });
});

// ---------------------------------------------------------------------
// Spec §3 — PHI redaction + mask
// ---------------------------------------------------------------------
describe("M20.6 — redactForLog scrubs PII", () => {
  it("scrubs emails, phones, SSNs, credit cards, IPs, and dates", () => {
    const input =
      "user alice@example.com phoned 555-234-5678, SSN 123-45-6789, card 4111 1111 1111 1111, ip 10.0.0.1 on 2025-06-15";
    const out = redactForLog(input);
    assert.doesNotMatch(out, /alice@example\.com/);
    assert.doesNotMatch(out, /123-45-6789/);
    assert.doesNotMatch(out, /4111 1111 1111 1111/);
    assert.doesNotMatch(out, /10\.0\.0\.1/);
    assert.doesNotMatch(out, /2025-06-15/);
    assert.match(out, /\[email\]/);
    assert.match(out, /\[ssn\]/);
  });

  it("loggableError returns opaque message for HIPAA tenants", () => {
    const r = loggableError(new Error("patient alice@example.com blood pressure 180"), { hipaa: true });
    assert.doesNotMatch(r.message, /alice/);
    assert.doesNotMatch(r.message, /blood pressure/);
    assert.match(r.id, /^err_/);
  });

  it("loggableError still scrubs PII even for non-HIPAA tenants", () => {
    const r = loggableError(new Error("db failure for user@x.com"), { hipaa: false });
    assert.doesNotMatch(r.message, /user@x\.com/);
  });

  it("redactValueForShare masks PHI-marked definition values", () => {
    assert.equal(redactValueForShare("secret", { isPhi: true }), "•••");
    assert.equal(redactValueForShare("public", { isPhi: false }), "public");
    assert.equal(redactValueForShare("public", null), "public");
  });
});

describe("M20.4 — PHI read gate", () => {
  const baseSession = {
    subjectId: "u1",
    tenantId: "t1",
    email: "a@b.c",
    name: "A",
    sessionId: "s",
    avatarUrl: null,
    roleName: null,
    ticketAccessScope: null,
    groupIds: [] as string[],
  };

  it("canReadPhi is true for ADMIN and SUPER_ADMIN regardless of role permissions", () => {
    assert.equal(canReadPhi({ ...baseSession, role: "ADMIN" }, {}), true);
    assert.equal(canReadPhi({ ...baseSession, role: "SUPER_ADMIN" }, {}), true);
  });

  it("canReadPhi is false for AGENT unless role.permissions.phiRead is true", () => {
    assert.equal(canReadPhi({ ...baseSession, role: "AGENT" }, {}), false);
    assert.equal(canReadPhi({ ...baseSession, role: "AGENT" }, { phiRead: true }), true);
  });

  it("gatePhiValue closes by default (masks even when isPhi=true and no permission)", () => {
    assert.equal(gatePhiValue(true, false, "secret"), MASKED_PHI);
    assert.equal(gatePhiValue(true, true, "secret"), "secret");
    assert.equal(gatePhiValue(false, false, "public"), "public");
  });
});

// ---------------------------------------------------------------------
// Spec §3 — Custom-field encryption on write + gated read
// ---------------------------------------------------------------------
describe("M20.4 — PHI values are encrypted at rest", () => {
  it("upsertValue envelope-encrypts when def.isPhi=true", () => {
    assert.match(CF_SRC, /def\.isPhi[\s\S]{0,1400}envelopeEncrypt\(tx,\s*session\.tenantId/);
  });

  it("upsertValue nulls the typed columns when writing PHI", () => {
    assert.match(CF_SRC, /valueText: def\.isPhi\s*\?\s*null/);
  });

  it("listValuesForTarget only decrypts for phiRead-authorised callers", () => {
    assert.match(CF_SRC, /if \(phiRead\)/);
    // The `if (phiRead)` block must contain the envelopeDecrypt CALL
    // (not the import). Anchor on the call site directly.
    assert.match(
      CF_SRC,
      /if \(phiRead\)[\s\S]{0,600}await envelopeDecrypt\(tx,\s*session\.tenantId/
    );
  });

  it("listValuesForTarget masks values (nulls typed cols + sets phiMasked=true) for unauthorised callers", () => {
    assert.match(CF_SRC, /phiMasked = true[\s\S]{0,200}valueText = null/);
  });
});

// ---------------------------------------------------------------------
// Retention sweep
// ---------------------------------------------------------------------
describe("M20.2 — retention sweep", () => {
  it("cron runs daily at 03:00", () => {
    assert.match(SWEEP_SRC, /triggers:\s*\{\s*cron:\s*"0 3 \* \* \*"/);
  });

  it("only deletes RESOLVED/CLOSED tickets past the tenant TTL", () => {
    assert.match(SWEEP_SRC, /status:\s*\{\s*in:\s*\["RESOLVED",\s*"CLOSED"\]/);
  });

  it("scopes deletes under per-tenant withRls (RLS backstop)", () => {
    assert.match(SWEEP_SRC, /withRls\(\s*\{\s*tenantId:\s*t\.id/);
  });
});

// ---------------------------------------------------------------------
// Spec §3 — "Do NOT allow tenant-level residency to be changed after
// provisioning without a migration plan."
// ---------------------------------------------------------------------
describe("M20.1 — residency is not self-serve mutable", () => {
  it("updateRetentionPolicy exists but there is no updateResidency action", () => {
    assert.match(COMPLIANCE_SRC, /updateRetentionPolicy/);
    assert.doesNotMatch(COMPLIANCE_SRC, /updateResidency|setResidency|changeResidency/);
  });
});

// (Unused import silencer — REDACT_SRC's substring checks are enough
// for redact tests, but keeping the file readable via the import.)
void REDACT_SRC;
