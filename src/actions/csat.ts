"use server";

import { z } from "zod";
import { withRls } from "@/lib/db";
import { verifyCsatToken } from "@/lib/session";

export type CsatContext = {
  ticketReference: string;
  ticketTitle: string;
  existingRating: number | null;
  // M5.4 — the survey scale to render. CSAT: 1..5 stars. NPS: 0..10.
  // Resolved from CsatSettings; existing tickets rated under CSAT stay
  // 1..5 even if the tenant later flips to NPS.
  surveyType: "CSAT" | "NPS";
};

/** Public, token-authenticated context for the /rate/[token] page — no session cookie involved. Returns null for an invalid/expired/tampered token or a ticket that no longer exists. */
export async function getCsatContext(rawToken: string): Promise<CsatContext | null> {
  const claims = await verifyCsatToken(rawToken);
  if (!claims) return null;

  // role: "SUPER_ADMIN" — same established pattern as the auto-close Inngest
  // cron (lib/inngest/functions/auto-close.ts): there's no real session here,
  // and tickets' RLS policies only grant SELECT to staff roles or the
  // ticket's own client, so this satisfies the existence-check read. The
  // signed token (verified above) is what actually authorizes rating this
  // one specific ticket, not the DB role.
  return withRls({ tenantId: claims.tenantId, userId: null, role: "SUPER_ADMIN" }, async (tx) => {
    const ticket = await tx.ticket.findFirst({
      where: { id: claims.ticketId, tenantId: claims.tenantId },
      select: {
        reference: true,
        title: true,
        surveyResponse: { select: { rating: true, surveyType: true } },
      },
    });
    if (!ticket) return null;
    // M5.4 — prefer the existing row's surveyType when the ticket has
    // already been rated (so a client returning to the link sees the
    // scale they picked on last time). Otherwise fall back to the
    // tenant's current setting.
    let surveyType: "CSAT" | "NPS" =
      ticket.surveyResponse?.surveyType ?? "CSAT";
    if (!ticket.surveyResponse) {
      const settings = await tx.csatSettings.findUnique({
        where: { tenantId: claims.tenantId },
        select: { surveyType: true },
      });
      surveyType = settings?.surveyType ?? "CSAT";
    }
    return {
      ticketReference: ticket.reference,
      ticketTitle: ticket.title,
      existingRating: ticket.surveyResponse?.rating ?? null,
      surveyType,
    };
  });
}

const submitCsatSchema = z.object({
  token: z.string().min(1),
  // Widened to 0..10 to cover both CSAT (1..5) and NPS (0..10) in one
  // schema; the per-type range is enforced after we resolve the type
  // from the ticket/settings.
  rating: z.number().int().min(0).max(10),
  comment: z.string().trim().max(2000).optional(),
  surveyType: z.enum(["CSAT", "NPS"]).optional(),
});

/** Revisiting the same link and submitting again overwrites the one rating for this ticket (SurveyResponse.ticketId is unique) rather than erroring — there's no need for single-use revocation here, unlike the guest-ticket-access token. */
export async function submitCsatRating(
  input: z.infer<typeof submitCsatSchema>
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = submitCsatSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const data = parsed.data;

  const claims = await verifyCsatToken(data.token);
  if (!claims) return { ok: false, error: "This link is no longer valid." };

  const err = await withRls({ tenantId: claims.tenantId, userId: null, role: "SUPER_ADMIN" }, async (tx) => {
    const ticket = await tx.ticket.findFirst({
      where: { id: claims.ticketId, tenantId: claims.tenantId },
      select: {
        id: true,
        surveyResponse: { select: { surveyType: true } },
      },
    });
    if (!ticket) return "NOT_FOUND" as const;

    // Resolve surveyType: prefer existing row (immutable per ticket),
    // then the client-supplied hint, then tenant settings, then CSAT.
    let surveyType: "CSAT" | "NPS" =
      ticket.surveyResponse?.surveyType ?? data.surveyType ?? "CSAT";
    if (!ticket.surveyResponse && !data.surveyType) {
      const settings = await tx.csatSettings.findUnique({
        where: { tenantId: claims.tenantId },
        select: { surveyType: true },
      });
      surveyType = settings?.surveyType ?? "CSAT";
    }
    // Enforce per-type range.
    const [min, max] = surveyType === "NPS" ? [0, 10] : [1, 5];
    if (data.rating < min || data.rating > max) {
      return `Rating must be between ${min} and ${max}.` as const;
    }

    await tx.surveyResponse.upsert({
      where: { ticketId: ticket.id },
      create: {
        tenantId: claims.tenantId,
        ticketId: ticket.id,
        rating: data.rating,
        comment: data.comment,
        surveyType,
      },
      update: {
        rating: data.rating,
        comment: data.comment,
        // Do not overwrite surveyType on update — it's fixed at first submit.
      },
    });
    return null;
  });
  if (err === "NOT_FOUND") return { ok: false, error: "This ticket could not be found." };
  if (err) return { ok: false, error: err };
  return { ok: true };
}
