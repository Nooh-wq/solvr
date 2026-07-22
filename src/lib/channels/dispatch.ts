// src/lib/channels/dispatch.ts
//
// M12 — outbound dispatch. Called from postAgentReply after the
// Message row lands, when the parent Ticket's source matches a
// registered channel (SMS / WHATSAPP / MESSENGER / INSTAGRAM).
//
// Fire-and-forget from the caller's perspective — failure updates the
// ChannelConfig.lastOutboundAt but never fails the reply itself.
// Per-channel rate limit is checked before the provider call to
// satisfy spec §3 ("Do NOT let one channel's rate-limit block others").

import { prisma, withRls } from "@/lib/db";
import { envelopeDecrypt } from "@/core/auth/envelope-crypto";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  lookupConnector,
  outboundRateKey,
  OUTBOUND_RATE_PER_MINUTE,
} from "./registry";
import type { ChannelKind } from "./connector";

const SOURCE_TO_CHANNEL: Record<string, ChannelKind> = {
  sms: "SMS",
  whatsapp: "WHATSAPP",
  messenger: "MESSENGER",
  instagram: "INSTAGRAM",
};

export function channelForTicketSource(source: string | null | undefined): ChannelKind | null {
  if (!source) return null;
  return SOURCE_TO_CHANNEL[source.toLowerCase()] ?? null;
}

/**
 * Send `body` back through the channel matching `ticket.source` to
 * `endUser.email` (which for channel-sourced users is the pseudo-
 * email `<channel>:<externalId>@channel.stralis` — we split back to
 * the external id here).
 */
export async function dispatchOutbound(input: {
  tenantId: string;
  ticketSource: string;
  toExternalId: string;
  body: string;
}): Promise<{ ok: true; externalMessageId?: string } | { ok: false; error: string }> {
  const channel = channelForTicketSource(input.ticketSource);
  if (!channel) return { ok: false, error: "not_a_channel" };

  // Per-channel rate-limit (§3). A tenant hitting the SMS ceiling
  // still gets to send WhatsApp / Messenger.
  const rl = await checkRateLimit(
    outboundRateKey(input.tenantId, channel),
    OUTBOUND_RATE_PER_MINUTE[channel],
    60_000
  );
  if (!rl.allowed) return { ok: false, error: "rate_limited" };

  const config = await prisma.channelConfig.findFirst({
    where: {
      tenantId: input.tenantId,
      channel,
      isActive: true,
    },
    select: { id: true, credsEnc: true, phoneOrHandle: true },
  });
  if (!config) return { ok: false, error: "not_configured" };

  let creds: Record<string, string>;
  try {
    const plaintext = await withRls(
      { tenantId: input.tenantId, userId: null, role: "SUPER_ADMIN" },
      (tx) => envelopeDecrypt(tx, input.tenantId, config.credsEnc)
    );
    if (!plaintext) return { ok: false, error: "creds_unavailable" };
    const parsed = JSON.parse(plaintext) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ok: false, error: "bad_creds" };
    }
    creds = parsed as Record<string, string>;
  } catch {
    return { ok: false, error: "creds_unavailable" };
  }

  const connector = lookupConnector(channel);
  if (!connector) return { ok: false, error: "no_connector" };

  const result = await connector.sendOutbound(
    input.toExternalId,
    input.body,
    config.phoneOrHandle,
    creds
  );

  await prisma.channelConfig.update({
    where: { id: config.id },
    data: { lastOutboundAt: new Date() },
  });
  return result;
}

/**
 * Given an EndUser's pseudo-email (or a regular email), extract the
 * external id half of `<channel>:<externalId>@channel.stralis`, or
 * return the email unchanged if it doesn't match the pseudo pattern.
 * The dispatcher uses this to convert what the ticket carries into
 * the actual provider-side id (phone number, Meta id).
 */
export function externalIdFromEndUserEmail(email: string): string {
  const m = email.match(/^(?:sms|whatsapp|messenger|instagram):([^@]+)@channel\.stralis$/);
  return m ? m[1] : email;
}
