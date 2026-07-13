// src/lib/channels/registry.ts
//
// M12 — connector registry. `channel` string on ChannelConfig maps to
// exactly one Connector implementation here. Adding a new channel is
// (a) add the enum member, (b) implement Connector, (c) register.
//
// Cred shape per channel — this is what the admin form asks for and
// what gets envelope-encrypted into ChannelConfig.credsEnc.

import type { ChannelKind, Connector } from "./connector";
import { twilioSmsConnector } from "./twilio-sms";
import { twilioWhatsappConnector } from "./twilio-whatsapp";
import { messengerConnector, instagramConnector } from "./meta-graph";

const CONNECTORS: Record<ChannelKind, Connector> = {
  SMS: twilioSmsConnector,
  WHATSAPP: twilioWhatsappConnector,
  MESSENGER: messengerConnector,
  INSTAGRAM: instagramConnector,
};

export function lookupConnector(kind: ChannelKind | string): Connector | null {
  const c = (CONNECTORS as Record<string, Connector>)[kind];
  return c ?? null;
}

export type CredentialField = {
  key: string;
  label: string;
  helpText?: string;
  isSecret: boolean;
};

/** Fields the admin form should render for each channel. */
export const CREDENTIAL_FIELDS: Record<ChannelKind, CredentialField[]> = {
  SMS: [
    { key: "accountSid", label: "Twilio Account SID", isSecret: false },
    { key: "authToken", label: "Twilio Auth Token", isSecret: true },
  ],
  WHATSAPP: [
    { key: "accountSid", label: "Twilio Account SID", isSecret: false },
    { key: "authToken", label: "Twilio Auth Token", isSecret: true },
  ],
  MESSENGER: [
    { key: "appSecret", label: "Meta App Secret", isSecret: true },
    { key: "pageAccessToken", label: "Page Access Token", isSecret: true },
  ],
  INSTAGRAM: [
    { key: "appSecret", label: "Meta App Secret", isSecret: true },
    { key: "pageAccessToken", label: "Page Access Token", isSecret: true },
  ],
};

export const CHANNEL_LABELS: Record<ChannelKind, string> = {
  SMS: "SMS",
  WHATSAPP: "WhatsApp",
  MESSENGER: "Messenger",
  INSTAGRAM: "Instagram",
};

/** Per-channel outbound rate-limit key. Prevents one channel's
 *  throttling from blocking others (spec §3). Numbers picked to match
 *  provider defaults; tune per tenant later. */
export const OUTBOUND_RATE_PER_MINUTE: Record<ChannelKind, number> = {
  SMS: 60,
  WHATSAPP: 40,
  MESSENGER: 30,
  INSTAGRAM: 30,
};

export function outboundRateKey(tenantId: string, channel: ChannelKind): string {
  return `channel-outbound:${channel}:${tenantId}`;
}
