// src/lib/api/request.ts
//
// M7.1/M7.6 — the wrapper that every /api/v1/* handler runs through.
// Handles auth + tenant-wide rate limit + usage-log emission +
// structured error responses in one place.
//
// Handlers get an `ApiContext` and return NextResponse. Errors flow
// as { status, code, message } → the standard error body shape.

import { NextResponse } from "next/server";
import { authenticateApiRequest, requireScope, type ApiContext } from "@/lib/api/auth";
import { withRls } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import type { ApiScope } from "@/lib/api/scopes";

export type ApiErrorBody = { error: { code: string; message: string } };

export function apiError(status: number, code: string, message: string) {
  return NextResponse.json<ApiErrorBody>(
    { error: { code, message } },
    { status, headers: { "content-type": "application/json" } }
  );
}

/**
 * The default tenant-wide rate limit for /api/v1 — 300 req / 10s. Keyed
 * on tenantId per M7 §3 ("rate limits per tenant, not per key"), so an
 * attacker can't work around it by minting extra keys.
 */
const TENANT_RATE_MAX = 300;
const TENANT_RATE_WINDOW_MS = 10_000;

async function logUsage(
  tenantId: string,
  apiKeyId: string | null,
  method: string,
  path: string,
  statusCode: number,
  durationMs: number
): Promise<void> {
  try {
    await withRls({ tenantId, userId: null, role: "SUPER_ADMIN" }, (tx) =>
      tx.apiUsageLog.create({
        data: { tenantId, apiKeyId, method, path, statusCode, durationMs },
      })
    );
  } catch {
    // Never fail a request because usage logging failed.
  }
}

/**
 * Wrap a handler: auth, rate-limit, scope-check, run, log.
 *
 * The `scope` field is the scope the endpoint requires. If null, the
 * endpoint is accessible with any valid key (rare — currently only
 * used by the /api/v1/me introspection endpoint).
 */
export function apiHandler(opts: {
  scope: ApiScope | null;
  handler: (ctx: ApiContext, req: Request) => Promise<NextResponse>;
}) {
  return async function (req: Request): Promise<NextResponse> {
    const startedAt = Date.now();
    const url = new URL(req.url);
    const path = url.pathname;

    const auth = await authenticateApiRequest(req.headers.get("authorization"));
    if (!auth.ok) {
      const res = apiError(auth.status, auth.status === 401 ? "unauthenticated" : "forbidden", auth.error);
      void logUsage("", null, req.method, path, auth.status, Date.now() - startedAt);
      return res;
    }
    const ctx = auth.ctx;

    // Tenant-wide rate limit — per M7 §3 rate limits apply per tenant,
    // not per key.
    const rate = await checkRateLimit(`api-v1:${ctx.tenantId}`, TENANT_RATE_MAX, TENANT_RATE_WINDOW_MS);
    if (!rate.allowed) {
      const res = apiError(429, "rate_limited", `Too many requests. Try again in ${Math.ceil(rate.retryAfterMs / 1000)}s.`);
      res.headers.set("retry-after", String(Math.ceil(rate.retryAfterMs / 1000)));
      void logUsage(ctx.tenantId, ctx.apiKeyId, req.method, path, 429, Date.now() - startedAt);
      return res;
    }

    if (opts.scope) {
      const scopeCheck = requireScope(ctx, opts.scope);
      if (!scopeCheck.ok) {
        const res = apiError(scopeCheck.status, "insufficient_scope", scopeCheck.error);
        void logUsage(ctx.tenantId, ctx.apiKeyId, req.method, path, scopeCheck.status, Date.now() - startedAt);
        return res;
      }
    }

    try {
      const res = await opts.handler(ctx, req);
      void logUsage(ctx.tenantId, ctx.apiKeyId, req.method, path, res.status, Date.now() - startedAt);
      return res;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const res = apiError(500, "internal_error", message);
      void logUsage(ctx.tenantId, ctx.apiKeyId, req.method, path, 500, Date.now() - startedAt);
      return res;
    }
  };
}
