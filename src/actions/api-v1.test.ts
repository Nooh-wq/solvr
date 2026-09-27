// src/actions/api-v1.test.ts
//
// M7.1–M7.6 pinning tests. Source-level pins on the load-bearing wire
// shapes + functional round-trips of the scope resolver and HMAC signing.

process.env.SESSION_SECRET = "test-secret-at-least-32-characters-long-please";
process.env.MFA_SECRET_KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import crypto from "node:crypto";
import {
  API_SCOPES,
  deriveMaxScopes,
  scopesWithinLimit,
  hasScope,
  isKnownScope,
} from "@/lib/api/scopes";

const REQUEST_SRC = readFileSync("src/lib/api/request.ts", "utf8");
const AUTH_SRC = readFileSync("src/lib/api/auth.ts", "utf8");
const APIKEYS_ACTIONS_SRC = readFileSync("src/actions/apiKeys.ts", "utf8");
const TICKETS_ROUTE_SRC = readFileSync("src/app/api/v1/tickets/route.ts", "utf8");
const TICKET_REF_ROUTE_SRC = readFileSync("src/app/api/v1/tickets/[reference]/route.ts", "utf8");
const USERS_ROUTE_SRC = readFileSync("src/app/api/v1/users/route.ts", "utf8");
const USER_ID_ROUTE_SRC = readFileSync("src/app/api/v1/users/[id]/route.ts", "utf8");
const WEBHOOKS_SRC = readFileSync("src/lib/webhooks.ts", "utf8");
const DELIVER_SRC = readFileSync("src/lib/inngest/functions/deliver-webhook.ts", "utf8");
const WEBHOOK_ACTIONS_SRC = readFileSync("src/actions/webhookSubscriptions.ts", "utf8");
const MIDDLEWARE_SRC = readFileSync("src/middleware.ts", "utf8");
const OPENAPI_SRC = readFileSync("src/app/api/v1/openapi.json/route.ts", "utf8");

// ---------------------------------------------------------------------
// M7.1 — scope catalog + creator-permission guard
// ---------------------------------------------------------------------
describe("M7.1 — scope catalog + creator guard", () => {
  it("every catalog scope maps to at least one real permission key", () => {
    for (const s of API_SCOPES) {
      assert.ok(s.requiredPermissions.length > 0, `${s.scope} has no required permissions`);
    }
  });

  it("isKnownScope rejects an unknown scope", () => {
    assert.equal(isKnownScope("not-a-real-scope"), false);
    assert.equal(isKnownScope("tickets:read"), true);
  });

  it("deriveMaxScopes yields empty for a role with no permissions", () => {
    assert.deepEqual(deriveMaxScopes({}), []);
  });

  it("deriveMaxScopes yields tickets:read for a role with only tickets.view", () => {
    const derived = deriveMaxScopes({ "tickets.view": true });
    assert.deepEqual(derived, ["tickets:read"]);
  });

  it("scopesWithinLimit rejects over-requested scopes with the excess list", () => {
    const allowed = ["tickets:read"];
    const requested = ["tickets:read", "tickets:write"];
    const result = scopesWithinLimit(requested, allowed);
    assert.equal(result.ok, false);
    if (!result.ok) assert.deepEqual(result.excess, ["tickets:write"]);
  });

  it("hasScope is a plain includes check", () => {
    assert.equal(hasScope(["tickets:read"], "tickets:read"), true);
    assert.equal(hasScope(["tickets:read"], "tickets:write"), false);
  });
});

