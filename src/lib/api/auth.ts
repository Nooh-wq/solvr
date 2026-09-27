// src/lib/api/auth.ts
//
// M7.1 — API v1 auth middleware.
//
// Every /api/v1/* request goes through `authenticateApiRequest`. On
// success we hand back an `ApiContext` with tenantId + subjectId + role
// + granted scopes, plus the raw `apiKeyId` for usage-log attribution.
//
// The route handler wraps its work in `withRls({ tenantId, userId, role })`
// so tenant isolation flows through the same SQL policies as the web
// app — no custom authorization layer, no forgetting.

import bcrypt from "bcryptjs";
import { withRls } from "@/lib/db";
import type { PrismaClient } from "@/generated/prisma";
import type { ApiScope } from "@/lib/api/scopes";
import { hasScope } from "@/lib/api/scopes";

type TxLike = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

export type ApiContext = {
  tenantId: string;
  apiKeyId: string;
  subjectId: string;
  role: "SUPER_ADMIN" | "ADMIN" | "AGENT" | "CLIENT";
  scopes: ApiScope[];
};

export type ApiAuthResult =
  | { ok: true; ctx: ApiContext }
  | { ok: false; status: number; error: string };

/**
 * The API key format: `stralis_pk_<8char_prefix>_<32byte_random_b64url>`.
 * Total length ~52 chars. The prefix is what makes bcrypt-scanning
 * unnecessary: we filter to the (at most a handful of) rows with
 * matching prefix + non-null revokedAt, then bcrypt-compare only those.
 */
export function tokenPrefix(rawToken: string): string | null {
  const m = rawToken.match(/^stralis_pk_([a-z0-9]{8})_/);
  return m ? m[1] : null;
}

/**
 * Verify a bearer token, resolve the tenant + subject + role + scopes,
 * return a fully-constructed ApiContext.
 */
export async function authenticateApiRequest(authHeader: string | null): Promise<ApiAuthResult> {
  if (!authHeader || !authHeader.toLowerCase().startsWith("bearer ")) {
    return { ok: false, status: 401, error: "Missing bearer token" };
  }
  const rawToken = authHeader.slice(7).trim();
  const prefix = tokenPrefix(rawToken);
  if (!prefix) return { ok: false, status: 401, error: "Malformed API key" };

  // Prefix pre-filter — small list per tenant, no cross-tenant scan cost.
  const candidates = await withRls(
    { tenantId: "", userId: null, role: "SUPER_ADMIN" },
    (tx) =>
      tx.apiKey.findMany({
        where: { prefix, revokedAt: null },
        select: { id: true, tenantId: true, tokenHash: true, scopes: true, createdBySubjectId: true },
      })
  );

  for (const cand of candidates) {
    if (await bcrypt.compare(rawToken, cand.tokenHash)) {
      // Revalidate the creator's lifecycle so a fired employee's key
      // stops working without a role-fetch on every request. If the
      // creator is not ACTIVE, the key is dead.
      const creator = await withRls(
        { tenantId: cand.tenantId, userId: null, role: "SUPER_ADMIN" },
        async (tx) => {
          const tm = await tx.teamMember.findFirst({
            where: { id: cand.createdBySubjectId, tenantId: cand.tenantId },
            include: { role: { select: { name: true } } },
          });
          if (!tm) return null;
          const lifecycle = await tx.teamMemberLifecycle.findUnique({
            where: { subjectId: cand.createdBySubjectId },
          });
          return lifecycle?.status === "ACTIVE"
            ? { subjectId: tm.id, roleName: tm.role.name }
            : null;
        }
      );
      if (!creator) {
        return { ok: false, status: 403, error: "API key's creator is no longer active" };
      }

      // fire-and-forget lastUsedAt.
      withRls({ tenantId: cand.tenantId, userId: null, role: "SUPER_ADMIN" }, (tx) =>
        tx.apiKey.update({ where: { id: cand.id }, data: { lastUsedAt: new Date() } })
      ).catch(() => {});

      const role: ApiContext["role"] =
        creator.roleName === "Super Admin" ? "SUPER_ADMIN" :
        creator.roleName === "Admin" ? "ADMIN" :
        creator.roleName === "Agent" ? "AGENT" : "AGENT";

      return {
        ok: true,
        ctx: {
          tenantId: cand.tenantId,
          apiKeyId: cand.id,
          subjectId: creator.subjectId,
          role,
          scopes: (cand.scopes as ApiScope[]) ?? [],
        },
      };
    }
  }
  return { ok: false, status: 401, error: "Invalid API key" };
}

/**
 * Assert a scope is present on the caller. Throws a structured 403 if not.
 */
export function requireScope(ctx: ApiContext, required: ApiScope): { ok: true } | { ok: false; status: number; error: string } {
  if (!hasScope(ctx.scopes, required)) {
    return { ok: false, status: 403, error: `Missing scope: ${required}` };
  }
  return { ok: true };
}

/**
 * Convenience: run `fn` inside the caller's RLS scope. Every read/write
 * inside `fn` is tenant-isolated by the same policies as the web app.
 */
export async function withApiRls<T>(
  ctx: ApiContext,
  fn: (tx: TxLike) => Promise<T>
): Promise<T> {
  return withRls(
    { tenantId: ctx.tenantId, userId: ctx.subjectId, role: ctx.role },
    fn
  );
}
