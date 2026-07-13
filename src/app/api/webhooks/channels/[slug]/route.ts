// M12 — inbound webhook. /api/webhooks/channels/[slug] is the public
// URL the tenant registers with their provider (Twilio / Meta). The
// slug maps to ChannelConfig.webhookSlug — one row per tenant per
// channel — and the connector implementation is chosen via the row's
// channel column.
//
// Every request:
//   1. Look up the ChannelConfig by webhookSlug.
//   2. Decrypt creds via envelopeDecrypt.
//   3. Verify the provider signature. Reject on mismatch.
//   4. Parse into an InboundMessage. Drop non-user events (spec §3).
//   5. Delegate to landInboundMessage.

import { NextRequest, NextResponse } from "next/server";
import { prisma, withRls } from "@/lib/db";
import { envelopeDecrypt } from "@/core/auth/envelope-crypto";
import { lookupConnector } from "@/lib/channels/registry";
import type { ChannelKind } from "@/lib/channels/connector";
import { landInboundMessage } from "@/lib/channels/inbound-handler";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
): Promise<NextResponse> {
  const { slug } = await params;

  const config = await prisma.channelConfig.findUnique({
    where: { webhookSlug: slug },
    select: {
      id: true,
      tenantId: true,
      channel: true,
      phoneOrHandle: true,
      credsEnc: true,
      isActive: true,
    },
  });
  if (!config || !config.isActive) {
    // Return 200 so the provider doesn't retry endlessly for a
    // deactivated tenant — same convention as the email webhook.
    return NextResponse.json({ ok: true, skipped: "unknown_slug" });
  }

  const connector = lookupConnector(config.channel as ChannelKind);
  if (!connector) {
    return NextResponse.json({ ok: true, skipped: "unknown_channel" });
  }

  // Read raw body once — signature verification needs the exact bytes
  // the provider signed, not a re-serialised form.
  const rawBody = await request.text();
  const contentType = request.headers.get("content-type") ?? "";

  // Decrypt creds — envelopeDecrypt needs a tx handle (for the DEK
  // lookup); we use a short SUPER_ADMIN system tx keyed by the
  // known tenantId from the ChannelConfig row.
  let creds: Record<string, string>;
  try {
    const plaintext = await withRls(
      { tenantId: config.tenantId, userId: null, role: "SUPER_ADMIN" },
      (tx) => envelopeDecrypt(tx, config.tenantId, config.credsEnc)
    );
    if (!plaintext) {
      return NextResponse.json({ ok: false, error: "creds_unavailable" }, { status: 500 });
    }
    const parsed = JSON.parse(plaintext) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return NextResponse.json({ ok: false, error: "bad_creds" }, { status: 500 });
    }
    creds = parsed as Record<string, string>;
  } catch {
    // Spec §3: never surface decrypt errors — they can hint at
    // envelope-key issues that are internal-only.
    return NextResponse.json({ ok: false, error: "creds_unavailable" }, { status: 500 });
  }

  // Headers as a plain map for the connector.
  const headers: Record<string, string | null> = {};
  request.headers.forEach((v, k) => (headers[k.toLowerCase()] = v));

  const fullUrl = request.nextUrl.toString();
  if (!connector.verifyInboundSignature(rawBody, headers, creds, fullUrl)) {
    return NextResponse.json({ ok: false, error: "bad_signature" }, { status: 401 });
  }

  const parsed = connector.parseInbound(rawBody, contentType);
  if (!parsed || !parsed.isUserMessage) {
    // Delivery / read receipts / malformed — log ONLY the config id.
    return NextResponse.json({ ok: true, skipped: "not_user_message" });
  }

  try {
    const result = await landInboundMessage(
      {
        tenantId: config.tenantId,
        channel: config.channel as ChannelKind,
        channelConfigId: config.id,
      },
      parsed
    );
    return NextResponse.json({ ok: true, ticketId: result.ticketId });
  } catch (e) {
    // Never log the message body; only the config id.
    console.error("[m12 inbound] land failed", { channelConfigId: config.id });
    void e;
    return NextResponse.json({ ok: false, error: "internal" }, { status: 500 });
  }
}
