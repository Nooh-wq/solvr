import { Resend } from "resend";
import { render } from "@react-email/components";
import { TicketNotificationEmail } from "./templates/ticket-notification";
import { SystemNoticeEmail } from "./templates/system-notice";
import { inngest } from "@/lib/inngest/client";
import type { TenantBranding } from "@/generated/prisma";

// Exported so the inbound webhook (lib/email/inbound-handler.ts) can call
// resend.emails.receiving.get() to fetch a received email's body — the
// webhook payload itself only carries metadata (see resend's
// ReceivedEmailEventData type), not text/html.
export const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

function fromAddress(branding: TenantBranding | null) {
  const productName = branding?.productName ?? "Support";
  const fromName = branding?.emailFromName ?? productName;
  // Prefer the tenant's dedicated inbound address (see prisma/schema.prisma
  // TenantBranding.supportEmail) so replies naturally thread back into the
  // inbound webhook — falls back to a generated address for tenants that
  // haven't set one up yet.
  if (branding?.supportEmail) return `${fromName} <${branding.supportEmail}>`;
  const fromDomain = branding?.emailDomain ?? process.env.DEFAULT_EMAIL_DOMAIN ?? "stralis.app";
  return `${fromName} <support@${fromDomain}>`;
}

/**
 * Degrades to a console log instead of throwing when RESEND_API_KEY isn't
 * set, so whatever triggered this never fails because of email (§10 NFR:
 * "email failures degrade gracefully").
 *
 * On a real send failure, queues an Inngest retry (src/lib/inngest/functions/retry-email.ts)
 * instead of just logging and giving up — that function gets 3 automatic
 * retries with backoff. Requires `npx inngest-cli dev` running locally to
 * actually execute; if nothing's listening, the queue attempt itself is
 * wrapped so it can't throw back into the caller (same "never block the
 * mutation that triggered this" principle as the rest of this file).
 */
async function deliver(to: string, subject: string, html: string, branding: TenantBranding | null): Promise<{ ok: boolean; skipped?: boolean }> {
  if (!resend) {
    console.log(`[email:skipped, no RESEND_API_KEY] to=${to} subject="${subject}"`);
    return { ok: true, skipped: true };
  }
  const from = fromAddress(branding);
  try {
    await resend.emails.send({ from, to, subject, html });
    return { ok: true };
  } catch (err) {
    console.error("[email:send failed, queuing retry]", err);
    try {
      await inngest.send({ name: "email/send.failed", data: { from, to, subject, html } });
    } catch (queueErr) {
      console.error("[email:retry queue unreachable — is `npx inngest-cli dev` running?]", queueErr);
    }
    return { ok: false };
  }
}

export type SendTicketEmailInput = {
  to: string;
  branding: TenantBranding | null;
  reference: string;
  title: string;
  statusLabel: string;
  /** 0-3, see TRACKER_STAGE in lib/email/events.ts — drives the 4-stage visual tracker. */
  trackerStage: number;
  contextLine: string;
  subject: string;
  ticketUrl: string;
};

/** Sends a ticket-lifecycle email via the tenant's verified domain, falling back to DEFAULT_EMAIL_DOMAIN when unverified. */
export async function sendTicketEmail(input: SendTicketEmailInput) {
  const html = await render(
    TicketNotificationEmail({
      productName: input.branding?.productName ?? "Support",
      primaryColor: input.branding?.primaryColor ?? "#FF6A00",
      reference: input.reference,
      title: input.title,
      statusLabel: input.statusLabel,
      trackerStage: input.trackerStage,
      contextLine: input.contextLine,
      ticketUrl: input.ticketUrl,
    })
  );
  return deliver(input.to, input.subject, html, input.branding);
}

export type SendSystemNoticeInput = {
  to: string;
  branding: TenantBranding | null;
  subject: string;
  heading: string;
  body: string;
  ctaLabel?: string;
  ctaUrl?: string;
};

/** Sends a one-off system notice (agent invite, password reset) — same visual system as ticket emails. */
export async function sendSystemNotice(input: SendSystemNoticeInput) {
  const html = await render(
    SystemNoticeEmail({
      productName: input.branding?.productName ?? "Support",
      primaryColor: input.branding?.primaryColor ?? "#FF6A00",
      heading: input.heading,
      body: input.body,
      ctaLabel: input.ctaLabel,
      ctaUrl: input.ctaUrl,
    })
  );
  return deliver(input.to, input.subject, html, input.branding);
}
