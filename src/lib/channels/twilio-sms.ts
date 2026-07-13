// src/lib/channels/twilio-sms.ts
//
// M12.1 — Twilio SMS connector. Reference implementation. Twilio's
// webhook signs the request with an HMAC-SHA1 of the (full URL) +
// (sorted form-body key=value pairs), signed with the account's
// auth token. See https://www.twilio.com/docs/usage/webhooks/webhooks-security
//
// Outbound uses Twilio's Messages resource:
// POST https://api.twilio.com/2010-04-01/Accounts/{sid}/Messages.json
// with basic auth (accountSid:authToken). The body is
// application/x-www-form-urlencoded — matches what the SDK does under
// the hood; we roll it by hand to keep the connector server-lib-free.

import crypto from "node:crypto";
import type { Connector, ConnectorCreds, InboundMessage, OutboundResult } from "./connector";

function parseForm(body: string): Record<string, string> {
  const params = new URLSearchParams(body);
  const out: Record<string, string> = {};
  for (const [k, v] of params.entries()) out[k] = v;
  return out;
}

export const twilioSmsConnector: Connector = {
  kind: "SMS",
  characterLimit: 1600,

  verifyInboundSignature(rawBody, headers, creds, fullUrl) {
    const signature = headers["x-twilio-signature"];
    if (!signature) return false;
    const authToken = creds.authToken;
    if (!authToken) return false;
    const params = parseForm(rawBody);
    // Twilio's rule: concatenate URL + sorted-by-key (name + value)
    // form fields.
    const sortedKeys = Object.keys(params).sort();
    const data = fullUrl + sortedKeys.map((k) => `${k}${params[k]}`).join("");
    const expected = crypto
      .createHmac("sha1", authToken)
      .update(data, "utf8")
      .digest("base64");
    return timingSafeEqualStr(signature, expected);
  },

  parseInbound(rawBody, contentType) {
    if (!contentType.includes("application/x-www-form-urlencoded")) return null;
    const params = parseForm(rawBody);
    // Twilio delivery/read events use `MessageStatus` and no `Body`.
    // The spec §3 pin ("Do NOT map non-message events into tickets")
    // is enforced here.
    const hasBody = typeof params.Body === "string" && params.Body.length > 0;
    if (!hasBody) {
      return {
        fromExternalId: params.From ?? "",
        body: "",
        externalMessageId: params.MessageSid,
        isUserMessage: false,
      };
    }
    return {
      fromExternalId: params.From,
      fromDisplayName: undefined,
      body: params.Body,
      externalMessageId: params.MessageSid,
      isUserMessage: true,
    };
  },

  async sendOutbound(to, body, from, creds): Promise<OutboundResult> {
    const sid = creds.accountSid;
    const token = creds.authToken;
    if (!sid || !token) return { ok: false, error: "missing_credentials" };
    const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`;
    const auth = "Basic " + Buffer.from(`${sid}:${token}`).toString("base64");
    const form = new URLSearchParams({ To: to, From: from, Body: body });
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: auth,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: form.toString(),
      });
      if (!response.ok) {
        return { ok: false, error: `twilio_${response.status}` };
      }
      const data = (await response.json()) as { sid?: string };
      return { ok: true, externalMessageId: data.sid };
    } catch {
      // Spec §3 pin — do not surface arbitrary provider error text
      // back to the caller (it can leak PII from the request body).
      return { ok: false, error: "twilio_network_error" };
    }
  },
};

function timingSafeEqualStr(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}
