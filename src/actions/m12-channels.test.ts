// src/actions/m12-channels.test.ts
//
// M12 pinning tests.

process.env.SESSION_SECRET = "test-secret-at-least-32-characters-long-please";
process.env.MFA_SECRET_KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

import crypto from "node:crypto";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { twilioSmsConnector } from "@/lib/channels/twilio-sms";
import { twilioWhatsappConnector } from "@/lib/channels/twilio-whatsapp";
import { messengerConnector, instagramConnector } from "@/lib/channels/meta-graph";
import {
  lookupConnector,
  CREDENTIAL_FIELDS,
  OUTBOUND_RATE_PER_MINUTE,
  outboundRateKey,
} from "@/lib/channels/registry";
import { channelForTicketSource, externalIdFromEndUserEmail } from "@/lib/channels/dispatch";

const SCHEMA_SRC = readFileSync("prisma/schema.prisma", "utf8");
const RLS_SRC = readFileSync("prisma/rls_policies.sql", "utf8");
const ROUTE_SRC = readFileSync(
  "src/app/api/webhooks/channels/[slug]/route.ts",
  "utf8"
);
const HANDLER_SRC = readFileSync("src/lib/channels/inbound-handler.ts", "utf8");
const DISPATCH_SRC = readFileSync("src/lib/channels/dispatch.ts", "utf8");
const ACTIONS_SRC = readFileSync("src/actions/channels.ts", "utf8");
const TICKETS_SRC = readFileSync("src/actions/tickets.ts", "utf8");

// ---------------------------------------------------------------------
// Schema + RLS pins
// ---------------------------------------------------------------------
describe("M12 — schema + RLS", () => {
  it("ChannelConfig has (tenantId, channel) unique and RLS enabled", () => {
    assert.match(
      SCHEMA_SRC,
      /model ChannelConfig[\s\S]*?@@unique\(\[tenantId,\s*channel\]\)/
    );
    assert.match(RLS_SRC, /'channel_configs'/);
    assert.match(RLS_SRC, /tenant_isolation on channel_configs/);
  });

  it("ChannelConfig.credsEnc is a String — envelope-encrypted at rest (spec §3)", () => {
    assert.match(SCHEMA_SRC, /credsEnc\s+String/);
  });
});

// ---------------------------------------------------------------------
// Twilio SMS signature verify
// ---------------------------------------------------------------------
describe("M12.1 — Twilio SMS", () => {
  const AUTH_TOKEN = "test_auth_token";
  const url = "https://example.com/api/webhooks/channels/abc";
  const body = "From=%2B15551234567&To=%2B15550000000&Body=hello&MessageSid=SM123";

  function sign(fullUrl: string, formBody: string, token: string): string {
    const params: Record<string, string> = {};
    new URLSearchParams(formBody).forEach((v, k) => (params[k] = v));
    const sortedKeys = Object.keys(params).sort();
    const data = fullUrl + sortedKeys.map((k) => `${k}${params[k]}`).join("");
    return crypto.createHmac("sha1", token).update(data, "utf8").digest("base64");
  }

  it("verifyInboundSignature accepts a properly signed Twilio request", () => {
    const sig = sign(url, body, AUTH_TOKEN);
    const ok = twilioSmsConnector.verifyInboundSignature(
      body,
      { "x-twilio-signature": sig },
      { authToken: AUTH_TOKEN },
      url
    );
    assert.equal(ok, true);
  });

  it("verifyInboundSignature rejects when the token is wrong", () => {
    const sig = sign(url, body, AUTH_TOKEN);
    const ok = twilioSmsConnector.verifyInboundSignature(
      body,
      { "x-twilio-signature": sig },
      { authToken: "different_token" },
      url
    );
    assert.equal(ok, false);
  });

  it("verifyInboundSignature rejects when the header is missing", () => {
    const ok = twilioSmsConnector.verifyInboundSignature(
      body,
      {},
      { authToken: AUTH_TOKEN },
      url
    );
    assert.equal(ok, false);
  });

  it("parseInbound produces isUserMessage=false for delivery-status events (spec §3)", () => {
    const statusBody = "From=%2B15551234567&MessageSid=SM123&MessageStatus=delivered";
    const parsed = twilioSmsConnector.parseInbound(
      statusBody,
      "application/x-www-form-urlencoded"
    );
    assert.ok(parsed);
    assert.equal(parsed?.isUserMessage, false);
  });

  it("parseInbound flags a real inbound as isUserMessage=true", () => {
    const parsed = twilioSmsConnector.parseInbound(
      body,
      "application/x-www-form-urlencoded"
    );
    assert.ok(parsed);
    assert.equal(parsed?.isUserMessage, true);
    assert.equal(parsed?.body, "hello");
    assert.equal(parsed?.externalMessageId, "SM123");
  });
});

