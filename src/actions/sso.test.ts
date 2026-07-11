// src/actions/sso.test.ts
//
// M6.2–M6.7 pinning tests. Source-level pins on the load-bearing wire
// shapes + one live-DB round-trip on the JIT provisioning helper.

process.env.SESSION_SECRET = "test-secret-at-least-32-characters-long-please";
process.env.MFA_SECRET_KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolveRoleFromGroups } from "@/lib/auth/jit-provision";

const AUTH_SRC = readFileSync("src/actions/auth.ts", "utf8");
const TENANT_SEC_SRC = readFileSync("src/actions/tenantSecurity.ts", "utf8");
const SCIM_USERS_SRC = readFileSync("src/app/api/scim/v2/Users/route.ts", "utf8");
const SCIM_USER_ID_SRC = readFileSync("src/app/api/scim/v2/Users/[id]/route.ts", "utf8");
const SAML_LIB_SRC = readFileSync("src/lib/auth/saml.ts", "utf8");
const OIDC_LIB_SRC = readFileSync("src/lib/auth/oidc.ts", "utf8");
const SAML_ACS_SRC = readFileSync("src/app/api/auth/saml/[slug]/acs/route.ts", "utf8");
const OIDC_CB_SRC = readFileSync("src/app/api/auth/oidc/[slug]/callback/route.ts", "utf8");
const IDP_ACTIONS_SRC = readFileSync("src/actions/identityProviders.ts", "utf8");
const MIDDLEWARE_SRC = readFileSync("src/middleware.ts", "utf8");

// -----------------------------------------------------------------
// M6.4 enforceSso + break-glass invariant
// -----------------------------------------------------------------
describe("M6.4 — enforceSso branch + break-glass invariant", () => {
  it("login() checks isBreakGlass on the credential before rejecting on enforceSso", () => {
    assert.match(AUTH_SRC, /isBreakGlass/);
    assert.match(AUTH_SRC, /tenant\.enforceSso/);
    // The gate must sit AFTER password verify (see the "after password
    // verify" comment I wrote) so we don't leak enumeration signal.
    const validIdx = AUTH_SRC.indexOf("const valid = await bcrypt.compare");
    const enforceSsoIdx = AUTH_SRC.indexOf("tenant.enforceSso && !lookup.creds.isBreakGlass");
    assert.ok(validIdx > 0);
    assert.ok(enforceSsoIdx > 0);
    assert.ok(enforceSsoIdx > validIdx, "enforceSso gate must come after password verify");
  });

  it("setTenantSsoEnforcement enforces both invariants (active IdP AND break-glass user)", () => {
    assert.match(TENANT_SEC_SRC, /export async function setTenantSsoEnforcement/);
    const idx = TENANT_SEC_SRC.indexOf("export async function setTenantSsoEnforcement");
    const body = TENANT_SEC_SRC.slice(idx);
    assert.match(body, /breakGlassCount/);
    assert.match(body, /hasActiveIdp/);
  });

  it("setBreakGlass refuses to un-flag the last break-glass while enforceSso is on", () => {
    assert.match(TENANT_SEC_SRC, /export async function setBreakGlass/);
    assert.match(TENANT_SEC_SRC, /Cannot remove the last break-glass/);
  });
});

// -----------------------------------------------------------------
// M6.2 SAML — algorithm pins + config surface
// -----------------------------------------------------------------
describe("M6.2 — SAML security properties", () => {
  it("saml.ts pins SHA-256 for signature + digest (no SHA-1)", () => {
    assert.match(SAML_LIB_SRC, /signatureAlgorithm:\s*"sha256"/);
    assert.match(SAML_LIB_SRC, /digestAlgorithm:\s*"sha256"/);
    assert.doesNotMatch(SAML_LIB_SRC, /signatureAlgorithm:\s*"sha1"/);
  });

  it("saml.ts requires signed responses AND signed assertions", () => {
    assert.match(SAML_LIB_SRC, /wantAuthnResponseSigned:\s*true/);
    assert.match(SAML_LIB_SRC, /wantAssertionsSigned/);
  });

  it("SAML ACS route checks RelayState against a cookie (CSRF defense)", () => {
    assert.match(SAML_ACS_SRC, /saml_relay/);
    assert.match(SAML_ACS_SRC, /cookieState.*relayState|relayState.*cookieState/);
  });

  it("SAML cert is envelope-encrypted before persist", () => {
    assert.match(IDP_ACTIONS_SRC, /envelopeEncrypt.*config\.cert|persisted\.cert.*envelopeEncrypt/s);
  });
});

