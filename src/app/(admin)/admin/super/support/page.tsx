import { listSupportTickets } from "@/actions/superAdmin";
import { EmptyState } from "@/components/empty-state";

export const dynamic = "force-dynamic";

const STATUS_STYLES: Record<string, string> = {
  OPEN: "bg-[var(--color-primary)]/10 text-[var(--color-primary)]",
  IN_PROGRESS: "bg-[var(--color-warning)]/15 text-[var(--color-warning)]",
  PENDING: "bg-[var(--color-neutral-200)] text-[var(--color-neutral-700)]",
  RESOLVED: "bg-[var(--color-success)]/15 text-[var(--color-success)]",
  CLOSED: "bg-[var(--color-neutral-100)] text-[var(--color-neutral-600)]",
};

const PRIORITY_STYLES: Record<string, string> = {
  URGENT: "bg-[var(--color-danger)]/15 text-[var(--color-danger)]",
  HIGH: "bg-[var(--color-warning)]/15 text-[var(--color-warning)]",
  MEDIUM: "bg-[var(--color-neutral-100)] text-[var(--color-neutral-700)]",
  LOW: "bg-[var(--color-neutral-100)] text-[var(--color-neutral-500)]",
};

export default async function SupportTicketsPage({
  searchParams,
}: {
  searchParams: Promise<{ includeClosed?: string }>;
}) {
  const sp = await searchParams;
  const includeClosed = sp.includeClosed === "1";
  const tickets = await listSupportTickets({ includeClosed });

  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <h1 className="text-2xl font-bold">Support tickets</h1>
        <a
          href={includeClosed ? "?" : "?includeClosed=1"}
          className="text-[12px] font-medium px-3 py-1.5 rounded-lg border border-[var(--color-neutral-300)] hover:bg-[var(--color-neutral-100)]"
        >
          {includeClosed ? "Show open only" : "Include closed"}
        </a>
      </div>
      <p className="text-sm text-[var(--color-neutral-600)] mb-6 max-w-2xl">
        Cross-tenant view of every customer&apos;s open ticket. Handy for spotting a customer with
        multiple problems at once, or scanning for outages. To act on one, impersonate the tenant
        first from{" "}
        <a href="/admin/super/impersonation" className="underline">
          Impersonation
        </a>
        .
      </p>

      {tickets.length === 0 ? (
        <EmptyState
          title="No open customer tickets"
          description={includeClosed ? "No customer tickets at all yet." : "Everyone's caught up."}
        />
      ) : (
        <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[var(--color-light-gray)] text-[11px] uppercase-label text-[var(--color-neutral-700)]">
                <tr>
                  <th className="text-left font-semibold px-4 py-2.5">Ref</th>
                  <th className="text-left font-semibold px-4 py-2.5">Title</th>
                  <th className="text-left font-semibold px-4 py-2.5">Tenant</th>
                  <th className="text-left font-semibold px-4 py-2.5">Status</th>
                  <th className="text-left font-semibold px-4 py-2.5">Priority</th>
                  <th className="text-left font-semibold px-4 py-2.5">Updated</th>
                </tr>
              </thead>
              <tbody>
                {tickets.map((t) => (
                  <tr key={t.id} className="border-t border-[var(--color-neutral-100)]">
                    <td className="px-4 py-3 font-mono text-[12px] text-[var(--color-primary)]">
                      {t.reference}
                    </td>
                    <td className="px-4 py-3 max-w-[360px] truncate">{t.title}</td>
                    <td className="px-4 py-3">
                      <div className="text-[13px] font-medium">{t.tenantName}</div>
                      <div className="text-[11px] text-[var(--color-neutral-500)] font-mono">
                        {t.tenantSlug}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`text-[11px] uppercase-label px-2 py-0.5 rounded-full ${STATUS_STYLES[t.status] ?? ""}`}
                      >
                        {t.status.replace("_", " ")}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`text-[11px] uppercase-label px-2 py-0.5 rounded-full ${PRIORITY_STYLES[t.priority] ?? ""}`}
                      >
                        {t.priority}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-[12px] text-[var(--color-neutral-600)]">
                      {new Date(t.updatedAt).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
