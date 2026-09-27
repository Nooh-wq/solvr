import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { withRls } from "@/lib/db";
import { EmptyState } from "@/components/empty-state";

export const dynamic = "force-dynamic";

/**
 * Ticket layout admin. Fields on the ticket detail page come from the
 * matched TicketForm's field list (Z2.3). Rather than duplicate that
 * editor here, this page lists the tenant's forms and links back to the
 * canonical /admin/forms editor where field order + required-ness lives.
 */
export default async function TicketLayoutPage() {
  const session = await requireSession({ minRole: "ADMIN" });
  const forms = await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    (tx) =>
      tx.ticketForm.findMany({
        where: { tenantId: session.tenantId },
        orderBy: { position: "asc" },
        include: {
          _count: { select: { fields: true, categories: true } },
        },
      })
  );

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">Ticket layout</h1>
      <p className="text-sm text-[var(--color-neutral-600)] mb-6 max-w-2xl">
        Which custom fields appear on a ticket depends on which ticket form matched when it was
        filed. Reorder fields, mark them required, or gate them by category from the form editor.
      </p>

      {forms.length === 0 ? (
        <EmptyState
          title="No ticket forms yet"
          description="Create at least one form so customers know what to fill in."
          primaryCta={{ label: "Create form", href: "/admin/forms" }}
        />
      ) : (
        <div className="space-y-3 max-w-3xl">
          {forms.map((f) => (
            <Link
              key={f.id}
              href="/admin/forms"
              className="group flex items-center justify-between p-4 rounded-2xl bg-[var(--color-surface)] border border-[var(--color-neutral-300)] hover:border-[var(--color-primary)]"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold group-hover:text-[var(--color-primary)]">
                    {f.name}
                  </span>
                  {!f.isActive ? (
                    <span className="text-[10px] uppercase-label px-2 py-0.5 rounded-full bg-[var(--color-neutral-200)] text-[var(--color-neutral-600)]">
                      Inactive
                    </span>
                  ) : null}
                </div>
                {f.description ? (
                  <div className="text-[12px] text-[var(--color-neutral-600)] mt-0.5">
                    {f.description}
                  </div>
                ) : null}
              </div>
              <div className="text-[11px] text-[var(--color-neutral-500)] font-mono whitespace-nowrap ml-4">
                {f._count.fields} field{f._count.fields === 1 ? "" : "s"} ·{" "}
                {f._count.categories} categor{f._count.categories === 1 ? "y" : "ies"}
              </div>
            </Link>
          ))}
        </div>
      )}

      <div className="mt-6 p-4 rounded-2xl bg-[var(--color-neutral-100)] text-[12px] text-[var(--color-neutral-700)] max-w-3xl">
        <div className="font-semibold text-[13px] mb-1">Related</div>
        <Link href="/admin/fields" className="underline">
          Custom fields
        </Link>{" "}
        · <Link href="/admin/categories" className="underline">
          Categories
        </Link>{" "}
        · <Link href="/admin/forms" className="underline">
          Ticket forms
        </Link>
      </div>
    </div>
  );
}
