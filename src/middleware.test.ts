// src/middleware.test.ts
//
// Runs with:  node --import tsx --test src/middleware.test.ts
//
// Tests exercise the middleware end-to-end using real NextRequest /
// NextResponse. Next 16's proxy default is Node runtime, so these
// classes are directly instantiable in a plain Node test.

process.env.SESSION_SECRET = "test-secret-at-least-32-characters-long-please";

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { middleware } from "./middleware.js";
import { signSessionToken } from "./core/auth/tokens.js";
import type { SessionPayload } from "./core/auth/types.js";
import {
  SESSION_JWT_HEADER,
  SESSION_VERIFIED_HEADER,
} from "./core/auth/get-session.js";
import { SignJWT } from "jose";

const COOKIE_NAME = "stralis_session";
const FIXTURE: SessionPayload = {
  subjectId: "tm-1",
  subjectKind: "TEAM_MEMBER",
  tenantId: "tenant-1",
  sessionId: "sess-1",
};

function reqTo(url: string, cookieValue?: string) {
  const req = new NextRequest(new URL(url, "https://app.local").toString());
  if (cookieValue !== undefined) {
    req.cookies.set(COOKIE_NAME, cookieValue);
  }
  return req;
}

// -----------------------------------------------------------------
// Happy path — valid session cookie
// -----------------------------------------------------------------
describe("middleware — valid session cookie forwards JWT + verified marker", () => {
  // Next 16 (proxy runtime) encodes request-side header overrides via
  // three response headers, NOT literal forwarding:
  //   x-middleware-next: 1
  //   x-middleware-override-headers: <comma-separated names>
  //   x-middleware-request-<name>: <value>
  // The real Next runtime rewrites the downstream request from these.
  // Asserting against the encoded shape is what verifies we called
  // NextResponse.next({request:{headers}}) correctly rather than
  // accidentally setting response-side headers (which would leak the
  // JWT to the browser).
  const MW_MARKER = "x-middleware-next";
  const MW_OVERRIDE_LIST = "x-middleware-override-headers";
  const MW_REQ = (name: string) => `x-middleware-request-${name}`;

  it("page route: encodes both headers via the x-middleware-request-* protocol", async () => {
    const token = await signSessionToken(FIXTURE);
    const res = await middleware(reqTo("/admin/tickets", token));

    assert.notEqual(res.status, 307, "must not be a redirect on happy path");
    assert.notEqual(res.status, 401, "must not be a 401 on happy path");
    assert.equal(res.headers.get(MW_MARKER), "1", "middleware-next marker set");

    const overrides = res.headers.get(MW_OVERRIDE_LIST)?.split(",") ?? [];
    assert.ok(overrides.includes(SESSION_JWT_HEADER));
    assert.ok(overrides.includes(SESSION_VERIFIED_HEADER));

    assert.equal(res.headers.get(MW_REQ(SESSION_JWT_HEADER)), token);
    assert.equal(res.headers.get(MW_REQ(SESSION_VERIFIED_HEADER)), "1");
  });

  it("api route: same forwarding path — no redirect / 401 branch", async () => {
    const token = await signSessionToken(FIXTURE);
    const res = await middleware(reqTo("/api/tickets", token));
    assert.notEqual(res.status, 307);
    assert.notEqual(res.status, 401);
    assert.equal(res.headers.get(MW_REQ(SESSION_JWT_HEADER)), token);
    assert.equal(res.headers.get(MW_REQ(SESSION_VERIFIED_HEADER)), "1");
  });

  it("JWT does not appear as a literal response header (would leak to browser)", async () => {
    // Belt-and-braces: if a future edit accidentally used
    // NextResponse.next({headers}) instead of NextResponse.next({request:{headers}}),
    // this test catches it — the JWT would appear as a real response
    // header, which the browser would receive and could be scraped by
    // any downstream response-header logger.
    const token = await signSessionToken(FIXTURE);
    const res = await middleware(reqTo("/admin/tickets", token));
    assert.equal(
      res.headers.get(SESSION_JWT_HEADER),
      null,
      "raw JWT must NOT appear as a response header"
    );
  });
});

// -----------------------------------------------------------------
// Missing cookie
// -----------------------------------------------------------------
describe("middleware — missing session cookie", () => {
  it("page route: redirects to /auth/login with ?next= echo", async () => {
    const res = await middleware(reqTo("/admin/tickets"));
    assert.equal(res.status, 307, "expected temporary redirect");
    const location = res.headers.get("location");
    assert.ok(location, "location header set");
    const url = new URL(location!);
    assert.equal(url.pathname, "/auth/login");
    assert.equal(url.searchParams.get("next"), "/admin/tickets");
  });

  it("api route: 401 JSON body, no redirect", async () => {
    const res = await middleware(reqTo("/api/tickets"));
    assert.equal(res.status, 401);
    assert.equal(res.headers.get("content-type")?.split(";")[0], "application/json");
    const body = await res.json();
    assert.deepEqual(body, { error: "unauthorized" });
  });
});

// -----------------------------------------------------------------
// Invalid cookie shapes — all treated as missing
// -----------------------------------------------------------------
describe("middleware — invalid session cookie treated as missing", () => {
  it("expired cookie: redirects (page)", async () => {
    const expired = await new SignJWT({
      subjectId: "tm-1",
      subjectKind: "TEAM_MEMBER",
      tenantId: "tenant-1",
      sessionId: "sess-1",
      purpose: "session",
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt(Math.floor(Date.now() / 1000) - 3600)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      .sign(new TextEncoder().encode(process.env.SESSION_SECRET!));
    const res = await middleware(reqTo("/admin/tickets", expired));
    assert.equal(res.status, 307);
  });

  it("malformed cookie: redirects (page)", async () => {
    const res = await middleware(reqTo("/admin/tickets", "not.a.jwt.at.all"));
    assert.equal(res.status, 307);
  });

  it("wrong-secret cookie: 401 (api)", async () => {
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
    const res = await middleware(reqTo("/api/tickets", forged));
    assert.equal(res.status, 401);
  });
});

// -----------------------------------------------------------------
// Public prefixes — bypass entirely
// -----------------------------------------------------------------
describe("middleware — public prefixes bypass verification", () => {
  it("/auth/login: no cookie required, no headers forwarded", async () => {
    const res = await middleware(reqTo("/auth/login"));
    assert.notEqual(res.status, 307);
    assert.notEqual(res.status, 401);
    assert.equal(res.headers.get(SESSION_JWT_HEADER), null);
  });

  it("/api/inngest: token-authenticated, bypasses cookie gate", async () => {
    const res = await middleware(reqTo("/api/inngest"));
    assert.notEqual(res.status, 401, "must not 401 the Inngest webhook");
  });

  it("/rate/<token>: CSAT link route, bypasses cookie gate", async () => {
    const res = await middleware(reqTo("/rate/abc123"));
    assert.notEqual(res.status, 307);
  });

  it("root path: bypasses (marketing/landing)", async () => {
    const res = await middleware(reqTo("/"));
    assert.notEqual(res.status, 307);
  });
});