// ---------------------------------------------------------------------
// WhatsApp template warning
// ---------------------------------------------------------------------
describe("M12.2 — WhatsApp template window", () => {
  it("warns when there's no inbound (first outbound)", () => {
    const w = twilioWhatsappConnector.requiresTemplateWarning?.({
      hoursSinceLastInbound: null,
    });
    assert.match(w ?? "", /pre-approved WhatsApp template/);
  });

  it("warns when last inbound is > 24h ago", () => {
    const w = twilioWhatsappConnector.requiresTemplateWarning?.({
      hoursSinceLastInbound: 30,
    });
    assert.match(w ?? "", /24-hour session window/);
  });

  it("does NOT warn within the session window", () => {
    const w = twilioWhatsappConnector.requiresTemplateWarning?.({
      hoursSinceLastInbound: 3,
    });
    assert.equal(w, null);
  });

  it("strips the whatsapp: prefix from parsed From", () => {
    const body =
      "From=whatsapp%3A%2B15551234567&To=whatsapp%3A%2B15550000000&Body=hi&MessageSid=SM1";
    const parsed = twilioWhatsappConnector.parseInbound(
      body,
      "application/x-www-form-urlencoded"
    );
    assert.equal(parsed?.fromExternalId, "+15551234567");
  });
});

// ---------------------------------------------------------------------
// Meta signature verify + delivery drop
// ---------------------------------------------------------------------
describe("M12.3/M12.4 — Meta connectors", () => {
  const APP_SECRET = "meta_app_secret";
  const payload = JSON.stringify({
    entry: [
      {
        messaging: [
          {
            sender: { id: "12345" },
            message: { mid: "m_1", text: "hi from fb" },
          },
        ],
      },
    ],
  });

  it("verifyInboundSignature accepts a properly signed Meta request", () => {
    const expected =
      "sha256=" +
      crypto.createHmac("sha256", APP_SECRET).update(payload, "utf8").digest("hex");
    const ok = messengerConnector.verifyInboundSignature(
      payload,
      { "x-hub-signature-256": expected },
      { appSecret: APP_SECRET },
      ""
    );
    assert.equal(ok, true);
  });

  it("verifyInboundSignature rejects a bad signature", () => {
    const ok = messengerConnector.verifyInboundSignature(
      payload,
      { "x-hub-signature-256": "sha256=notarealhash" },
      { appSecret: APP_SECRET },
      ""
    );
    assert.equal(ok, false);
  });

  it("parseInbound treats delivery/read events as non-user (spec §3)", () => {
    const deliveryPayload = JSON.stringify({
      entry: [
        {
          messaging: [{ sender: { id: "12345" }, delivery: { mids: ["m_1"] } }],
        },
      ],
    });
    const parsed = messengerConnector.parseInbound(deliveryPayload, "application/json");
    assert.equal(parsed?.isUserMessage, false);
  });

  it("Instagram uses the same envelope verification", () => {
    const expected =
      "sha256=" +
      crypto.createHmac("sha256", APP_SECRET).update(payload, "utf8").digest("hex");
    const ok = instagramConnector.verifyInboundSignature(
      payload,
      { "x-hub-signature-256": expected },
      { appSecret: APP_SECRET },
      ""
    );
    assert.equal(ok, true);
  });
});

