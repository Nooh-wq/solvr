// src/middleware.ts
//
// B5 (Z-post / core-auth) — coarse auth gate + JWT header forwarding.
//
// Two things happen here per request:
//
//   1. Cookie verify. The `stralis_session` cookie is verified via
//      `verifySessionToken` from `src/core/auth/tokens.ts` (B3 — with
//      the `algorithms: ["HS256"]` hardening). On failure, unauth'd
//      requests get a redirect (page routes) or a 401 JSON body (API
//      routes) — the correct fetch()-consumer idiom, not a login-page
//      HTML redirect that a JSON caller has no way to handle.
//
//   2. Header forward. On success, the raw JWT is forwarded downstream
//      as `x-stralis-session-jwt` alongside `x-stralis-session-verified: 1`.
//      Server components / route handlers / server actions consume
//      these via `getSessionContext` (B5's other file) — which
//      re-verifies (belt & braces) and warns on the JWT-without-marker
//      case, per the design pass's tightening #1.
//
// Runtime: this file runs in Next.js's proxy layer (renamed from
// `middleware` in Next 16 — file rename to `proxy.ts` is a follow-up,
// not scoped to B5). Next 16's proxy defaults to Node runtime, so
// jose is fully available — no Edge-only constraint any more, but
// still no DB access (wrong layer).

import { NextResponse, type NextRequest } from "next/server";
import { verifySessionToken } from "@/core/auth/tokens";
import {
  SESSION_JWT_HEADER,
  SESSION_VERIFIED_HEADER,
} from "@/core/auth/get-session";

const SESSION_COOKIE_NAME = "stralis_session";

// Route-group access map. Tenant resolution itself happens lazily in
// layouts (it needs Prisma, which the Edge runtime can't run) — this
// middleware's job is coarse auth gating only.
// /guest and /rate are both token-authenticated routes (see actions/guest.ts
// and actions/csat.ts), not session-cookie ones — a real guest/rater arrives
// with no session at all, so neither must redirect to /auth/login the way
// every other protected route does. The token itself (and its validity) is
// checked inside the page/actions, not here.
// /api/data-export/[token] is token-authenticated (see M21.6), same
// rationale as /guest and /rate — the JWT signature IS the auth check,
// so bouncing through the session-cookie gate would be wrong.
const PUBLIC_PREFIXES = [
  "/auth",
  "/guest",
  "/rate",
  "/reports/shared",
  "/share",       // Z10.4 — /share/org/[token] signed org dashboards
  "/employee-service", // M15.6 — marketing landing page
  "/api/auth", // M6.2/M6.3 — SAML/OIDC SP endpoints (IdP-authenticated, not session)
  "/api/scim", // M6.5/M6.6 — SCIM bearer-token authed
  "/api/v1",   // M7 — public API, bearer-token authed
  "/docs/api", // M7.5 — API docs page (public)
  "/api/webhooks",
  "/api/inngest",
  "/api/data-export",
  "/_next",
  "/favicon.ico",
  "/brand",
];

function isPublicPath(pathname: string): boolean {
  if (pathname === "/") return true;
  return PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));
}

function isApiRoute(pathname: string): boolean {
  return pathname.startsWith("/api/");
}

function unauthorizedResponse(request: NextRequest): NextResponse {
  // API callers get a proper 401 JSON body — a redirect to a login
  // page would return HTML to a fetch() consumer that has no way to
  // recover from it. Page callers get the redirect + `?next=` echo so
  // they land back where they were after signing in.
  if (isApiRoute(request.nextUrl.pathname)) {
    return NextResponse.json(
      { error: "unauthorized" },
      { status: 401 }
    );
  }
  const loginUrl = new URL("/auth/login", request.url);
  loginUrl.searchParams.set("next", request.nextUrl.pathname);
  return NextResponse.redirect(loginUrl);
}

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return unauthorizedResponse(request);

  const decoded = await verifySessionToken(token);
  if (!decoded) return unauthorizedResponse(request);

  // Forward the raw JWT + verification marker so downstream
  // getSessionContext() can re-verify AND detect middleware-skipped
  // requests. Both headers must ride on the request-side (see Next 16
  // proxy docs §"Setting Headers"): NextResponse.next({request:{headers}})
  // makes them available upstream; the wrong overload sets them on
  // the response, which leaks the raw JWT to the browser.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(SESSION_JWT_HEADER, token);
  requestHeaders.set(SESSION_VERIFIED_HEADER, "1");

  return NextResponse.next({
    request: { headers: requestHeaders },
  });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|brand/).*)"],
};
