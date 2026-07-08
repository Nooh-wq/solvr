import { withRls } from "@/lib/db";
import type { UserRole } from "@/lib/auth";
import { Prisma, type SurveyType } from "@/generated/prisma";

// M5.1 — CSAT settings resolver + enqueue path. Every caller that
// wants to send a survey (updateTicket on RESOLVED, the
// `send_csat_request` rule action, an admin's manual re-send) funnels
// through `enqueueCsatSurvey` so the delay + type + settings gate is
// enforced in one place.
//
// Actual delivery happens in the `send-csat-queue` Inngest cron
// (src/lib/inngest/functions/send-csat-queue.ts) — this file never
// sends, it just schedules.

export const DEFAULT_CSAT_DELAY_MINUTES = 60;

export type CsatSession = {
  tenantId: string;
  subjectId: string | null;
  role: UserRole;
};

export type ResolvedCsatSettings = {
  enabled: boolean;
  surveyType: SurveyType;
  delayMinutes: number;
  emailSubject: string | null;
  emailBody: string | null;
};

/**
 * Read the effective CSAT settings for a tenant. Missing row = the
 * default shape (enabled, CSAT, 60 min). Callers that mutate settings
 * upsert the row explicitly — this read never lazy-creates.
 */
export async function resolveCsatSettings(
  tx: Prisma.TransactionClient,
  tenantId: string
): Promise<ResolvedCsatSettings> {
  const row = await tx.csatSettings.findUnique({ where: { tenantId } });
  if (!row) {
    return {
      enabled: true,
      surveyType: "CSAT",
      delayMinutes: DEFAULT_CSAT_DELAY_MINUTES,
      emailSubject: null,
      emailBody: null,
    };
  }
  return {
    enabled: row.enabled,
    surveyType: row.surveyType,
    delayMinutes: row.delayMinutes,
    emailSubject: row.emailSubject,
    emailBody: row.emailBody,
  };
}

/**
 * Enqueue a CSAT/NPS send for `ticketId`, scheduled for
 * `resolvedAt + delayMinutes` (or now + delay if resolvedAt is not
 * provided). No-op if:
 *   - the tenant has disabled surveys,
 *   - the ticket already has a queue row for the same surveyType
 *     that hasn't failed (either sent, or still pending — no dupes),
 *   - the ticket has already been rated (SurveyResponse exists).
 *
 * `overrideDelayMinutes` lets a rule action shorten/extend the default.
 */
export async function enqueueCsatSurvey(params: {
  session: CsatSession;
  ticketId: string;
  resolvedAt?: Date | null;
  overrideDelayMinutes?: number;
}): Promise<{ enqueued: boolean; reason?: string; scheduledFor?: Date }> {
  const { session, ticketId, resolvedAt, overrideDelayMinutes } = params;
  return withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const settings = await resolveCsatSettings(tx, session.tenantId);
      if (!settings.enabled) return { enqueued: false, reason: "SURVEYS_DISABLED" };

      const alreadyRated = await tx.surveyResponse.findFirst({
        where: { ticketId, tenantId: session.tenantId },
        select: { id: true },
      });
      if (alreadyRated) return { enqueued: false, reason: "ALREADY_RATED" };

      // Skip if there's an outstanding (pending or successfully sent)
      // queue row of the same type. A `failedAt` row does NOT block —
      // an admin can re-fire after fixing whatever broke.
      const existing = await tx.csatQueue.findFirst({
        where: {
          tenantId: session.tenantId,
          ticketId,
          surveyType: settings.surveyType,
          failedAt: null,
        },
        select: { id: true },
      });
      if (existing) return { enqueued: false, reason: "ALREADY_QUEUED" };

      const delayMs =
        (overrideDelayMinutes ?? settings.delayMinutes) * 60_000;
      const base = resolvedAt ?? new Date();
      const scheduledFor = new Date(base.getTime() + delayMs);

      await tx.csatQueue.create({
        data: {
          tenantId: session.tenantId,
          ticketId,
          surveyType: settings.surveyType,
          scheduledFor,
        },
      });
      return { enqueued: true, scheduledFor };
    }
  );
}
