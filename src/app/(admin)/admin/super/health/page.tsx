import { getSystemHealth } from "@/actions/superAdmin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function tile(label: string, value: string | number, subtitle?: string, tone?: "ok" | "warn" | "err") {
  const toneClass =
    tone === "err"
      ? "text-[var(--color-danger)]"
      : tone === "warn"
        ? "text-[var(--color-warning)]"
        : "text-[var(--color-success)]";
  return (
    <div className="p-5 bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl">
      <div className="text-[11px] uppercase-label text-[var(--color-neutral-600)] mb-1">{label}</div>
      <div className={`text-[26px] font-semibold ${tone ? toneClass : ""}`}>{value}</div>
      {subtitle ? (
        <div className="text-[11px] text-[var(--color-neutral-500)] mt-1">{subtitle}</div>
      ) : null}
    </div>
  );
}

export default async function SystemHealthPage() {
  const h = await getSystemHealth();

  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <h1 className="text-2xl font-bold">System health</h1>
        <div className="text-[11px] text-[var(--color-neutral-500)] font-mono">
          Refreshed {h.updatedAt.toLocaleTimeString()}
        </div>
      </div>
      <p className="text-sm text-[var(--color-neutral-600)] mb-6">
        Live snapshot of the platform. Reload for fresh numbers.
      </p>

      <section className="mb-6">
        <h2 className="text-[13px] uppercase-label text-[var(--color-neutral-600)] mb-2">Database</h2>
        <div className="grid gap-3 md:grid-cols-3">
          {tile(
            "Connectivity",
            h.db.ok ? "OK" : "DOWN",
            `${h.db.latencyMs}ms round-trip`,
            h.db.ok ? "ok" : "err"
          )}
          {tile("Tenants", h.counts.tenants, `${h.counts.activeTenants} active`)}
          {tile("Users", h.counts.users.toLocaleString(), "team members + customers")}
        </div>
      </section>

      <section className="mb-6">
        <h2 className="text-[13px] uppercase-label text-[var(--color-neutral-600)] mb-2">Activity</h2>
        <div className="grid gap-3 md:grid-cols-3">
          {tile("Tickets", h.counts.tickets.toLocaleString(), `${h.counts.openTickets.toLocaleString()} open`)}
          {tile("Messages (24h)", h.counts.messagesLast24h.toLocaleString())}
          {tile("Pending approvals", h.queues.pendingApprovals)}
        </div>
      </section>

      <section className="mb-6">
        <h2 className="text-[13px] uppercase-label text-[var(--color-neutral-600)] mb-2">Queues</h2>
        <div className="grid gap-3 md:grid-cols-3">
          {tile(
            "CSAT queue",
            h.queues.csatQueueDepth,
            "surveys awaiting send",
            h.queues.csatQueueDepth > 100 ? "warn" : undefined
          )}
          {tile(
            "Digest queue",
            h.queues.digestQueueDepth,
            "notifications awaiting digest",
            h.queues.digestQueueDepth > 500 ? "warn" : undefined
          )}
          {tile(
            "Failed webhooks (24h)",
            h.errors.failedWebhooksLast24h,
            "auto-disabled",
            h.errors.failedWebhooksLast24h > 0 ? "warn" : "ok"
          )}
        </div>
      </section>

      <section>
        <h2 className="text-[13px] uppercase-label text-[var(--color-neutral-600)] mb-2">Errors (last 24h)</h2>
        <div className="grid gap-3 md:grid-cols-2">
          {tile(
            "5xx API responses",
            h.errors.failedApiCallsLast24h,
            "server-side errors from the public API",
            h.errors.failedApiCallsLast24h > 10 ? "err" : h.errors.failedApiCallsLast24h > 0 ? "warn" : "ok"
          )}
          {tile(
            "Error logs",
            h.errors.errorLogsLast24h,
            "wired to logging provider when available",
            "ok"
          )}
        </div>
      </section>
    </div>
  );
}
