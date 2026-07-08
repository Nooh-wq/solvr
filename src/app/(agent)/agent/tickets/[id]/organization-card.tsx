import Link from "next/link";

// Z4.4 — Organization card on ticket detail. Sits alongside the Client
// card in the right rail and links into the org detail page.

export function OrganizationCard({
  organizationId,
  name,
  openTicketCount,
}: {
  organizationId: string;
  name: string;
  openTicketCount: number;
}) {
  return (
    <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-5 mt-6">
      <p className="uppercase-label text-[11px] text-[var(--color-neutral-600)] mb-3">Organization</p>
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-xl bg-[var(--color-primary)]/10 text-[var(--color-primary)] text-[13px] font-semibold flex items-center justify-center">
          {name.slice(0, 2).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <Link
            href={`/admin/organizations/${organizationId}`}
            className="text-[14px] font-semibold hover:text-[var(--color-primary)] truncate block"
          >
            {name}
          </Link>
          <div className="text-[12px] text-[var(--color-neutral-600)]">
            <span className="text-[var(--foreground)] font-medium">{openTicketCount}</span>{" "}
            open ticket{openTicketCount === 1 ? "" : "s"} on this org
          </div>
        </div>
      </div>
      <Link
        href={`/admin/organizations/${organizationId}`}
        className="mt-3 inline-block text-[12px] text-[var(--color-primary)] hover:underline"
      >
        Open organization →
      </Link>
    </div>
  );
}
