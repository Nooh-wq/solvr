// src/actions/m15-employee-service.test.ts
//
// M15 pinning tests.

process.env.SESSION_SECRET = "test-secret-at-least-32-characters-long-please";
process.env.MFA_SECRET_KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { labelsFor, label, normalizeMode } from "@/lib/service-mode/labels";

const SCHEMA_SRC = readFileSync("prisma/schema.prisma", "utf8");
const RLS_SRC = readFileSync("prisma/rls_policies.sql", "utf8");
const SERVICE_MODE_SRC = readFileSync("src/actions/serviceMode.ts", "utf8");
const CATALOG_SRC = readFileSync("src/actions/serviceCatalog.ts", "utf8");
const APPROVAL_SRC = readFileSync("src/actions/approvalRequests.ts", "utf8");
const ASSETS_SRC = readFileSync("src/actions/assets.ts", "utf8");
const CRON_SRC = readFileSync("src/lib/inngest/functions/expire-approvals.ts", "utf8");
const INNGEST_ROUTE_SRC = readFileSync("src/app/api/inngest/route.ts", "utf8");
const SIGNUP_SRC = readFileSync("src/actions/signup.ts", "utf8");
const SIGNUP_VALIDATION_SRC = readFileSync("src/lib/validation/signup.ts", "utf8");
const SIGNUP_FORM_SRC = readFileSync("src/app/(auth)/auth/signup/signup-form.tsx", "utf8");
const MW_SRC = readFileSync("src/middleware.ts", "utf8");
const PORTAL_HOME_SRC = readFileSync("src/app/(client)/portal/page.tsx", "utf8");

// ---------------------------------------------------------------------
// Labels library
// ---------------------------------------------------------------------
describe("M15.1 — labels", () => {
  it("labelsFor swaps ticket/customer/category in EMPLOYEE mode", () => {
    const L = labelsFor("EMPLOYEE");
    assert.equal(L.ticket, "Request");
    assert.equal(L.customer, "Employee");
    assert.equal(L.category, "Service catalog");
  });

  it("labelsFor keeps classic terminology in CUSTOMER mode", () => {
    const L = labelsFor("CUSTOMER");
    assert.equal(L.ticket, "Ticket");
    assert.equal(L.customer, "Customer");
  });

  it("label() defaults unknown modes to CUSTOMER (safe fallback)", () => {
    assert.equal(label("garbage", "ticket"), "Ticket");
    assert.equal(label(null, "ticket"), "Ticket");
    assert.equal(label(undefined, "ticket"), "Ticket");
  });

  it("normalizeMode collapses unknown strings to CUSTOMER", () => {
    assert.equal(normalizeMode("EMPLOYEE"), "EMPLOYEE");
    assert.equal(normalizeMode("customer"), "CUSTOMER");
    assert.equal(normalizeMode(""), "CUSTOMER");
    assert.equal(normalizeMode(null), "CUSTOMER");
  });
});

// ---------------------------------------------------------------------
// Schema + RLS pins
// ---------------------------------------------------------------------
describe("M15 — schema + RLS", () => {
  it("Tenant carries serviceMode column defaulting to CUSTOMER", () => {
    assert.match(SCHEMA_SRC, /serviceMode\s+String\s+@default\("CUSTOMER"\)/);
  });

  it("all four M15 tables are RLS-enabled", () => {
    for (const t of ["service_catalog_items", "approval_requests", "assets", "asset_links"]) {
      assert.match(RLS_SRC, new RegExp(`'${t}'`));
      assert.match(RLS_SRC, new RegExp(`tenant_isolation on ${t}`));
    }
  });

  it("ApprovalRequest has (tenantId, ticketId) unique — one active approval per ticket", () => {
    assert.match(SCHEMA_SRC, /model ApprovalRequest[\s\S]*?@@unique\(\[tenantId,\s*ticketId\]\)/);
  });

  it("ServiceCatalogItem name is unique per tenant", () => {
    assert.match(SCHEMA_SRC, /model ServiceCatalogItem[\s\S]*?@@unique\(\[tenantId,\s*name\]\)/);
  });

  it("Asset tag is unique per tenant", () => {
    assert.match(SCHEMA_SRC, /model Asset[\s\S]*?@@unique\(\[tenantId,\s*assetTag\]\)/);
  });
});

// ---------------------------------------------------------------------
// Service Mode action gate
// ---------------------------------------------------------------------
describe("M15.1 — action gates", () => {
  it("setTenantServiceMode requires ADMIN+", () => {
    assert.match(SERVICE_MODE_SRC, /setTenantServiceMode[\s\S]*?requireSession\(\{\s*minRole:\s*"ADMIN"\s*\}\)/);
  });
});

