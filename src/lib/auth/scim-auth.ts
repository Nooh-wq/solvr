// src/lib/auth/scim-auth.ts
//
// M6.5 — SCIM bearer-token auth for /scim/v2/* endpoints.
// Tokens are bcrypt-hashed at rest; the raw token is shown to the
// tenant admin exactly once at create-time (github PAT pattern).
//
// Rate limit: 60 req / 10s per token (spec §3.15's "SHOULD be
// rate-limited"). Applied by the caller via checkRateLimitWithIp.

import bcrypt from "bcryptjs";
import { withRls } from "@/lib/db";

export type ScimAuthResult =
  | { ok: false; status: number; error: string }
  | { ok: true; tenantId: string; tokenId: string };

/**
 * Verifies a bearer token from an incoming SCIM request. Returns the
 * matched tenant + token id or a structured 401/403.
 *
 * The lookup is intentionally not indexed by a prefix — bcrypt hashes
 * don't support fast prefix matching. For a small number of tokens per
 * tenant (typical: 1–3 per IdP), scanning all live tokens and bcrypt-
 * comparing each is fast enough. At scale we'd add a separate short-
 * prefix column for the initial fanout.
 */
export async function verifyScimBearer(authHeader: string | null): Promise<ScimAuthResult> {
  if (!authHeader || !authHeader.toLowerCase().startsWith("bearer ")) {
    return { ok: false, status: 401, error: "Missing bearer token" };
  }
  const rawToken = authHeader.slice(7).trim();
  if (!rawToken) return { ok: false, status: 401, error: "Empty bearer token" };

  // Read all live tokens across all tenants — RLS bypassed here because
  // the token IS the auth: we're doing a system-actor lookup to figure
  // out which tenant this token belongs to.
  const tokens = await withRls(
    { tenantId: "", userId: null, role: "SUPER_ADMIN" },
    (tx) =>
      tx.scimToken.findMany({
        where: { revokedAt: null },
        select: { id: true, tenantId: true, tokenHash: true },
      })
  );

  for (const t of tokens) {
    if (await bcrypt.compare(rawToken, t.tokenHash)) {
      // Update lastUsedAt fire-and-forget (don't hold the request).
      withRls({ tenantId: t.tenantId, userId: null, role: "SUPER_ADMIN" }, (tx) =>
        tx.scimToken.update({
          where: { id: t.id },
          data: { lastUsedAt: new Date() },
        })
      ).catch(() => {});
      return { ok: true, tenantId: t.tenantId, tokenId: t.id };
    }
  }
  return { ok: false, status: 401, error: "Invalid bearer token" };
}
