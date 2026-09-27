import Link from "next/link";
import { loadCrossTenantHealth } from "@/actions/superAnalytics";

// M13.10 — cross-tenant health dashboard. Only reachable through
// /admin/super/*, which the SuperAdminLayout has already gated to
// host-tenant SUPER_ADMIN. The action does the gate again — defence
// in depth.

export default async function SuperCrossTenantAnalytics() {
  const rows = await loadCrossTenantHealth();

  const totals = rows.reduce(
    (acc, r) => {
      acc.tickets += r.totalTickets30d;
      acc.resolved += r.resolvedTickets30d;
      acc.chats += r.chatConversations30d;
      return acc;
    },
    { tickets: 0, resolved: 0, chats: 0 }
  );

  return (
    <div>
      <div className="mb-4 text-[12px] text-[var(--color-neutral-500)]">
        <Link href="/admin/super" className="hover:text-[var(--foreground)]">
          ← Back to Super Admin
        </Link>
      </div>
      <h1 className="text-2xl font-bold mb-1">Cross-tenant health</h1>
      <p className="text-sm text-[var(--color-neutral-600)] mb-6">
        30-day snapshot across all provisioned tenants. Host-tenant Super Admins only.
      </p>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <SummaryCard label="Tenants" value={rows.length.toString()} />
        <SummaryCard label="Tickets (30d)" value={totals.tickets.toLocaleString()} />
        <SummaryCard label="Resolved (30d)" value={totals.resolved.toLocaleString()} />
        <SummaryCard label="Chat conversations (30d)" value={totals.chats.toLocaleString()} />
      </div>

      <div className="rounded-2xl border border-[var(--color-neutral-300)] bg-[var(--color-surface)] overflow-hidden">
        <div className="px-5 py-3 border-b border-[var(--color-neutral-200)]">
          <h2 className="text-sm font-semibold">Per-tenant</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="text-[11px] uppercase-label text-[var(--color-neutral-500)] bg-[var(--color-neutral-100)]/50">
              <tr>
                <th className="text-left px-5 py-2 font-medium">Tenant</th>
                <th className="text-right px-5 py-2 font-medium">Tickets</th>
                <th className="text-right px-5 py-2 font-medium">Resolved</th>
                <th className="text-right px-5 py-2 font-medium">Avg first response</th>
                <th className="text-right px-5 py-2 font-medium">Notifications</th>
                <th className="text-right px-5 py-2 font-medium">Chat convs</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.tenantId} className="border-t border-[var(--color-neutral-200)]">
                  <td className="px-5 py-2.5">
                    <div className="font-medium">{r.tenantName}</div>
                    <div className="text-[11px] text-[var(--color-neutral-500)]">
                      {r.slug} · {r.status.toLowerCase()}
                    </div>
                  </td>
                  <td className="px-5 py-2.5 text-right font-mono tabular-nums">
                    {r.totalTickets30d.toLocaleString()}
                  </td>
                  <td className="px-5 py-2.5 text-right font-mono tabular-nums">
                    {r.resolvedTickets30d.toLocaleString()}
                  </td>
                  <td className="px-5 py-2.5 text-right font-mono tabular-nums">
                    {r.avgFirstResponseHours !== null
                      ? `${r.avgFirstResponseHours.toFixed(1)}h`
                      : "—"}
                  </td>
                  <td className="px-5 py-2.5 text-right font-mono tabular-nums">
                    {r.outboundEmails30d.toLocaleString()}
                  </td>
                  <td className="px-5 py-2.5 text-right font-mono tabular-nums">
                    {r.chatConversations30d.toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-5">
      <p className="uppercase-label text-[11px] text-[var(--color-neutral-600)] mb-2">{label}</p>
      <p className="text-2xl font-bold font-mono">{value}</p>
    </div>
  );
}
