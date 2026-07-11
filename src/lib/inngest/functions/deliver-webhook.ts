// M7.4 — outbound webhook delivery.
//
// Consumes the `webhook.deliver` event fired by src/lib/webhooks.ts.
// One event = one delivery attempt for one subscription. Signs the
// payload with HMAC-SHA256 and the subscription's shared secret,
// POSTs to the URL, retries with exponential backoff on failure.
//
// Signature header: `X-Stralis-Signature: t=<unix>,v1=<hex>`
// Signed body: `<timestamp>.<request_body>` (Stripe pattern)
//
// On persistent failure: increment failCount, requeue with backoff.
// If failCount exceeds MAX_FAIL_COUNT, disable the subscription.

import crypto from "node:crypto";
import { inngest } from "@/lib/inngest/client";
import { withRls } from "@/lib/db";
import { envelopeDecrypt } from "@/core/auth/envelope-crypto";

const MAX_FAIL_COUNT = 20;
// Backoff sequence in minutes: 1, 2, 4, 8, ..., 15, then plateau at 15.
// Sum over 20 attempts ≈ 220 min → within the ~24h window per M7 §3.
function backoffMinutes(attempt: number): number {
  return Math.min(15, Math.pow(2, attempt));
}

function signBody(timestamp: number, body: string, secret: string): string {
  const payload = `${timestamp}.${body}`;
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

type WebhookDeliverEvent = {
  data: {
    subscriptionId: string;
    tenantId: string;
    event: string;
    payload: unknown;
    attempt: number;
  };
};

export const deliverWebhook = inngest.createFunction(
  {
    id: "deliver-webhook",
    retries: 0, // We do our own retry via failCount + resend.
    triggers: { event: "webhook.deliver" },
  },
  async ({ event, step }: { event: WebhookDeliverEvent; step: { run: <T>(name: string, fn: () => Promise<T>) => Promise<T>; sleep: (name: string, ms: string) => Promise<void> } }) => {
    const { subscriptionId, tenantId, event: eventType, payload, attempt } = event.data;

    const sub = await step.run("load-subscription", async () => {
      return withRls({ tenantId, userId: null, role: "SUPER_ADMIN" }, (tx) =>
        tx.webhookSubscription.findFirst({
          where: { id: subscriptionId, tenantId },
        })
      );
    });
    if (!sub || !sub.isActive) return { skipped: true, reason: "subscription-inactive-or-missing" };

    const secret = await step.run("unwrap-secret", async () => {
      return withRls({ tenantId, userId: null, role: "SUPER_ADMIN" }, (tx) =>
        envelopeDecrypt(tx, tenantId, sub.secret)
      );
    });
    if (!secret) return { skipped: true, reason: "secret-unavailable" };

    const timestamp = Math.floor(Date.now() / 1000);
    const body = JSON.stringify({ event: eventType, data: payload, timestamp });
    const signature = signBody(timestamp, body, secret);

    const result = await step.run("post", async () => {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15_000); // 15s per attempt
        const res = await fetch(sub.url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "user-agent": "Stralis-Webhook/1.0",
            "x-stralis-signature": `t=${timestamp},v1=${signature}`,
            "x-stralis-event": eventType,
          },
          body,
          signal: controller.signal,
        });
        clearTimeout(timeout);
        return { ok: res.ok, status: res.status };
      } catch (err) {
        return { ok: false, status: 0, error: err instanceof Error ? err.message : String(err) };
      }
    });

    if (result.ok) {
      await step.run("mark-delivered", async () => {
        await withRls({ tenantId, userId: null, role: "SUPER_ADMIN" }, (tx) =>
          tx.webhookSubscription.update({
            where: { id: subscriptionId },
            data: { lastDeliveredAt: new Date(), failCount: 0 },
          })
        );
      });
      return { ok: true, status: result.status };
    }

    // Failure path: increment failCount, maybe disable, requeue.
    const nextAttempt = attempt + 1;
    const nextFailCount = (sub.failCount ?? 0) + 1;
    if (nextFailCount >= MAX_FAIL_COUNT) {
      await step.run("disable", async () => {
        await withRls({ tenantId, userId: null, role: "SUPER_ADMIN" }, (tx) =>
          tx.webhookSubscription.update({
            where: { id: subscriptionId },
            data: {
              isActive: false,
              disabledAt: new Date(),
              disabledReason: `${nextFailCount} consecutive failures. Last status: ${result.status}`,
              failCount: nextFailCount,
            },
          })
        );
      });
      return { ok: false, status: result.status, disabled: true };
    }

    await step.run("bump-fail-count", async () => {
      await withRls({ tenantId, userId: null, role: "SUPER_ADMIN" }, (tx) =>
        tx.webhookSubscription.update({
          where: { id: subscriptionId },
          data: { failCount: nextFailCount },
        })
      );
    });

    const backoff = backoffMinutes(nextAttempt);
    await step.sleep("backoff", `${backoff}m`);
    await step.run("requeue", async () => {
      await inngest.send({
        name: "webhook.deliver",
        data: { subscriptionId, tenantId, event: eventType, payload, attempt: nextAttempt },
      });
    });
    return { ok: false, status: result.status, retrying: true, nextBackoffMinutes: backoff };
  }
);