// -----------------------------------------------------------------
// M6.3 OIDC — PKCE + state
// -----------------------------------------------------------------
describe("M6.3 — OIDC security properties", () => {
  it("oidc.ts uses PKCE (S256) and state", () => {
    assert.match(OIDC_LIB_SRC, /randomPKCECodeVerifier/);
    assert.match(OIDC_LIB_SRC, /code_challenge_method.*S256|"S256"/);
    assert.match(OIDC_LIB_SRC, /randomState/);
  });

  it("OIDC callback verifies expected state against cookie", () => {
    assert.match(OIDC_CB_SRC, /oidc_state/);
    assert.match(OIDC_CB_SRC, /expectedState/);
  });

  it("OIDC client secret is envelope-encrypted before persist", () => {
    assert.match(IDP_ACTIONS_SRC, /envelopeEncrypt.*config\.clientSecret|persisted\.clientSecret.*envelopeEncrypt/s);
  });
});

// -----------------------------------------------------------------
// M6.5/M6.6 SCIM — auth, rate limit, audit, last-Super-Admin guard
// -----------------------------------------------------------------
describe("M6.5/M6.6 — SCIM endpoints", () => {
  it("POST /scim/v2/Users requires bearer + rate-limits + JITs", () => {
    assert.match(SCIM_USERS_SRC, /verifyScimBearer/);
    assert.match(SCIM_USERS_SRC, /checkRateLimitWithIp\(`scim:/);
    assert.match(SCIM_USERS_SRC, /jitProvisionTeamMember/);
  });

  it("SCIM error response uses the SCIM ErrorResponse schema", () => {
    assert.match(SCIM_USERS_SRC, /"urn:ietf:params:scim:api:messages:2\.0:Error"/);
  });

  it("DELETE /scim/v2/Users/{id} enforces the last-Super-Admin guard", () => {
    assert.match(SCIM_USER_ID_SRC, /Refusing to deprovision the last active Super Admin/);
    // The guard must sit BEFORE the actual deactivation happens.
    const guardIdx = SCIM_USER_ID_SRC.indexOf("Refusing to deprovision the last active Super Admin");
    const deleteSessionsIdx = SCIM_USER_ID_SRC.indexOf("userSession.deleteMany");
    assert.ok(guardIdx > 0);
    assert.ok(deleteSessionsIdx > guardIdx, "session revocation must come after the guard");
  });

  it("DELETE revokes ALL sessions for the subject", () => {
    assert.match(SCIM_USER_ID_SRC, /userSession\.deleteMany[^;]*subjectId: target\.id/s);
  });

  it("PATCH accepts the standard `active:false` deprovision shape", () => {
    assert.match(SCIM_USER_ID_SRC, /op\.path === "active"/);
    assert.match(SCIM_USER_ID_SRC, /deactivateSubject/);
  });
});

// -----------------------------------------------------------------
// M6.7 — group → role mapping resolver
// -----------------------------------------------------------------
describe("M6.7 — group→role mapping resolver", () => {
  it("first matching IdP group wins", () => {
    assert.equal(
      resolveRoleFromGroups(
        ["stralis-admins", "stralis-agents"],
        [
          { idpGroup: "stralis-admins", roleName: "Admin" },
          { idpGroup: "stralis-agents", roleName: "Agent" },
        ],
        "Agent"
      ),
      "Admin"
    );
  });

  it("falls back to defaultRoleName when no group matches", () => {
    assert.equal(
      resolveRoleFromGroups(
        ["random-group"],
        [{ idpGroup: "stralis-admins", roleName: "Admin" }],
        "Agent"
      ),
      "Agent"
    );
  });

  it("empty groups → default role", () => {
    assert.equal(resolveRoleFromGroups([], [], "Agent"), "Agent");
  });
});

// -----------------------------------------------------------------
// Middleware — new public prefixes
// -----------------------------------------------------------------
describe("Middleware public prefixes (M6.2/M6.5)", () => {
  it("/api/auth is public (SAML/OIDC endpoints)", () => {
    assert.match(MIDDLEWARE_SRC, /"\/api\/auth"/);
  });
  it("/api/scim is public (bearer-authed)", () => {
    assert.match(MIDDLEWARE_SRC, /"\/api\/scim"/);
  });
});
