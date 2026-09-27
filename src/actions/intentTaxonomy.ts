"use server";

// M9.2 — per-tenant intent taxonomy CRUD.

import { z } from "zod";
import { withRls } from "@/lib/db";
import { requireSession } from "@/lib/auth";

const upsertSchema = z.object({
  slug: z.string().min(1).max(60).regex(/^[a-z0-9_]+$/, "Use lowercase letters, digits, underscore only."),
  label: z.string().min(1).max(80),
  description: z.string().min(1).max(400),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
});

export async function upsertIntent(
  input: z.infer<typeof upsertSchema>
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const parsed = upsertSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const session = await requireSession({ minRole: "ADMIN" });

  const row = await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    (tx) =>
      tx.intentTaxonomy.upsert({
        where: { tenantId_slug: { tenantId: session.tenantId, slug: parsed.data.slug } },
        create: {
          tenantId: session.tenantId,
          slug: parsed.data.slug,
          label: parsed.data.label,
          description: parsed.data.description,
          isActive: parsed.data.isActive,
          sortOrder: parsed.data.sortOrder,
        },
        update: {
          label: parsed.data.label,
          description: parsed.data.description,
          isActive: parsed.data.isActive,
          sortOrder: parsed.data.sortOrder,
        },
      })
  );
  return { ok: true, id: row.id };
}

export async function deleteIntent(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await requireSession({ minRole: "ADMIN" });
  await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    (tx) => tx.intentTaxonomy.deleteMany({ where: { id, tenantId: session.tenantId } })
  );
  return { ok: true };
}

export async function listIntents(): Promise<
  Array<{ id: string; slug: string; label: string; description: string; isActive: boolean; sortOrder: number }>
> {
  const session = await requireSession({ minRole: "ADMIN" });
  return withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    (tx) =>
      tx.intentTaxonomy.findMany({
        where: { tenantId: session.tenantId },
        orderBy: { sortOrder: "asc" },
        select: { id: true, slug: true, label: true, description: true, isActive: true, sortOrder: true },
      })
  );
}
