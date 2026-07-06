"use server";

import { z } from "zod";
import { withRls } from "@/lib/db";
import { verifyCsatToken } from "@/lib/session";

export type CsatContext = {
  ticketReference: string;
  ticketTitle: string;
  existingRating: number | null;
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
      select: { reference: true, title: true, surveyResponse: { select: { rating: true } } },
    });
    if (!ticket) return null;
    return {
      ticketReference: ticket.reference,
      ticketTitle: ticket.title,
      existingRating: ticket.surveyResponse?.rating ?? null,
    };
  });
}

const submitCsatSchema = z.object({
  token: z.string().min(1),
  rating: z.number().int().min(1).max(5),
  comment: z.string().trim().max(2000).optional(),
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

  await withRls({ tenantId: claims.tenantId, userId: null, role: "SUPER_ADMIN" }, async (tx) => {
    const ticket = await tx.ticket.findFirst({ where: { id: claims.ticketId, tenantId: claims.tenantId } });
    if (!ticket) throw new Error("NOT_FOUND");

    await tx.surveyResponse.upsert({
      where: { ticketId: ticket.id },
      create: {
        tenantId: claims.tenantId,
        ticketId: ticket.id,
        rating: data.rating,
        comment: data.comment,
      },
      update: {
        rating: data.rating,
        comment: data.comment,
      },
    });
  });

  return { ok: true };
}