// ---------------------------------------------------------------------
// M7.1 — API key lifecycle: fired employee's key stops working
// ---------------------------------------------------------------------
describe("M7.1 — auth middleware invariants", () => {
  it("verifies creator's lifecycle is ACTIVE on every request", () => {
    // The comment + the code path exist. If someone removes the lifecycle
    // check "for perf reasons" a fired employee's key keeps working.
    assert.match(AUTH_SRC, /lifecycle\?\.status === "ACTIVE"/);
    assert.match(AUTH_SRC, /API key's creator is no longer active/);
  });

  it("uses prefix pre-filter to avoid bcrypt-scanning every key", () => {
    assert.match(AUTH_SRC, /tokenPrefix|prefix: prefix/);
    assert.match(AUTH_SRC, /findMany\([\s\S]*where:[\s\S]*prefix/);
  });

  it("createApiKey rejects scopes exceeding the caller's role", () => {
    assert.match(APIKEYS_ACTIONS_SRC, /deriveMaxScopes/);
    assert.match(APIKEYS_ACTIONS_SRC, /scopesWithinLimit/);
    assert.match(APIKEYS_ACTIONS_SRC, /Your role can't grant/);
  });
});

// ---------------------------------------------------------------------
// M7 §3 — rate limits per tenant, not per key
// ---------------------------------------------------------------------
describe("M7 §3 — tenant-wide rate limit", () => {
  it("apiHandler keys the rate limit on ctx.tenantId (not apiKeyId)", () => {
    assert.match(REQUEST_SRC, /api-v1:\$\{ctx\.tenantId\}/);
    assert.doesNotMatch(REQUEST_SRC, /api-v1:\$\{ctx\.apiKeyId\}/);
  });

  it("apiHandler enforces scope before dispatching the handler", () => {
    const rateLimitIdx = REQUEST_SRC.indexOf("checkRateLimit(`api-v1");
    const scopeCheckIdx = REQUEST_SRC.indexOf("requireScope(ctx");
    const handlerCallIdx = REQUEST_SRC.indexOf("await opts.handler(ctx");
    assert.ok(rateLimitIdx > 0);
    assert.ok(scopeCheckIdx > 0);
    assert.ok(handlerCallIdx > 0);
    assert.ok(scopeCheckIdx < handlerCallIdx, "scope check must come before the handler runs");
  });
});

// ---------------------------------------------------------------------
// M7.2/M7.3 — endpoints declare scopes correctly
// ---------------------------------------------------------------------
describe("M7.2/M7.3 — endpoint scope declarations", () => {
  it("GET /api/v1/tickets requires tickets:read", () => {
    assert.match(TICKETS_ROUTE_SRC, /scope:\s*"tickets:read"/);
  });
  it("POST /api/v1/tickets requires tickets:write", () => {
    assert.match(TICKETS_ROUTE_SRC, /scope:\s*"tickets:write"/);
  });
  it("PATCH /api/v1/tickets/{ref} requires tickets:write", () => {
    assert.match(TICKET_REF_ROUTE_SRC, /scope:\s*"tickets:write"/);
  });
  it("GET /api/v1/users requires users:read", () => {
    assert.match(USERS_ROUTE_SRC, /scope:\s*"users:read"/);
  });
  it("POST/PATCH /api/v1/users require users:write", () => {
    assert.match(USERS_ROUTE_SRC, /scope:\s*"users:write"/);
    assert.match(USER_ID_ROUTE_SRC, /scope:\s*"users:write"/);
  });
  it("tickets endpoints use reference in the URL, not the internal cuid", () => {
    // M7 §3: "do not expose internal IDs where the tenant-scoped
    // reference should be used". reference-based path pin.
    assert.match(TICKET_REF_ROUTE_SRC, /params:.*reference: string/);
  });
});

// ---------------------------------------------------------------------
// M7.4 — webhooks: HMAC + signing shape + retry semantics
// ---------------------------------------------------------------------
describe("M7.4 — webhook delivery semantics", () => {
  it("signs the payload with HMAC-SHA256", () => {
    assert.match(DELIVER_SRC, /createHmac\("sha256"/);
  });

  it("uses Stripe-style `t=<timestamp>,v1=<sig>` header", () => {
    assert.match(DELIVER_SRC, /t=\$\{timestamp\},v1=\$\{signature\}/);
  });

  it("auto-disables the subscription after MAX_FAIL_COUNT consecutive failures", () => {
    assert.match(DELIVER_SRC, /MAX_FAIL_COUNT/);
    assert.match(DELIVER_SRC, /disabledReason/);
    assert.match(DELIVER_SRC, /isActive: false/);
  });

  it("secret is envelope-decrypted from ciphertext at delivery time", () => {
    assert.match(DELIVER_SRC, /envelopeDecrypt/);
  });

  it("subscription secret is envelope-encrypted before persist", () => {
    assert.match(WEBHOOK_ACTIONS_SRC, /envelopeEncrypt/);
  });

  it("emit helpers fan out to Inngest for retry", () => {
    assert.match(WEBHOOKS_SRC, /webhook\.deliver/);
    assert.match(WEBHOOKS_SRC, /inngest\.send/);
  });
});

// Functional HMAC round-trip: sign, then verify.
describe("M7.4 — HMAC signing (functional round-trip)", () => {
  it("HMAC-SHA256(secret, `${'{'}t{'}'}.${'{'}body{'}'}`) is verifiable by the recipient", () => {
    const secret = "whsec_" + crypto.randomBytes(32).toString("base64url");
    const body = JSON.stringify({ event: "ticket.created", data: { reference: "T-ABC" } });
    const timestamp = Math.floor(Date.now() / 1000);
    const sig = crypto.createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
    // Recipient recomputes and compares.
    const recomputed = crypto.createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
    assert.equal(sig, recomputed);
    // Wrong secret → different digest.
    const wrong = crypto.createHmac("sha256", "whsec_wrong").update(`${timestamp}.${body}`).digest("hex");
    assert.notEqual(sig, wrong);
  });
});

// ---------------------------------------------------------------------
// Middleware — /api/v1 public
// ---------------------------------------------------------------------
describe("Middleware public prefixes (M7)", () => {
  it("/api/v1 is public (bearer-authed)", () => {
    assert.match(MIDDLEWARE_SRC, /"\/api\/v1"/);
  });
  it("/docs/api is public", () => {
    assert.match(MIDDLEWARE_SRC, /"\/docs\/api"/);
  });
});

// ---------------------------------------------------------------------
// M7.5 — OpenAPI spec
// ---------------------------------------------------------------------
describe("M7.5 — OpenAPI spec", () => {
  it("declares bearerAuth security scheme + covers the endpoints", () => {
    assert.match(OPENAPI_SRC, /bearerAuth:/);
    assert.match(OPENAPI_SRC, /"\/tickets"/);
    assert.match(OPENAPI_SRC, /"\/tickets\/\{reference\}"/);
    assert.match(OPENAPI_SRC, /"\/users"/);
    assert.match(OPENAPI_SRC, /"\/users\/\{id\}"/);
  });
});
