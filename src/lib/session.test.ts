// src/lib/session.test.ts
//
// Runs with:  node --import tsx --test src/lib/session.test.ts
//
// Post-B6.1 Support/session-adapter tests. Two things worth testing at
// this layer:
//
//   1. Support's purpose-token wrappers preserve the same on-the-wire
//      shape as pre-B6.1. Spot-check with `signCsatToken` + core
//      `verifyPurposeToken("csat", …)` round-trip — proves the wrapper
//      shells out correctly.
//
//   2. `_verifyImpersonationTokenGrace` (§7.17) accepts BOTH legacy
//      (no-purpose) AND post-B6.1 (purpose="impersonation") tokens.
//      The Support-internal helper is exposed with an underscore prefix
//      and @internal tag specifically so this test can exercise it
//      without mocking next/headers's non-configurable cookies() export.
//
// Cookie-write tests would need next/headers's cookies() which is only
// callable inside a Server Action context — those live in the
// integration surface, not here.

process.env.SESSION_SECRET = "test-secret-at-least-32-characters-long-please";

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SignJWT } from "jose";
import {
  _verifyImpersonationTokenGrace,
  signCsatToken,
  signPasswordResetToken,
  verifyCsatToken,
  verifyPasswordResetToken,
} from "./session";
import { verifyPurposeToken, signPurposeToken } from "@/core/auth/tokens";
import { getSecret } from "@/core/auth/secret";

// -----------------------------------------------------------------
// A-category thin-wrapper round-trips
// -----------------------------------------------------------------
describe("Support wrapper: purpose-token round-trip through core", () => {
  it("signCsatToken emits a token core's verifyPurposeToken accepts", async () => {
    const t = await signCsatToken({ ticketId: "t-1", tenantId: "tenant-1" });
    const decoded = await verifyPurposeToken(t, "csat");
    assert.ok(decoded);
    assert.equal(decoded.ticketId, "t-1");
    assert.equal(decoded.tenantId, "tenant-1");
  });

  it("Support's verifyCsatToken accepts a token core's signPurposeToken emitted", async () => {
    const t = await signPurposeToken("csat", {
      ticketId: "t-2",
      tenantId: "tenant-1",
    });
    const decoded = await verifyCsatToken(t);
    assert.ok(decoded);
    assert.equal(decoded.ticketId, "t-2");
  });

  it("signPasswordResetToken round-trip", async () => {
    const t = await signPasswordResetToken({
      userId: "u-1",
      tenantId: "tenant-1",
    });
    const decoded = await verifyPasswordResetToken(t);
    assert.ok(decoded);
    assert.equal(decoded.userId, "u-1");
  });
});

// -----------------------------------------------------------------
// Grace-period impersonation verify — §7.17
// -----------------------------------------------------------------
describe("_verifyImpersonationTokenGrace — §7.17 grace period", () => {
  it("accepts a legacy (no-purpose) token — the reason the grace exists", async () => {
    // Sign a token the pre-B6.1 way: no purpose claim at all.
    const legacy = await new SignJWT({
      impersonatorUserId: "sa-1",
      targetTenantId: "tenant-2",
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(getSecret());

    const decoded = await _verifyImpersonationTokenGrace(legacy);
    assert.ok(decoded, "legacy no-purpose token must verify during grace period");
    assert.equal(decoded.impersonatorUserId, "sa-1");
    assert.equal(decoded.targetTenantId, "tenant-2");
  });

  it("accepts a post-B6.1 (purpose='impersonation') token", async () => {
    const modern = await signPurposeToken("impersonation", {
      impersonatorUserId: "sa-2",
      targetTenantId: "tenant-3",
    });
    const decoded = await _verifyImpersonationTokenGrace(modern);
    assert.ok(decoded);
    assert.equal(decoded.impersonatorUserId, "sa-2");
    assert.equal(decoded.targetTenantId, "tenant-3");
  });

  it("rejects a token with a WRONG purpose (cross-purpose confusion still blocked)", async () => {
    // The grace period loosens ONLY undefined-vs-impersonation. A
    // token carrying a different purpose (say, a password-reset link
    // pasted as an impersonation cookie) must still be rejected.
    const wrongPurpose = await signPurposeToken("password-reset", {
      userId: "u-1",
      tenantId: "tenant-1",
    });
    const decoded = await _verifyImpersonationTokenGrace(wrongPurpose);
    assert.equal(decoded, null);
  });

  it("rejects an alg:none-forged token — alg allow-list stays strict", async () => {
    const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString(
      "base64url"
    );
    const body = Buffer.from(
      JSON.stringify({
        impersonatorUserId: "attacker",
        targetTenantId: "tenant-1",
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
      })
    ).toString("base64url");
    const forged = `${header}.${body}.`;
    const decoded = await _verifyImpersonationTokenGrace(forged);
    assert.equal(decoded, null);
  });

  it("rejects an expired legacy token", async () => {
    const expired = await new SignJWT({
      impersonatorUserId: "sa-1",
      targetTenantId: "tenant-1",
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt(Math.floor(Date.now() / 1000) - 3600)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      .sign(getSecret());
    const decoded = await _verifyImpersonationTokenGrace(expired);
    assert.equal(decoded, null);
  });

  it("rejects a garbage token", async () => {
    const decoded = await _verifyImpersonationTokenGrace("not.a.jwt");
    assert.equal(decoded, null);
  });
});
