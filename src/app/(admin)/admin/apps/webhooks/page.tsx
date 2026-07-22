import { listWebhookSubscriptions, WEBHOOK_EVENT_TYPES } from "@/actions/webhookSubscriptions";
import { WebhooksForm } from "./webhooks-form";

export default async function WebhooksPage() {
  const subs = await listWebhookSubscriptions();
  return (
    <div>
      <h1 className="text-2xl font-bold mb-2">Outbound webhooks</h1>
      <p className="text-[13px] text-[var(--color-neutral-600)] mb-6">
        Get an HMAC-signed HTTP POST to your URL when tickets and users change.
      </p>
      <WebhooksForm subs={subs} eventTypes={[...WEBHOOK_EVENT_TYPES]} />
    </div>
  );
}