// ---------------------------------------------------------------------
// Registry + rate-limit + dispatch helpers
// ---------------------------------------------------------------------
describe("M12 — registry + dispatch", () => {
  it("registry exposes all four channels", () => {
    for (const ch of ["SMS", "WHATSAPP", "MESSENGER", "INSTAGRAM"] as const) {
      assert.ok(lookupConnector(ch));
      assert.ok(CREDENTIAL_FIELDS[ch].length >= 1);
    }
  });

  it("outbound rate limit is per-channel (spec §3: one channel doesn't block others)", () => {
    for (const ch of ["SMS", "WHATSAPP", "MESSENGER", "INSTAGRAM"] as const) {
      assert.ok(OUTBOUND_RATE_PER_MINUTE[ch] > 0);
    }
    // Different channels for the same tenant produce different keys —
    // hitting the SMS ceiling can't block a WhatsApp send.
    assert.notEqual(outboundRateKey("t1", "WHATSAPP"), outboundRateKey("t1", "SMS"));
    assert.notEqual(outboundRateKey("t1", "MESSENGER"), outboundRateKey("t1", "SMS"));
    // Same tenant + channel = stable key.
    assert.equal(outboundRateKey("t1", "SMS"), outboundRateKey("t1", "SMS"));
    // Different tenants isolated.
    assert.notEqual(outboundRateKey("t1", "SMS"), outboundRateKey("t2", "SMS"));
  });

  it("channelForTicketSource maps ticket.source strings back to ChannelKind", () => {
    assert.equal(channelForTicketSource("sms"), "SMS");
    assert.equal(channelForTicketSource("whatsapp"), "WHATSAPP");
    assert.equal(channelForTicketSource("portal"), null);
    assert.equal(channelForTicketSource(null), null);
  });

  it("externalIdFromEndUserEmail round-trips the pseudo-email", () => {
    assert.equal(
      externalIdFromEndUserEmail("sms:+15551234567@channel.stralis"),
      "+15551234567"
    );
    assert.equal(
      externalIdFromEndUserEmail("whatsapp:+15551234567@channel.stralis"),
      "+15551234567"
    );
    // Real user emails pass through untouched.
    assert.equal(externalIdFromEndUserEmail("alice@example.com"), "alice@example.com");
  });
});

// ---------------------------------------------------------------------
// Spec §3 pins
// ---------------------------------------------------------------------
describe("M12 — §3 privacy + isolation pins", () => {
  it("webhook route verifies signature BEFORE any DB write", () => {
    // Pin the ordering of CALLS (not imports/comments): the CALL to
    // verifyInboundSignature must precede the CALL to landInboundMessage.
    const verifyCallIdx = ROUTE_SRC.indexOf("connector.verifyInboundSignature");
    const landCallIdx = ROUTE_SRC.indexOf("await landInboundMessage");
    assert.ok(verifyCallIdx > -1 && landCallIdx > -1);
    assert.ok(verifyCallIdx < landCallIdx);
  });

  it("webhook route returns 401 on signature mismatch", () => {
    assert.match(ROUTE_SRC, /bad_signature[\s\S]{0,50}status:\s*401/);
  });

  it("inbound handler dedupes ticket-create via Ticket.emailMessageId (provider retry safety)", () => {
    assert.match(HANDLER_SRC, /findFirst\({[\s\S]{0,300}emailMessageId:\s*msg\.externalMessageId/);
  });

  it("dispatch decrypts creds through envelopeDecrypt (per-tenant DEK)", () => {
    assert.match(DISPATCH_SRC, /envelopeDecrypt/);
  });

  it("channels admin action envelope-encrypts credentials before persist", () => {
    assert.match(ACTIONS_SRC, /envelopeEncrypt\(/);
  });

  it("postAgentReply routes outbound through dispatchOutbound when ticket.source is a channel", () => {
    assert.match(TICKETS_SRC, /dispatchOutbound/);
    assert.match(TICKETS_SRC, /channelForTicketSource/);
  });

  it("webhook route never logs the raw body — only channelConfigId (spec §3)", () => {
    assert.match(ROUTE_SRC, /channelConfigId:\s*config\.id/);
    assert.doesNotMatch(ROUTE_SRC, /console\.(log|error)\([^)]*rawBody/);
  });

  it("Twilio outbound never surfaces provider error text back to caller", () => {
    // The catch block returns a coarse error code, not the underlying exception.
    const src = readFileSync("src/lib/channels/twilio-sms.ts", "utf8");
    assert.match(src, /twilio_network_error/);
    assert.doesNotMatch(src, /console\.(log|error)\([^)]*Body/);
  });
});
