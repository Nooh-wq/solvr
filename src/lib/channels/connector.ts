// src/lib/channels/connector.ts
//
// M12 — shared connector interface. One implementation per channel
// (SMS, WHATSAPP, MESSENGER, INSTAGRAM). The webhook route + outbound
// dispatcher are channel-agnostic — they get an instance of Connector
// via lookupConnector(channel).

export type ChannelKind = "SMS" | "WHATSAPP" | "MESSENGER" | "INSTAGRAM";

export type InboundMessage = {
  /** Sender identifier — phone number, page-scoped id, etc. */
  fromExternalId: string;
  /** Display name if the provider surfaces one. */
  fromDisplayName?: string;
  body: string;
  /** Provider event id for idempotency. */
  externalMessageId?: string;
  /** True iff this is a real user message. Delivery/read receipts are
   *  false so the webhook drops them per spec §3. */
  isUserMessage: boolean;
};

export type OutboundResult =
  | { ok: true; externalMessageId?: string }
  | { ok: false; error: string };

export type ConnectorCreds = Record<string, string>;

export interface Connector {
  readonly kind: ChannelKind;
  /** True when a per-channel outbound compliance rule blocks send.
   *  Notable: WhatsApp Business messaging outside the 24-hour session
   *  window requires a pre-approved template. */
  requiresTemplateWarning?: (context: { hoursSinceLastInbound: number | null }) => string | null;
  /** Character limits the composer should warn about. */
  characterLimit?: number;
  /**
   * Verify the incoming request's provider signature against creds.
   * Return false → the route rejects with 401 and drops the payload.
   */
  verifyInboundSignature(
    rawBody: string,
    headers: Record<string, string | null>,
    creds: ConnectorCreds,
    fullUrl: string
  ): boolean;
  /**
   * Parse the raw provider payload into a normalised InboundMessage.
   * Delivery/read receipts return isUserMessage=false and the caller
   * drops them (spec §3 "Do NOT map non-message events into tickets").
   */
  parseInbound(rawBody: string, contentType: string): InboundMessage | null;
  /** Send an outbound reply via the provider's API. */
  sendOutbound(
    to: string,
    body: string,
    from: string,
    creds: ConnectorCreds
  ): Promise<OutboundResult>;
}
