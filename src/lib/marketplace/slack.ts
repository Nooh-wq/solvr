// M19.2 — Slack integration. Install via an Incoming Webhook URL
// (widest coverage, doesn't require a Slack App with OAuth scopes on
// the tenant side — the URL itself is the credential). Sends a message
// to the wired channel when execute() runs against a ticket.
//
// Rationale: Slack's full-fat OAuth app requires a public app record
// on the marketplace and per-workspace approvals; the incoming-webhook
// path is one URL paste for the admin, which matches the "widest
// utility" priority in spec §5. When the platform gets a Slack App
// registration, this file can grow a second auth mode without changing
// the shared Integration interface.

import type { Integration, IntegrationContext, ExecuteResult, TicketBrief } from "./types";

const WEBHOOK_URL_PATTERN = /^https:\/\/hooks\.slack\.com\/services\/[A-Z0-9\/]+$/i;

async function postToSlack(url: string, payload: unknown): Promise<{ ok: boolean; status: number; body: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const body = await res.text();
    return { ok: res.ok, status: res.status, body };
  } finally {
    clearTimeout(timeout);
  }
}

function formatTicketBlocks(ticket: TicketBrief, note?: string) {
  const lines: string[] = [];
  lines.push(`*Ticket ${ticket.reference}* — ${ticket.subject}`);
  lines.push(`Priority: ${ticket.priority} · Status: ${ticket.status}`);
  if (note) lines.push(`> ${note.slice(0, 300)}`);
  lines.push(`<${ticket.url}|Open in Solvr>`);
  return lines.join("\n");
}

export const slackIntegration: Integration = {
  key: "slack",
  name: "Slack",
  tagline: "Post ticket updates to a Slack channel via Incoming Webhook.",
  category: "Communication",
  authMode: "webhook_url",
  credentialFields: [
    {
      key: "webhookUrl",
      label: "Slack Incoming Webhook URL",
      helpText:
        "Slack → Apps → Incoming Webhooks → Add to Slack → pick a channel → copy URL. Format: https://hooks.slack.com/services/…",
      isSecret: true,
    },
  ],
  metaFields: [
    {
      key: "channelName",
      label: "Channel (for display only)",
      helpText: "e.g. #eng-alerts — used in the admin UI so you can tell installs apart.",
      placeholder: "#alerts",
    },
  ],

  async test(ctx: IntegrationContext) {
    const url = ctx.credentials.webhookUrl?.trim();
    if (!url) return { ok: false, message: "Webhook URL is missing." };
    if (!WEBHOOK_URL_PATTERN.test(url)) {
      return { ok: false, message: "Doesn't look like a Slack incoming-webhook URL." };
    }
    const res = await postToSlack(url, {
      text: "Solvr integration test — you can ignore this message.",
    });
    if (!res.ok) return { ok: false, message: `Slack responded ${res.status}: ${res.body.slice(0, 120)}` };
    return { ok: true, message: "Sent a test message." };
  },

  async execute(ctx, args): Promise<ExecuteResult> {
    const url = ctx.credentials.webhookUrl?.trim();
    if (!url) throw new Error("Slack integration is missing its webhook URL.");
    const text = formatTicketBlocks(args.ticket, args.note);
    const res = await postToSlack(url, { text });
    if (!res.ok) {
      throw new Error(`Slack post failed (${res.status}): ${res.body.slice(0, 120)}`);
    }
    // Slack incoming-webhooks don't return a message ts/permalink; we
    // record the channel name from meta as the external key so the
    // ticket-detail link is at least legible ("Slack: #alerts") and the
    // URL points to the tenant's own Slack workspace archive page —
    // best we can do without a full Slack app + chat.postMessage.
    const channel = typeof ctx.meta.channelName === "string" ? ctx.meta.channelName : "slack";
    return {
      externalKey: `slack:${channel}`,
      externalUrl: url.replace(/\/services\/.*/, ""),
      externalTitle: `Posted to Slack (${channel})`,
    };
  },
};
