"use server";

// M6.5 — SCIM API token management. Same UX as GitHub PATs: the raw
// token is shown to the admin exactly once at create-time, then only
// the bcrypt hash lives in the DB.

import { z } from "zod";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { withRls } from "@/lib/db";
import { requireSession } from "@/lib/auth";

const createSchema = z.object({ name: z.string().min(1).max(80) });

export async function createScimToken(
  input: z.infer<typeof createSchema>
): Promise<{ ok: true; token: string; id: string } | { ok: false; error: string }> {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input." };
  const session = await requireSession({ minRole: "SUPER_ADMIN" });

  // 32 bytes → 43-char base64url. Prefixed with `stralis_scim_` so the
  // GitHub secret-scanning surface can catch leaks by string match.
  const raw = `stralis_scim_${crypto.randomBytes(32).toString("base64url")}`;
  const hash = await bcrypt.hash(raw, 10);

  const row = await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    (tx) =>
      tx.scimToken.create({
        data: {
          tenantId: session.tenantId,
          name: parsed.data.name,
          tokenHash: hash,
        },
      })
  );
  return { ok: true, token: raw, id: row.id };
}

export async function revokeScimToken(
  id: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await requireSession({ minRole: "SUPER_ADMIN" });
  await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    (tx) =>
      tx.scimToken.updateMany({
        where: { id, tenantId: session.tenantId, revokedAt: null },
        data: { revokedAt: new Date() },
      })
  );
  return { ok: true };
}

export async function listScimTokens(): Promise<
  Array<{ id: string; name: string; createdAt: Date; lastUsedAt: Date | null; revokedAt: Date | null }>
> {
  const session = await requireSession({ minRole: "SUPER_ADMIN" });
  return withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    (tx) =>
      tx.scimToken.findMany({
        where: { tenantId: session.tenantId },
        select: { id: true, name: true, createdAt: true, lastUsedAt: true, revokedAt: true },
        orderBy: { createdAt: "desc" },
      })
  );
}
