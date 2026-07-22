// Phase 4d — Twilio Voice connector (config-only).
//
// The admin config surface at /admin/channels/voice is fully functional
// (creds are envelope-encrypted, webhook slug generated, active toggle
// works), but call routing itself — TwiML flow, agent softphone,
// call-to-ticket conversion — is deliberately deferred to a later
// milestone. Inbound webhook + outbound send return an unsupported
// error so the omnichannel dispatcher rejects VOICE explicitly instead
// of silently corrupting a ticket.

import crypto from "node:crypto";
import type { Connector, InboundMessage, OutboundResult } from "./connector";

export const twilioVoiceConnector: Connector = {
  kind: "VOICE",

  verifyInboundSignature(rawBody, headers, creds, fullUrl) {
    const signature = headers["x-twilio-signature"];
    const authToken = creds.authToken;
    if (!signature || !authToken) return false;
    // Twilio signs `fullUrl` + concatenated sorted params. Voice
    // webhooks are form-urlencoded; parse and re-serialize.
    try {
      const params = new URLSearchParams(rawBody);
      const sortedKeys = Array.from(params.keys()).sort();
      const concat = sortedKeys.reduce((acc, k) => acc + k + params.get(k), fullUrl);
      const expected = crypto.createHmac("sha1", authToken).update(concat).digest("base64");
      return timingSafeEqual(expected, signature);
    } catch {
      return false;
    }
  },

  parseInbound(): InboundMessage | null {
    // Voice inbound is a call, not a message — the omnichannel handler
    // treats null as "drop this webhook silently" which is the right
    // behavior until the call-to-ticket flow ships.
    return null;
  },

  async sendOutbound(): Promise<OutboundResult> {
    return { ok: false, error: "Voice channel is configured but call routing is not yet enabled." };
  },
};

function timingSafeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}
