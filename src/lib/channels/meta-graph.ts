// src/lib/channels/meta-graph.ts
//
// M12.3 / M12.4 — Facebook Messenger + Instagram DM connectors.
// Meta's Graph API signs webhooks with an HMAC-SHA256 of the raw body
// using the app secret, delivered in `X-Hub-Signature-256: sha256=…`.
// Both channels share this exact envelope; the differences are the
// object types in the JSON payload.
//
// The outbound POST is scaffolded but calls the Graph API's
// Messages endpoint with a Page Access Token. Real production use
// requires a live Meta app + page id + access token; the connector
// returns a clear error when creds are absent so admins hit a
// configuration wall, not a silent failure.

import crypto from "node:crypto";
import type { Connector, InboundMessage, OutboundResult } from "./connector";

function verifyMetaSignature(
  rawBody: string,
  headers: Record<string, string | null>,
  appSecret: string
): boolean {
  const header = headers["x-hub-signature-256"];
  if (!header || !header.startsWith("sha256=")) return false;
  const expected = crypto
    .createHmac("sha256", appSecret)
    .update(rawBody, "utf8")
    .digest("hex");
  const provided = header.slice("sha256=".length);
  if (provided.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
}

function parseMetaMessage(rawBody: string, kind: "MESSENGER" | "INSTAGRAM"): InboundMessage | null {
  try {
    const payload = JSON.parse(rawBody) as {
      entry?: Array<{
        messaging?: Array<{
          sender?: { id?: string };
          message?: { mid?: string; text?: string };
          delivery?: unknown;
          read?: unknown;
        }>;
      }>;
    };
    const entry = payload.entry?.[0];
    const msg = entry?.messaging?.[0];
    if (!msg) return null;
    // Delivery / read receipts — spec §3 pin, no ticket.
    if (msg.delivery || msg.read) {
      return { fromExternalId: msg.sender?.id ?? "", body: "", isUserMessage: false };
    }
    const text = msg.message?.text;
    if (typeof text !== "string" || !text) {
      return {
        fromExternalId: msg.sender?.id ?? "",
        body: "",
        externalMessageId: msg.message?.mid,
        isUserMessage: false,
      };
    }
    return {
      fromExternalId: msg.sender?.id ?? "",
      body: text,
      externalMessageId: msg.message?.mid,
      isUserMessage: true,
    };
  } catch {
    // Never surface the raw body in an error log — spec §3 privacy.
    void kind;
    return null;
  }
}

async function sendMetaOutbound(
  to: string,
  body: string,
  from: string,
  creds: Record<string, string>,
  apiHost: "graph.facebook.com" | "graph.instagram.com"
): Promise<OutboundResult> {
  const pageAccessToken = creds.pageAccessToken;
  if (!pageAccessToken) return { ok: false, error: "missing_page_access_token" };
  const url = `https://${apiHost}/v18.0/${encodeURIComponent(from)}/messages?access_token=${encodeURIComponent(pageAccessToken)}`;
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recipient: { id: to },
        message: { text: body },
      }),
    });
    if (!response.ok) return { ok: false, error: `meta_${response.status}` };
    const data = (await response.json()) as { message_id?: string };
    return { ok: true, externalMessageId: data.message_id };
  } catch {
    return { ok: false, error: "meta_network_error" };
  }
}

export const messengerConnector: Connector = {
  kind: "MESSENGER",
  characterLimit: 2000,
  verifyInboundSignature(rawBody, headers, creds) {
    const secret = creds.appSecret;
    if (!secret) return false;
    return verifyMetaSignature(rawBody, headers, secret);
  },
  parseInbound(rawBody, contentType) {
    if (!contentType.includes("application/json")) return null;
    return parseMetaMessage(rawBody, "MESSENGER");
  },
  sendOutbound(to, body, from, creds) {
    return sendMetaOutbound(to, body, from, creds, "graph.facebook.com");
  },
};

export const instagramConnector: Connector = {
  kind: "INSTAGRAM",
  characterLimit: 1000,
  verifyInboundSignature(rawBody, headers, creds) {
    const secret = creds.appSecret;
    if (!secret) return false;
    return verifyMetaSignature(rawBody, headers, secret);
  },
  parseInbound(rawBody, contentType) {
    if (!contentType.includes("application/json")) return null;
    return parseMetaMessage(rawBody, "INSTAGRAM");
  },
  sendOutbound(to, body, from, creds) {
    return sendMetaOutbound(to, body, from, creds, "graph.instagram.com");
  },
};
