import Link from "next/link";
import { listMyTickets } from "@/actions/tickets";
import { getTenantServiceMode } from "@/actions/serviceMode";
import { listActiveCatalogItems } from "@/actions/serviceCatalog";
import { countPendingApprovalsForMe } from "@/actions/approvalRequests";
import { labelsFor } from "@/lib/service-mode/labels";
import { StatusBadge, PriorityLabel } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { TicketStatus } from "@/generated/prisma";

const FILTERS: { label: string; value: TicketStatus | "ALL" }[] = [
  { label: "All", value: "ALL" },
  { label: "Open", value: "OPEN" },
  { label: "In progress", value: "IN_PROGRESS" },
  { label: "Pending", value: "PENDING" },
  { label: "Resolved", value: "RESOLVED" },
  { label: "Closed", value: "CLOSED" },
];

export default async function PortalTicketsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const sp = await searchParams;
  const status = (sp.status as TicketStatus | undefined) ?? undefined;
  const [tickets, mode] = await Promise.all([
    listMyTickets({ status }),
    getTenantServiceMode(),
  ]);
  const L = labelsFor(mode);
  const isEmployee = mode === "EMPLOYEE";
  const [catalog, pendingApprovals] = isEmployee
    ? await Promise.all([
        listActiveCatalogItems(),
        countPendingApprovalsForMe().catch(() => 0),
      ])
    : [[] as Awaited<ReturnType<typeof listActiveCatalogItems>>, 0];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Your {L.ticket_plural.toLowerCase()}</h1>
        <div className="flex items-center gap-2">
          {isEmployee && pendingApprovals > 0 ? (
            <Link
              href="/portal/approvals"
              className="inline-flex items-center gap-2 text-[13px] font-medium text-[var(--color-primary)] hover:underline"
            >
              Approvals
              <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-[var(--color-primary)] text-white text-[11px] font-semibold">
                {pendingApprovals}
              </span>
            </Link>
          ) : null}
          <Link href={isEmployee ? "/portal/catalog" : "/portal/new"}>
            <Button>{L.portal_new_cta}</Button>
          </Link>
        </div>
      </div>

      {isEmployee && catalog.length > 0 ? (
        <section className="mb-8">
          <div className="text-[12px] uppercase-label text-[var(--color-neutral-700)] mb-3">
            {L.catalog}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {catalog.slice(0, 8).map((it) => (
              <Link
                key={it.id}
                href={`/portal/catalog/${it.id}`}
                className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-4 hover:border-[var(--color-primary)] transition-colors cursor-pointer"
              >
                <div className="text-2xl mb-1">{it.iconEmoji ?? "📋"}</div>
                <div className="text-[13px] font-semibold">{it.name}</div>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      <div className="flex gap-2 mb-5 overflow-x-auto">
        {FILTERS.map((f) => (
          <Link
            key={f.value}
            href={f.value === "ALL" ? "/portal" : `/portal?status=${f.value}`}
            className={`rounded-full px-3 py-1.5 text-[13px] border ${
              (status ?? "ALL") === f.value
                ? "bg-black text-white border-black"
                : "border-[var(--color-neutral-300)] text-[var(--color-neutral-700)] hover:border-black"
            }`}
          >
            {f.label}
          </Link>
        ))}
      </div>

      <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl overflow-hidden">
        {tickets.length === 0 ? (
          <p className="p-8 text-center text-sm text-[var(--color-neutral-600)]">No tickets yet.</p>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[var(--color-light-gray)] text-[11px] uppercase-label text-[var(--color-neutral-700)]">
              <tr>
                <th className="text-left font-semibold px-4 py-2.5">Reference</th>
                <th className="text-left font-semibold px-4 py-2.5">Title</th>
                <th className="text-left font-semibold px-4 py-2.5">Category</th>
                <th className="text-left font-semibold px-4 py-2.5">Priority</th>
                <th className="text-left font-semibold px-4 py-2.5">Status</th>
                <th className="text-left font-semibold px-4 py-2.5">Updated</th>
              </tr>
            </thead>
            <tbody>
              {tickets.map((t) => (
                <tr key={t.id} className="border-t border-[var(--color-neutral-100)] hover:bg-[var(--color-light-gray)]">
                  <td className="px-4 py-3">
                    <Link href={`/portal/tickets/${t.id}`} className="font-mono text-[12px] text-[var(--color-primary)]">
                      {t.reference}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <Link href={`/portal/tickets/${t.id}`}>{t.title}</Link>
                  </td>
                  <td className="px-4 py-3 text-[var(--color-neutral-600)]">{t.category?.name ?? "—"}</td>
                  <td className="px-4 py-3">
                    <PriorityLabel priority={t.priority} />
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={t.status} />
                  </td>
                  <td className="px-4 py-3 text-[var(--color-neutral-600)]">
                    {new Date(t.updatedAt).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>
    </div>
  );
}
