// src/core/auth/tokens.test.ts
//
// Runs with:  node --import tsx --test src/core/auth/tokens.test.ts
//
// SESSION_SECRET is set below at module load — before importing
// ./tokens.js. getSecret() reads process.env lazily inside sign/verify,
// so this ordering is what makes the whole suite hermetic.

// Set BEFORE the imports below.
process.env.SESSION_SECRET = "test-secret-at-least-32-characters-long-please";

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SignJWT } from "jose";
import {
  PURPOSE_TTL_SECONDS,
  signPurposeToken,
  signSessionToken,
  verifyPurposeToken,
  verifySessionToken,
} from "./tokens";
import type { SessionPayload } from "./types";
import { getSecret } from "./secret";

const FIXED_SESSION: SessionPayload = {
  subjectId: "tm-1",
  subjectKind: "TEAM_MEMBER",
  tenantId: "tenant-1",
  sessionId: "sess-abc",
};

// -----------------------------------------------------------------------
// Session round-trip
// -----------------------------------------------------------------------
describe("signSessionToken + verifySessionToken — round-trip", () => {
  it("verifies a freshly signed session and returns the same subject/tenant/session", async () => {
    const token = await signSessionToken(FIXED_SESSION);
    const decoded = await verifySessionToken(token);
    assert.ok(decoded, "expected a decoded payload");
    assert.equal(decoded.subjectId, "tm-1");
    assert.equal(decoded.subjectKind, "TEAM_MEMBER");
    assert.equal(decoded.tenantId, "tenant-1");
    assert.equal(decoded.sessionId, "sess-abc");
    assert.equal(typeof decoded.iat, "number");
  });

  it("verifies an END_USER session round-trip", async () => {
    const token = await signSessionToken({
      subjectId: "eu-9",
      subjectKind: "END_USER",
      tenantId: "tenant-2",
      sessionId: "sess-xyz",
    });
    const decoded = await verifySessionToken(token);
    assert.equal(decoded?.subjectKind, "END_USER");
    assert.equal(decoded?.subjectId, "eu-9");
  });
});

// -----------------------------------------------------------------------
// Purpose round-trips — variety across 3 purposes
// -----------------------------------------------------------------------
describe("signPurposeToken + verifyPurposeToken — round-trip across 3 purposes", () => {
  it("csat round-trip", async () => {
    const token = await signPurposeToken("csat", {
      ticketId: "t-1",
      tenantId: "tenant-1",
    });
    const decoded = await verifyPurposeToken(token, "csat");
    assert.ok(decoded);
    assert.equal(decoded.ticketId, "t-1");
    assert.equal(decoded.tenantId, "tenant-1");
  });

  it("password-reset round-trip", async () => {
    const token = await signPurposeToken("password-reset", {
      userId: "u-1",
      tenantId: "tenant-1",
    });
    const decoded = await verifyPurposeToken(token, "password-reset");
    assert.ok(decoded);
    assert.equal(decoded.userId, "u-1");
    assert.equal(decoded.tenantId, "tenant-1");
    assert.equal(typeof decoded.iat, "number");
  });

  it("tenant-signup round-trip preserves every payload field", async () => {
    const token = await signPurposeToken("tenant-signup", {
      tenantName: "Acme",
      slug: "acme",
      adminName: "Alice",
      adminEmail: "alice@acme.test",
      passwordHash: "$2a$10$dummy",
      codeHash: "$2a$10$dummy2",
    });
    const decoded = await verifyPurposeToken(token, "tenant-signup");
    assert.ok(decoded);
    assert.equal(decoded.tenantName, "Acme");
    assert.equal(decoded.slug, "acme");
    assert.equal(decoded.adminName, "Alice");
    assert.equal(decoded.adminEmail, "alice@acme.test");
    assert.equal(decoded.passwordHash, "$2a$10$dummy");
    assert.equal(decoded.codeHash, "$2a$10$dummy2");
  });
});

