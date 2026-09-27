// src/core/auth/get-session.test.ts
//
// Runs with:  node --import tsx --test src/core/auth/get-session.test.ts

process.env.SESSION_SECRET = "test-secret-at-least-32-characters-long-please";

import { describe, it, mock, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  SESSION_JWT_HEADER,
  SESSION_VERIFIED_HEADER,
  getSessionContext,
} from "./get-session";
import { signSessionToken } from "./tokens";
import type { SessionPayload } from "./types";
import { SignJWT } from "jose";
import { getSecret } from "./secret";

const FIXTURE: SessionPayload = {
  subjectId: "tm-1",
  subjectKind: "TEAM_MEMBER",
  tenantId: "tenant-1",
  sessionId: "sess-1",
};

function makeReq(headers: Record<string, string>) {
  return { headers: new Headers(headers) };
}

// Capture warnings without spamming the test output.
let warnMock: ReturnType<typeof mock.method> | undefined;
beforeEach(() => {
  warnMock = mock.method(console, "warn", () => {});
});
afterEach(() => {
  warnMock?.mock.restore();
});

// -----------------------------------------------------------------
// Happy path: JWT + verified marker
// -----------------------------------------------------------------
describe("getSessionContext — JWT header + verified marker", () => {
  it("returns a SessionContext with role='' (unhydrated)", async () => {
    const jwt = await signSessionToken(FIXTURE);
    const req = makeReq({
      [SESSION_JWT_HEADER]: jwt,
      [SESSION_VERIFIED_HEADER]: "1",
    });
    const ctx = await getSessionContext(req);
    assert.ok(ctx);
    assert.equal(ctx.tenantId, "tenant-1");
    assert.equal(ctx.actor.id, "tm-1");
    assert.equal(ctx.actor.kind, "TEAM_MEMBER");
    assert.equal(ctx.role, "", "role must be unhydrated (empty string)");
    assert.equal(ctx.sessionId, "sess-1");
    assert.equal(warnMock?.mock.callCount(), 0, "no warning on happy path");
  });

  it("END_USER subjectKind maps to actor.kind='END_USER'", async () => {
    const jwt = await signSessionToken({
      subjectId: "eu-1",
      subjectKind: "END_USER",
      tenantId: "tenant-2",
      sessionId: "sess-2",
    });
    const ctx = await getSessionContext(
      makeReq({
        [SESSION_JWT_HEADER]: jwt,
        [SESSION_VERIFIED_HEADER]: "1",
      })
    );
    assert.equal(ctx?.actor.kind, "END_USER");
    assert.equal(ctx?.actor.id, "eu-1");
  });
});

// -----------------------------------------------------------------
// Attack-signal path: JWT header present, verified marker missing
// -----------------------------------------------------------------
describe("getSessionContext — JWT present but verified marker missing", () => {
  it("still returns SessionContext (JWT re-verified) but logs a warning", async () => {
    const jwt = await signSessionToken(FIXTURE);
    // Only the JWT header, no verification marker.
    const req = makeReq({ [SESSION_JWT_HEADER]: jwt });
    const ctx = await getSessionContext(req);
    assert.ok(ctx, "verify still succeeds — the marker is a signal, not a gate");
    assert.equal(ctx.actor.id, "tm-1");
    assert.equal(warnMock?.mock.callCount(), 1, "exactly one warning fired");
    const msg = warnMock?.mock.calls[0].arguments[0] as string;
    assert.match(msg, /middleware misconfiguration or bypass/);
  });

  it("marker present but not '1' also warns (treats any non-'1' as absent)", async () => {
    const jwt = await signSessionToken(FIXTURE);
    const req = makeReq({
      [SESSION_JWT_HEADER]: jwt,
      [SESSION_VERIFIED_HEADER]: "true", // wrong shape
    });
    await getSessionContext(req);
    assert.equal(warnMock?.mock.callCount(), 1);
  });
});

// -----------------------------------------------------------------
// Missing-JWT path: unauthenticated request
// -----------------------------------------------------------------
describe("getSessionContext — no JWT header", () => {
  it("returns null without warning", async () => {
    const ctx = await getSessionContext(makeReq({}));
    assert.equal(ctx, null);
    assert.equal(warnMock?.mock.callCount(), 0);
  });

  it("returns null even when verified marker is set (marker without JWT is meaningless)", async () => {
    const ctx = await getSessionContext(
      makeReq({ [SESSION_VERIFIED_HEADER]: "1" })
    );
    assert.equal(ctx, null);
  });
});

// -----------------------------------------------------------------
// Invalid-JWT path: signature / algorithm / expiry / malformed
// -----------------------------------------------------------------
describe("getSessionContext — invalid JWT header", () => {
  it("returns null for a garbage JWT header", async () => {
    const ctx = await getSessionContext(
      makeReq({
        [SESSION_JWT_HEADER]: "not.a.jwt",
        [SESSION_VERIFIED_HEADER]: "1",
      })
    );
    assert.equal(ctx, null);
  });

  it("returns null for a JWT signed with a different secret", async () => {
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
      .sign(new TextEncoder().encode("a-different-secret-of-32+-chars"));
    const ctx = await getSessionContext(
      makeReq({
        [SESSION_JWT_HEADER]: forged,
        [SESSION_VERIFIED_HEADER]: "1",
      })
    );
    assert.equal(ctx, null);
  });

  it("returns null for a wrong-purpose JWT (cross-purpose confusion)", async () => {
    const resetToken = await new SignJWT({
      userId: "u-1",
      tenantId: "tenant-1",
      purpose: "password-reset",
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("30m")
      .sign(getSecret());
    const ctx = await getSessionContext(
      makeReq({
        [SESSION_JWT_HEADER]: resetToken,
        [SESSION_VERIFIED_HEADER]: "1",
      })
    );
    assert.equal(ctx, null);
  });

  it("returns null for a Z1.8a old-shape cookie (missing subjectKind)", async () => {
    // Old-shape {userId, tenantId} cookies pass verifySessionToken
    // during the grace period (through 2026-07-14), but the core-auth
    // boundary requires a fully-typed actor.kind. Those get rejected
    // here — legacy resolution stays in src/lib/auth.ts until §7.15
    // removal.
    const legacy = await new SignJWT({
      userId: "legacy-user-1",
      tenantId: "tenant-1",
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("7d")
      .sign(getSecret());
    const ctx = await getSessionContext(
      makeReq({
        [SESSION_JWT_HEADER]: legacy,
        [SESSION_VERIFIED_HEADER]: "1",
      })
    );
    assert.equal(ctx, null);
  });
});
