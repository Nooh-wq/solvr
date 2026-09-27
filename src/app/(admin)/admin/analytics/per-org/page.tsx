import Link from "next/link";
import { listOrganizationsWithStats } from "@/actions/organizations";
import { EmptyState } from "@/components/empty-state";

export const dynamic = "force-dynamic";

export default async function PerOrgDashboardsPage() {
  const orgs = await listOrganizationsWithStats();

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">Per-organization dashboards</h1>
      <p className="text-sm text-[var(--color-neutral-600)] mb-6 max-w-2xl">
        Each customer organization has its own analytics view — ticket volume, SLA compliance,
        CSAT, and top categories, scoped to just their tickets. Handy for QBRs and customer-facing
        share links.
      </p>

      {orgs.length === 0 ? (
        <EmptyState
          title="No organizations yet"
          description="Create your first customer organization to see per-org analytics here."
          primaryCta={{ label: "Create organization", href: "/admin/organizations" }}
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {orgs.map((o) => (
            <Link
              key={o.id}
              href={`/admin/organizations/${o.id}/analytics`}
              className="group p-4 rounded-2xl bg-[var(--color-surface)] border border-[var(--color-neutral-300)] hover:border-[var(--color-primary)] transition-colors"
            >
              <div className="flex items-start justify-between mb-3">
                <div className="min-w-0">
                  <div className="font-semibold truncate group-hover:text-[var(--color-primary)]">
                    {o.name}
                  </div>
                  {o.domain ? (
                    <div className="text-[12px] text-[var(--color-neutral-500)] truncate">{o.domain}</div>
                  ) : null}
                </div>
                <span className="text-[10px] uppercase-label text-[var(--color-neutral-500)]">Dashboard</span>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div>
                  <div className="text-[18px] font-semibold">{o.userCount}</div>
                  <div className="text-[10px] uppercase-label text-[var(--color-neutral-500)]">Users</div>
                </div>
                <div>
                  <div className="text-[18px] font-semibold">{o.ticketCount}</div>
                  <div className="text-[10px] uppercase-label text-[var(--color-neutral-500)]">Tickets</div>
                </div>
                <div>
                  <div className="text-[18px] font-semibold">{o.openTicketCount}</div>
                  <div className="text-[10px] uppercase-label text-[var(--color-neutral-500)]">Open</div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