// -----------------------------------------------------------------------
// Algorithm-confusion guard
// -----------------------------------------------------------------------
describe("verifier hardening — alg-confusion guard", () => {
  it("rejects a well-formed but alg:none-forged session token", async () => {
    // Forge a JWT with alg:"none" — the classic pre-hardening attack:
    // a naive verifier that trusts the header ends up accepting the
    // token because "none" means "no signature required". jose's
    // algorithms:["HS256"] allow-list is what closes this.
    const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString(
      "base64url"
    );
    const body = Buffer.from(
      JSON.stringify({
        subjectId: "attacker",
        subjectKind: "TEAM_MEMBER",
        tenantId: "tenant-1",
        sessionId: "forged",
        purpose: "session",
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
      })
    ).toString("base64url");
    const forged = `${header}.${body}.`; // empty signature

    const decoded = await verifySessionToken(forged);
    assert.equal(decoded, null, "alg:none forgery must not verify");
  });

  it("rejects a well-formed but alg:none-forged purpose token", async () => {
    const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString(
      "base64url"
    );
    const body = Buffer.from(
      JSON.stringify({
        ticketId: "t-forged",
        tenantId: "tenant-1",
        purpose: "csat",
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
      })
    ).toString("base64url");
    const forged = `${header}.${body}.`;

    const decoded = await verifyPurposeToken(forged, "csat");
    assert.equal(decoded, null, "alg:none forgery must not verify");
  });
});

// -----------------------------------------------------------------------
// Cross-purpose confusion guard
// -----------------------------------------------------------------------
describe("verifier hardening — cross-purpose confusion guard", () => {
  it("a password-reset token verified against expectedPurpose:'session' returns null", async () => {
    const token = await signPurposeToken("password-reset", {
      userId: "u-1",
      tenantId: "tenant-1",
    });
    // Try to pass a reset-link token to the session verifier — the
    // purpose gate in verifySessionToken must reject it. Historic
    // attack: an attacker who leaked a reset link pastes it in as a
    // session cookie and gets logged in as the token subject.
    const asSession = await verifySessionToken(token);
    assert.equal(asSession, null);
  });

  it("a csat token verified against expectedPurpose:'invite' returns null", async () => {
    const token = await signPurposeToken("csat", {
      ticketId: "t-1",
      tenantId: "tenant-1",
    });
    const asInvite = await verifyPurposeToken(token, "invite");
    assert.equal(asInvite, null);
  });

  it("a session cookie posted to verifyPurposeToken returns null (no purpose match)", async () => {
    const token = await signSessionToken(FIXED_SESSION);
    // Sessions do have purpose:"session" so verifyPurposeToken(_, "session")
    // would ACCEPT it — that's expected symmetry. But verifying against
    // any other purpose must reject.
    const asCsat = await verifyPurposeToken(token, "csat");
    assert.equal(asCsat, null);
  });
});

