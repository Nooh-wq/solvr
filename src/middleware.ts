import { NextResponse, type NextRequest } from "next/server";
import { getSessionPayloadFromRequest } from "@/lib/session";

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
const PUBLIC_PREFIXES = ["/auth", "/guest", "/rate", "/reports/shared", "/api/webhooks", "/api/inngest", "/api/data-export", "/_next", "/favicon.ico", "/brand"];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p)) || pathname === "/") {
    return NextResponse.next();
  }

  const session = await getSessionPayloadFromRequest(request);

  if (!session) {
    const loginUrl = new URL("/auth/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Fine-grained role checks (CLIENT vs AGENT vs ADMIN vs SUPER_ADMIN) and
  // tenant-mismatch rejection happen in each route group's layout, where
  // Prisma/Node APIs are available. This keeps the Edge middleware fast
  // and avoids a DB round-trip on every request.
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|brand/).*)"],
};
