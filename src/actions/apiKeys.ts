"use server";

// M7.1 — ApiKey management. Same UX pattern as SCIM tokens: raw key
// shown once, only bcrypt hash stored, revocable, scoped to what the
// creator's role permits.

import { z } from "zod";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { withRls } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { API_SCOPES, deriveMaxScopes, scopesWithinLimit } from "@/lib/api/scopes";

const createSchema = z.object({
  name: z.string().min(1).max(80),
  scopes: z.array(z.string().min(1)).min(1),
});

/** Generate a token that follows the `stralis_pk_<prefix>_<random>` shape. */
function newToken(): { raw: string; prefix: string } {
  const prefix = crypto.randomBytes(4).toString("hex").slice(0, 8);
  const secret = crypto.randomBytes(32).toString("base64url");
  return { raw: `stralis_pk_${prefix}_${secret}`, prefix };
}

async function callerRolePermissions(tenantId: string, subjectId: string): Promise<Record<string, boolean>> {
  return withRls({ tenantId, userId: subjectId, role: "SUPER_ADMIN" }, async (tx) => {
    const tm = await tx.teamMember.findFirst({
      where: { id: subjectId, tenantId },
      include: { role: { select: { permissions: true } } },
    });
    return (tm?.role.permissions as Record<string, boolean> | null) ?? {};
  });
}

export async function createApiKey(
  input: z.infer<typeof createSchema>
): Promise<
  | { ok: true; token: string; id: string; prefix: string }
  | { ok: false; error: string }
> {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const session = await requireSession();

  // Scope-cannot-exceed-creator invariant. Derive the max scopes from
  // the acting role's permissions; reject any excess.
  const perms = await callerRolePermissions(session.tenantId, session.subjectId);
  const allowed = deriveMaxScopes(perms);
  const check = scopesWithinLimit(parsed.data.scopes, allowed);
  if (!check.ok) {
    return { ok: false, error: `Your role can't grant: ${check.excess.join(", ")}` };
  }

  const { raw, prefix } = newToken();
  const hash = await bcrypt.hash(raw, 10);
  const row = await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    (tx) =>
      tx.apiKey.create({
        data: {
          tenantId: session.tenantId,
          name: parsed.data.name,
          prefix,
          tokenHash: hash,
          scopes: parsed.data.scopes,
          createdBySubjectId: session.subjectId,
        },
      })
  );
  return { ok: true, token: raw, id: row.id, prefix };
}

export async function revokeApiKey(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await requireSession();
  await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    (tx) =>
      tx.apiKey.updateMany({
        where: { id, tenantId: session.tenantId, revokedAt: null },
        data: { revokedAt: new Date() },
      })
  );
  return { ok: true };
}

export async function listApiKeys(): Promise<
  Array<{
    id: string;
    name: string;
    prefix: string;
    scopes: string[];
    createdAt: Date;
    lastUsedAt: Date | null;
    revokedAt: Date | null;
  }>
> {
  const session = await requireSession();
  const rows = await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    (tx) =>
      tx.apiKey.findMany({
        where: { tenantId: session.tenantId },
        orderBy: { createdAt: "desc" },
      })
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    prefix: r.prefix,
    scopes: (r.scopes as string[]) ?? [],
    createdAt: r.createdAt,
    lastUsedAt: r.lastUsedAt,
    revokedAt: r.revokedAt,
  }));
}

/** Read the scope catalog for the create-key UI. */
export async function getApiScopeCatalog(): Promise<
  Array<{ scope: string; label: string; description: string }>
> {
  return API_SCOPES.map((s) => ({
    scope: s.scope,
    label: s.label,
    description: s.description,
  }));
}

/** What can the acting caller mint? For UI-side pre-filtering. */
export async function getAllowedScopesForCaller(): Promise<string[]> {
  const session = await requireSession();
  const perms = await callerRolePermissions(session.tenantId, session.subjectId);
  return deriveMaxScopes(perms);
}