// -----------------------------------------------------------------------
// Grace-period dual-shape decode (Z1.8a legacy cookies)
// -----------------------------------------------------------------------
describe("verifySessionToken — Z1.8a grace-period dual-shape decode (through 2026-07-14)", () => {
  it("old-shape {userId, tenantId} cookie verifies with undefined subjectKind + sessionId", async () => {
    // Build an old-shape cookie the way the pre-Set-B code did — no
    // subjectId/subjectKind/sessionId/purpose. Sign with the real
    // secret so the signature verifies; the dual-shape decode is
    // what we're testing, not the crypto.
    const legacy = await new SignJWT({
      userId: "legacy-user-1",
      tenantId: "tenant-1",
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("7d")
      .sign(getSecret());

    const decoded = await verifySessionToken(legacy);
    assert.ok(decoded, "old-shape cookie must decode during grace window");
    assert.equal(decoded.subjectId, "legacy-user-1");
    assert.equal(decoded.subjectKind, undefined);
    assert.equal(decoded.sessionId, undefined);
    assert.equal(decoded.tenantId, "tenant-1");
  });
});

// -----------------------------------------------------------------------
// Expired token returns null (never throws)
// -----------------------------------------------------------------------
describe("verifier hardening — expired token", () => {
  it("verifySessionToken returns null for an expired session, does not throw", async () => {
    // Sign with a negative TTL via jose's absolute-time overload.
    const expired = await new SignJWT({
      subjectId: "tm-1",
      subjectKind: "TEAM_MEMBER",
      tenantId: "tenant-1",
      sessionId: "sess-1",
      purpose: "session",
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt(Math.floor(Date.now() / 1000) - 3600)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 60) // 1 min ago
      .sign(getSecret());

    const decoded = await verifySessionToken(expired);
    assert.equal(decoded, null);
  });

  it("verifyPurposeToken returns null for an expired purpose token, does not throw", async () => {
    const expired = await signPurposeToken(
      "csat",
      { ticketId: "t-1", tenantId: "tenant-1" },
      { ttlSeconds: 1 }
    );
    // Wait past expiry. 1500ms > 1s TTL.
    await new Promise((r) => setTimeout(r, 1500));
    const decoded = await verifyPurposeToken(expired, "csat");
    assert.equal(decoded, null);
  });
});

// -----------------------------------------------------------------------
// Malformed token returns null (never throws)
// -----------------------------------------------------------------------
describe("verifier hardening — malformed input", () => {
  it("verifySessionToken returns null for garbage input, does not throw", async () => {
    for (const bad of ["", "not.a.jwt", "aaa.bbb.ccc", "onlyonesegment"]) {
      const decoded = await verifySessionToken(bad);
      assert.equal(decoded, null, `expected null for input: ${bad}`);
    }
  });

  it("verifyPurposeToken returns null for garbage input, does not throw", async () => {
    for (const bad of ["", "not.a.jwt", "aaa.bbb.ccc"]) {
      const decoded = await verifyPurposeToken(bad, "csat");
      assert.equal(decoded, null, `expected null for input: ${bad}`);
    }
  });

  it("verifySessionToken returns null for a token signed with a different secret", async () => {
    // Sign with the wrong secret bytes — signature verification fails.
    const wrongSecret = new TextEncoder().encode(
      "a-different-secret-of-sufficient-length-for-hs256"
    );
    const forged = await new SignJWT({
      subjectId: "attacker",
      subjectKind: "TEAM_MEMBER",
      tenantId: "tenant-1",
      sessionId: "sess-1",
      purpose: "session",
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("7d")
      .sign(wrongSecret);

    const decoded = await verifySessionToken(forged);
    assert.equal(decoded, null);
  });
});

// -----------------------------------------------------------------------
// PURPOSE_TTL_SECONDS spot-checks
// -----------------------------------------------------------------------
describe("PURPOSE_TTL_SECONDS canonical durations", () => {
  it("session is 7 days, impersonation is 1 hour, csat is 30 days", () => {
    assert.equal(PURPOSE_TTL_SECONDS.session, 60 * 60 * 24 * 7);
    assert.equal(PURPOSE_TTL_SECONDS.impersonation, 60 * 60);
    assert.equal(PURPOSE_TTL_SECONDS.csat, 60 * 60 * 24 * 30);
  });

  it("covers every declared TokenPurpose exhaustively", () => {
    // If a purpose is added to TokenPurpose without a TTL entry, the
    // Readonly<Record<TokenPurpose, number>> declaration is a type
    // error at build time. This test is the runtime backstop.
    const purposes = Object.keys(PURPOSE_TTL_SECONDS);
    // M6.1 added "mfa-challenge" (11th); M6.1.b added "mfa-enrollment"
    // (12th); Z10.3 added "org_analytics_share" (13th).
    assert.equal(purposes.length, 13);
  });
});
