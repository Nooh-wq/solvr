// src/lib/webhooks.ts
//
// M7.4 — outbound webhook fan-out. Domain code calls emitTicketEvent
// (or emitUserEvent) with an event type + payload. This module:
//   1. Finds every WebhookSubscription in the tenant that subscribes
//      to the event type.
//   2. Fires an Inngest event that the deliver-webhook function
//      consumes — Inngest handles retry, backoff, and DLQ.
//   3. Signs the payload with the per-subscription secret using
//      HMAC-SHA256, `X-Stralis-Signature: t=<unix>,v1=<hex>` (Stripe pattern).
//
// The signing happens in the Inngest delivery function, not here — this
// module is fire-and-forget so a slow delivery never stalls the domain
// mutation.

import { inngest } from "@/lib/inngest/client";
import { withRls } from "@/lib/db";

export type WebhookEventType =
  | "ticket.created"
  | "ticket.updated"
  | "ticket.resolved"
  | "ticket.reopened"
  | "user.created"
  | "user.updated";

async function fanoutSubscriptions(tenantId: string, event: WebhookEventType, payload: unknown): Promise<void> {
  const subs = await withRls(
    { tenantId, userId: null, role: "SUPER_ADMIN" },
    (tx) =>
      tx.webhookSubscription.findMany({
        where: { tenantId, isActive: true },
        select: { id: true, events: true },
      })
  );
  const matching = subs.filter((s) => {
    const events = (s.events as string[]) ?? [];
    return events.includes(event) || events.includes("*");
  });
  if (matching.length === 0) return;

  await Promise.all(
    matching.map((s) =>
      inngest.send({
        name: "webhook.deliver",
        data: {
          subscriptionId: s.id,
          tenantId,
          event,
          payload,
          attempt: 0,
        },
      })
    )
  );
}

export async function emitTicketEvent(
  tenantId: string,
  event: Extract<WebhookEventType, `ticket.${string}`>,
  payload: unknown
): Promise<void> {
  await fanoutSubscriptions(tenantId, event, payload).catch(() => {});
}

export async function emitUserEvent(
  tenantId: string,
  event: Extract<WebhookEventType, `user.${string}`>,
  payload: unknown
): Promise<void> {
  await fanoutSubscriptions(tenantId, event, payload).catch(() => {});
}
