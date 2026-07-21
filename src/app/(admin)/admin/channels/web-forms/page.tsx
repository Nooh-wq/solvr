import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { withRls } from "@/lib/db";
import { EmptyState } from "@/components/empty-state";
import { EmbedSnippet } from "./embed-snippet";

export const dynamic = "force-dynamic";

export default async function WebFormsPage() {
  const session = await requireSession({ minRole: "ADMIN" });
  const forms = await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    (tx) =>
      tx.ticketForm.findMany({
        where: { tenantId: session.tenantId, isActive: true },
        orderBy: { position: "asc" },
        select: { id: true, name: true, description: true },
      })
  );

  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const portalUrl = `${baseUrl}/portal/new`;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">Web forms</h1>
      <p className="text-sm text-[var(--color-neutral-600)] mb-6 max-w-2xl">
        Point-and-click ways to embed a &ldquo;submit a ticket&rdquo; experience on your own
        website. All forms use the same ticket forms you&apos;ve configured under{" "}
        <Link href="/admin/forms" className="underline">
          Ticket forms
        </Link>{" "}
        &mdash; embedding just changes where the customer starts.
      </p>

      <div className="space-y-6 max-w-4xl">
        <section className="p-5 bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl">
          <h2 className="text-[15px] font-semibold mb-2">Direct link</h2>
          <p className="text-[13px] text-[var(--color-neutral-600)] mb-3">
            Send customers straight to your ticket form. Great for &ldquo;Contact us&rdquo; buttons
            or help center CTAs.
          </p>
          <code className="block text-[12px] font-mono break-all p-2 rounded bg-[var(--color-neutral-100)]">
            {portalUrl}
          </code>
        </section>

        <section className="p-5 bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl">
          <h2 className="text-[15px] font-semibold mb-2">Iframe embed</h2>
          <p className="text-[13px] text-[var(--color-neutral-600)] mb-3">
            Drop this into your marketing site or help center to render the form inline.
          </p>
          <EmbedSnippet portalUrl={portalUrl} />
        </section>

        <section>
          <h2 className="text-[15px] font-semibold mb-2">Available forms</h2>
          {forms.length === 0 ? (
            <EmptyState
              title="No active ticket forms yet"
              description="Create a form so customers know what to fill in."
              primaryCta={{ label: "Create form", href: "/admin/forms" }}
            />
          ) : (
            <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-[var(--color-light-gray)] text-[11px] uppercase-label text-[var(--color-neutral-700)]">
                  <tr>
                    <th className="text-left font-semibold px-4 py-2.5">Form</th>
                    <th className="text-left font-semibold px-4 py-2.5">Description</th>
                    <th className="text-right font-semibold px-4 py-2.5">Preview</th>
                  </tr>
                </thead>
                <tbody>
                  {forms.map((f) => (
                    <tr key={f.id} className="border-t border-[var(--color-neutral-100)]">
                      <td className="px-4 py-3 font-medium">{f.name}</td>
                      <td className="px-4 py-3 text-[12px] text-[var(--color-neutral-600)]">
                        {f.description ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <a
                          href={`${portalUrl}?formId=${f.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[12px] font-medium px-3 py-1.5 rounded-lg border border-[var(--color-neutral-300)] hover:bg-[var(--color-neutral-100)]"
                        >
                          Open ↗
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
