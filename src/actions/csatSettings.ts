"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withRls } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { resolveCsatSettings, DEFAULT_CSAT_DELAY_MINUTES } from "@/lib/csat";
import type { SurveyType } from "@/generated/prisma";

// M5.1 — settings mutations for CSAT/NPS. Read path lives in the lib
// so cron + rule engine share it; writes are here because they carry
// admin-role gates + revalidation.

const updateSchema = z.object({
  enabled: z.boolean().optional(),
  surveyType: z.enum(["CSAT", "NPS"]).optional(),
  delayMinutes: z.number().int().min(0).max(60 * 24 * 30).optional(),
  emailSubject: z.string().max(200).nullable().optional(),
  emailBody: z.string().max(20_000).nullable().optional(),
});

export type CsatSettingsView = {
  enabled: boolean;
  surveyType: SurveyType;
  delayMinutes: number;
  emailSubject: string | null;
  emailBody: string | null;
};

export async function loadCsatSettings(): Promise<CsatSettingsView> {
  const session = await requireSession({ minRole: "ADMIN" });
  return withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    (tx) => resolveCsatSettings(tx, session.tenantId)
  );
}

export async function updateCsatSettings(input: z.infer<typeof updateSchema>) {
  const session = await requireSession({ minRole: "ADMIN" });
  const parsed = updateSchema.parse(input);
  await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const existing = await tx.csatSettings.findUnique({ where: { tenantId: session.tenantId } });
      if (existing) {
        await tx.csatSettings.update({
          where: { tenantId: session.tenantId },
          data: {
            ...(parsed.enabled !== undefined && { enabled: parsed.enabled }),
            ...(parsed.surveyType !== undefined && { surveyType: parsed.surveyType }),
            ...(parsed.delayMinutes !== undefined && { delayMinutes: parsed.delayMinutes }),
            ...(parsed.emailSubject !== undefined && { emailSubject: parsed.emailSubject }),
            ...(parsed.emailBody !== undefined && { emailBody: parsed.emailBody }),
          },
        });
      } else {
        await tx.csatSettings.create({
          data: {
            tenantId: session.tenantId,
            enabled: parsed.enabled ?? true,
            surveyType: parsed.surveyType ?? "CSAT",
            delayMinutes: parsed.delayMinutes ?? DEFAULT_CSAT_DELAY_MINUTES,
            emailSubject: parsed.emailSubject ?? null,
            emailBody: parsed.emailBody ?? null,
          },
        });
      }
    }
  );
  revalidatePath("/admin/csat");
  revalidatePath("/admin/csat-settings");
  return { ok: true };
}

// M5.3 — moderation. Update a single row's moderationStatus. Rating
// itself is immutable here — hiding a comment does not delete the
// score.
const moderateSchema = z.object({
  surveyResponseId: z.string().min(1),
  status: z.enum(["VISIBLE", "FLAGGED", "HIDDEN"]),
});

export async function moderateSurveyResponse(input: z.infer<typeof moderateSchema>) {
  const session = await requireSession({ minRole: "ADMIN" });
  const { surveyResponseId, status } = moderateSchema.parse(input);
  await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    (tx) =>
      tx.surveyResponse.update({
        where: { id: surveyResponseId },
        data: {
          moderationStatus: status,
          moderatedByTeamMemberId: session.subjectId,
          moderatedAt: new Date(),
        },
      })
  );
  revalidatePath("/admin/csat");
  return { ok: true };
}
