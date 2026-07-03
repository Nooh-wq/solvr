import crypto from "node:crypto";

/**
 * Resend signs webhooks the same way as everything else on Svix: headers
 * `svix-id` / `svix-timestamp` / `svix-signature`, secret prefixed
 * `whsec_`. Implemented by hand (rather than pulling in the `svix` package)
 * since it's ~10 lines of HMAC — see https://docs.svix.com/receiving/verifying-payloads/how-manual.
 */
export function verifyResendWebhookSignature(
  rawBody: string,
  headers: { svixId: string | null; svixTimestamp: string | null; svixSignature: string | null },
  secret: string
): boolean {
  const { svixId, svixTimestamp, svixSignature } = headers;
  if (!svixId || !svixTimestamp || !svixSignature) return false;

  // Reject stale timestamps (>5min) to bound replay-attack exposure.
  const ts = Number(svixTimestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 300) return false;

  const secretBytes = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const signedContent = `${svixId}.${svixTimestamp}.${rawBody}`;
  const expected = crypto.createHmac("sha256", secretBytes).update(signedContent).digest("base64");

  const candidates = svixSignature.split(" ").map((part) => part.split(",")[1]).filter(Boolean);
  return candidates.some((candidate) => {
    try {
      return crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(expected));
    } catch {
      return false;
    }
  });
}

/** Extracts the numeric ticket tag from a subject like "Re: [#12707664] We received your request". */
export function extractTicketNumberFromSubject(subject: string): string | null {
  const match = subject.match(/\[#(\d{5,12})\]/);
  return match ? match[1] : null;
}

/** Pulls candidate Message-IDs (angle-bracket-wrapped) out of In-Reply-To/References headers, for the fallback thread-matching path when the subject tag got stripped. */
export function extractReferencedMessageIds(headerValue: string | null | undefined): string[] {
  if (!headerValue) return [];
  return [...headerValue.matchAll(/<([^<>]+)>/g)].map((m) => m[1]);
}

/**
 * Strips quoted history / signatures from a plain-text email body — best
 * effort, not a full parser. Cuts at the first line that looks like a
 * quote-block marker (Gmail/Outlook/Apple Mail conventions) or the first
 * run of "> " quoted lines.
 */
export function stripQuotedReply(text: string): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const cutMarkers = [
    /^On .+ wrote:$/,
    /^-{2,}\s*Original Message\s*-{2,}$/i,
    /^From:\s*.+$/i,
    /^Sent from my /i,
    /^>{1}/,
  ];

  let cutAt = lines.length;
  for (let i = 0; i < lines.length; i++) {
    if (cutMarkers.some((re) => re.test(lines[i].trim()))) {
      cutAt = i;
      break;
    }
  }
  return lines.slice(0, cutAt).join("\n").trim();
}

/** Very small HTML->text fallback for providers that only give `html` (no `text`) on the receiving email. */
export function htmlToPlainText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}
