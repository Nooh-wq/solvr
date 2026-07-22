"use server";

// M9 — tenant-wide AI settings: master switch, confidence threshold,
// monthly token cap, auto-translate, primary language.

import { z } from "zod";
import { withRls } from "@/lib/db";
import { requireSession } from "@/lib/auth";

const setSchema = z.object({
  aiEnabled: z.boolean().optional(),
  aiConfidenceThreshold: z.number().min(0).max(1).optional(),
  aiMonthlyTokenCap: z.number().int().min(0).optional(),
  aiAutoTranslate: z.boolean().optional(),
  aiPrimaryLanguage: z.string().min(2).max(10).optional(),
});

export async function setAiSettings(
  input: z.infer<typeof setSchema>
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = setSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const session = await requireSession({ minRole: "ADMIN" });

  await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    (tx) =>
      tx.tenant.update({
        where: { id: session.tenantId },
        data: parsed.data,
      })
  );
  return { ok: true };
}

export async function getAiSettings(): Promise<{
  aiEnabled: boolean;
  aiConfidenceThreshold: number;
  aiMonthlyTokenCap: number;
  aiTokensUsedThisMonth: number;
  aiAutoTranslate: boolean;
  aiPrimaryLanguage: string;
}> {
  const session = await requireSession({ minRole: "ADMIN" });
  const row = await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    (tx) =>
      tx.tenant.findUnique({
        where: { id: session.tenantId },
        select: {
          aiEnabled: true,
          aiConfidenceThreshold: true,
          aiMonthlyTokenCap: true,
          aiTokensUsedThisMonth: true,
          aiAutoTranslate: true,
          aiPrimaryLanguage: true,
        },
      })
  );
  if (!row) throw new Error("Tenant not found");
  return row;
}
