import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { withRls } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function ZapierPage() {
  const session = await requireSession({ minRole: "ADMIN" });
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const [apiKeyCount, webhookCount] = await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => [
      await tx.apiKey.count({ where: { tenantId: session.tenantId, revokedAt: null } }),
      await tx.webhookSubscription.count({ where: { tenantId: session.tenantId, isActive: true } }),
    ]
  );

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">Zapier / Make</h1>
      <p className="text-sm text-[var(--color-neutral-600)] mb-6 max-w-2xl">
        Solvr integrates with no-code automation platforms via our public REST API and outbound
        webhooks. Both directions work today &mdash; use an API key for polling / actions from
        Zapier, and a webhook subscription for real-time triggers.
      </p>

      <div className="grid gap-4 md:grid-cols-2 max-w-4xl">
        <section className="p-5 bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-[15px] font-semibold">Outbound triggers</h2>
            <span className="text-[11px] uppercase-label text-[var(--color-neutral-500)]">
              {webhookCount} active
            </span>
          </div>
          <p className="text-[13px] text-[var(--color-neutral-600)] mb-4">
            Point Zapier at a webhook URL you control and register it here to receive events like
            <code className="text-[11px] mx-1">ticket.created</code>,
            <code className="text-[11px] mx-1">ticket.resolved</code>, and
            <code className="text-[11px]">message.sent</code>.
          </p>
          <Link
            href="/admin/apps/webhooks"
            className="inline-block text-[12px] font-medium px-4 py-2 rounded-lg bg-[var(--color-primary)] text-[var(--color-on-primary)] hover:opacity-90"
          >
            Manage webhooks
          </Link>
        </section>

        <section className="p-5 bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-[15px] font-semibold">Inbound actions</h2>
            <span className="text-[11px] uppercase-label text-[var(--color-neutral-500)]">
              {apiKeyCount} keys
            </span>
          </div>
          <p className="text-[13px] text-[var(--color-neutral-600)] mb-4">
            Create an API key with the scopes Zapier needs (usually{" "}
            <code className="text-[11px]">tickets:read</code>, <code className="text-[11px]">tickets:write</code>).
            Paste it into Zapier&apos;s &ldquo;Webhooks by Zapier&rdquo; or a custom app.
          </p>
          <Link
            href="/admin/apps/api-keys"
            className="inline-block text-[12px] font-medium px-4 py-2 rounded-lg bg-[var(--color-primary)] text-[var(--color-on-primary)] hover:opacity-90"
          >
            Manage API keys
          </Link>
        </section>

        <section className="p-5 bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl md:col-span-2">
          <h2 className="text-[15px] font-semibold mb-3">Quick setup for Zapier</h2>
          <ol className="space-y-2 text-[13px] text-[var(--color-neutral-700)] list-decimal list-inside">
            <li>
              In Zapier, create a new Zap and choose{" "}
              <strong>Webhooks by Zapier &rarr; Catch Hook</strong> as the trigger.
            </li>
            <li>Copy the hook URL Zapier gives you.</li>
            <li>
              Back here, go to{" "}
              <Link href="/admin/apps/webhooks" className="underline">
                Webhooks
              </Link>{" "}
              and register that URL for the events you care about.
            </li>
            <li>
              For the action step in Zapier (creating/updating tickets), use{" "}
              <strong>Webhooks by Zapier &rarr; Custom Request</strong> against{" "}
              <code className="text-[11px]">{baseUrl}/api/v1/tickets</code> with a bearer token
              from{" "}
              <Link href="/admin/apps/api-keys" className="underline">
                API keys
              </Link>
              .
            </li>
          </ol>
        </section>

        <section className="p-5 bg-[var(--color-neutral-100)] rounded-2xl md:col-span-2">
          <div className="text-[13px] font-semibold mb-1">Native Zapier app on the roadmap</div>
          <p className="text-[12px] text-[var(--color-neutral-700)]">
            A first-party Zapier app (pre-built triggers and actions instead of raw webhooks) is
            planned. In the meantime the raw webhook + API path above is fully supported and
            production-ready.
          </p>
        </section>
      </div>
    </div>
  );
}