// ---------------------------------------------------------------------
// Service Catalog invariants
// ---------------------------------------------------------------------
describe("M15.2 — catalog invariants", () => {
  it("upsertCatalogItem rejects non-TICKET/USER scope custom fields", () => {
    assert.match(CATALOG_SRC, /is not TICKET\/USER scope/);
  });

  it("submitCatalogRequest sets ticket status PENDING when approval required, OPEN otherwise", () => {
    assert.match(CATALOG_SRC, /status:\s*item\.requiresApproval\s*\?\s*"PENDING"\s*:\s*"OPEN"/);
  });

  it("submitCatalogRequest files an ApprovalRequest when catalog item requires it", () => {
    assert.match(CATALOG_SRC, /item\.requiresApproval[\s\S]{0,400}approvalRequest\.create\(/);
  });

  it("submitCatalogRequest source = service_catalog (audit trail)", () => {
    assert.match(CATALOG_SRC, /source:\s*"service_catalog"/);
  });
});

// ---------------------------------------------------------------------
// Approval flow
// ---------------------------------------------------------------------
describe("M15.3 — approval flow", () => {
  it("approve/reject actions gate 'Not your turn' when caller isn't the current-step approver", () => {
    assert.match(APPROVAL_SRC, /Not your turn/);
  });

  it("reject terminates immediately; approve either advances or finalizes", () => {
    assert.match(APPROVAL_SRC, /decision === "REJECTED"[\s\S]{0,200}"REJECTED"/);
    assert.match(APPROVAL_SRC, /isFinalStep[\s\S]{0,300}"APPROVED"/);
  });

  it("APPROVED-final unlocks ticket (PENDING → OPEN); REJECTED closes it", () => {
    assert.match(APPROVAL_SRC, /nextStatus === "APPROVED"[\s\S]{0,300}status:\s*"OPEN"/);
    assert.match(APPROVAL_SRC, /nextStatus === "REJECTED"[\s\S]{0,300}status:\s*"CLOSED"/);
  });

  it("cron expiration flips PENDING → EXPIRED with an AuditLog row per approval (spec §3 no silent expiry)", () => {
    assert.match(APPROVAL_SRC, /status:\s*"EXPIRED"/);
    assert.match(APPROVAL_SRC, /action:\s*"APPROVAL_EXPIRED"/);
    assert.match(CRON_SRC, /expireStaleApprovals/);
    assert.match(INNGEST_ROUTE_SRC, /expireApprovals/);
  });
});

// ---------------------------------------------------------------------
// Asset invariants
// ---------------------------------------------------------------------
describe("M15.4 — asset invariants", () => {
  it("upsertAsset enforces dual-FK: at most one assignee", () => {
    assert.match(ASSETS_SRC, /at most one subject/);
  });

  it("ASSIGNED requires an assignee; non-ASSIGNED rejects one", () => {
    assert.match(ASSETS_SRC, /Assigned assets must have an assignee/);
    assert.match(ASSETS_SRC, /Only ASSIGNED assets can carry an assignee/);
  });

  it("asset linking is gated on AGENT+", () => {
    assert.match(ASSETS_SRC, /linkAssetToTicket[\s\S]{0,400}requireSession\(\{\s*minRole:\s*"AGENT"\s*\}\)/);
  });
});

// ---------------------------------------------------------------------
// M15.5 portal reorg
// ---------------------------------------------------------------------
describe("M15.5 — portal reorg", () => {
  it("portal home wires getTenantServiceMode + labelsFor", () => {
    assert.match(PORTAL_HOME_SRC, /getTenantServiceMode/);
    assert.match(PORTAL_HOME_SRC, /labelsFor/);
  });

  it("portal home shows catalog cards only in EMPLOYEE mode", () => {
    assert.match(PORTAL_HOME_SRC, /isEmployee && catalog\.length > 0/);
  });

  it("portal 'new' CTA routes to /portal/catalog in EMPLOYEE mode", () => {
    assert.match(PORTAL_HOME_SRC, /isEmployee \? "\/portal\/catalog" : "\/portal\/new"/);
  });
});

// ---------------------------------------------------------------------
// M15.6 signup path
// ---------------------------------------------------------------------
describe("M15.6 — signup path", () => {
  it("signup schema accepts serviceMode = CUSTOMER | EMPLOYEE with CUSTOMER default", () => {
    assert.match(SIGNUP_VALIDATION_SRC, /serviceMode:\s*z\.enum\(\["CUSTOMER",\s*"EMPLOYEE"\]\)/);
  });

  it("startTenantSignup carries serviceMode into the signed OTP payload", () => {
    assert.match(SIGNUP_SRC, /serviceMode:\s*data\.serviceMode/);
  });

  it("verifyTenantSignup creates tenant with the requested mode (or CUSTOMER fallback)", () => {
    assert.match(SIGNUP_SRC, /serviceMode:\s*requestedMode/);
  });

  it("signup form reads ?mode=employee and passes it to startTenantSignup", () => {
    assert.match(SIGNUP_FORM_SRC, /searchParams\.get\("mode"\) === "employee"/);
    assert.match(SIGNUP_FORM_SRC, /serviceMode:\s*requestedMode/);
  });

  it("marketing landing at /employee-service is a public route", () => {
    assert.match(MW_SRC, /"\/employee-service"/);
  });
});
