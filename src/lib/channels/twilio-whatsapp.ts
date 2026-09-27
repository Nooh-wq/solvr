// src/lib/channels/twilio-whatsapp.ts
//
// M12.2 — Twilio WhatsApp connector. Same wire protocol as SMS (Twilio
// exposes WhatsApp behind the same Messages resource; the difference
// is the "whatsapp:" prefix on To/From), but the composer must warn
// about the 24-hour session window: WhatsApp Business only allows
// free-form messages within 24h of the customer's last inbound; after
// that a pre-approved template is required.

import type { Connector, InboundMessage, OutboundResult } from "./connector";
import { twilioSmsConnector } from "./twilio-sms";

export const twilioWhatsappConnector: Connector = {
  kind: "WHATSAPP",
  characterLimit: 4096,

  requiresTemplateWarning({ hoursSinceLastInbound }) {
    if (hoursSinceLastInbound === null) {
      return "This is a new customer — first outbound must be a pre-approved WhatsApp template.";
    }
    if (hoursSinceLastInbound > 24) {
      return `This chat is outside the 24-hour session window (last inbound ${Math.round(
        hoursSinceLastInbound
      )}h ago). Free-form messages are blocked by WhatsApp — send a pre-approved template.`;
    }
    return null;
  },

  verifyInboundSignature: twilioSmsConnector.verifyInboundSignature,
  parseInbound(rawBody, contentType): InboundMessage | null {
    const parsed = twilioSmsConnector.parseInbound(rawBody, contentType);
    if (!parsed) return null;
    // Strip the "whatsapp:" prefix Twilio adds to From so upstream
    // subject-matching uses just the E.164 number.
    if (parsed.fromExternalId.startsWith("whatsapp:")) {
      parsed.fromExternalId = parsed.fromExternalId.slice("whatsapp:".length);
    }
    return parsed;
  },

  async sendOutbound(to, body, from, creds): Promise<OutboundResult> {
    // Prefix the "whatsapp:" scheme on both sides; Twilio requires it.
    const wTo = to.startsWith("whatsapp:") ? to : `whatsapp:${to}`;
    const wFrom = from.startsWith("whatsapp:") ? from : `whatsapp:${from}`;
    return twilioSmsConnector.sendOutbound(wTo, body, wFrom, creds);
  },
};
