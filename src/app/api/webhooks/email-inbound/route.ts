import { NextResponse, type NextRequest } from "next/server";
import type { WebhookEventPayload } from "resend";
import { verifyResendWebhookSignature } from "@/lib/email/inbound";
import { handleInboundEmail } from "@/lib/email/inbound-handler";
import { checkRateLimit } from "@/lib/rate-limit";

/**
 * Resend inbound webhook endpoint (email flow design §"Inbound email
 * provider": Resend inbound routes). Configure in the Resend dashboard
 * under Webhooks -> add this URL, subscribed to the `email.received` event,
 * and set RESEND_WEBHOOK_SECRET (from the dashboard's signing secret) here
 * and in .env. See README "Email-to-ticket" for the full setup steps.
 *
 * `/api/webhooks/*` is already public in middleware.ts's PUBLIC_PREFIXES —
 * auth for this route is the signature check below, not a session cookie
 * (Resend's server has no session).
 */
export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
  // Coarse defense-in-depth on top of signature verification — a valid
  // signature can't be forged, but nothing stops a compromised/misbehaving
  // sender from hammering the endpoint.
  const rateLimit = await checkRateLimit(`inbound-email:${ip}`, 60, 60_000);
  if (!rateLimit.allowed) return NextResponse.json({ error: "rate limited" }, { status: 429 });

  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[email-inbound] RESEND_WEBHOOK_SECRET not set — rejecting (see README)");
    return NextResponse.json({ error: "not configured" }, { status: 501 });
  }

  const rawBody = await request.text();
  const verified = verifyResendWebhookSignature(
    rawBody,
    {
      svixId: request.headers.get("svix-id"),
      svixTimestamp: request.headers.get("svix-timestamp"),
      svixSignature: request.headers.get("svix-signature"),
    },
    secret
  );
  if (!verified) return NextResponse.json({ error: "invalid signature" }, { status: 401 });

  let payload: WebhookEventPayload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  if (payload.type !== "email.received") {
    // We only subscribed to email.received, but ignore anything else
    // gracefully rather than erroring if the dashboard subscription ever
    // gets broadened.
    return NextResponse.json({ ok: true, ignored: payload.type });
  }

  try {
    const result = await handleInboundEmail(payload.data);
    console.log(`[email-inbound] ${result}`);
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    console.error("[email-inbound] handling failed", err);
    // 200, not 500: a webhook 5xx makes Resend retry, which would re-run a
    // failed side-effecting flow (duplicate tickets/messages) rather than
    // fix anything. Failures are logged for manual follow-up instead.
    return NextResponse.json({ ok: false, error: "internal error, not retrying" });
  }
}
