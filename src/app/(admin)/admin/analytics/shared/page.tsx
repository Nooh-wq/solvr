import Link from "next/link";
import { listSavedReports } from "@/actions/reports";
import { EmptyState } from "@/components/empty-state";

export const dynamic = "force-dynamic";

/**
 * Shared reports = SavedReports with one or more recipients + a schedule.
 * We don't invent a separate "share links" concept — a saved report that
 * emails a snapshot to teammates or execs on a cadence is *the* sharing
 * primitive in this system. Read-only public share URLs are still
 * generated inline on the analytics page via createShareLink().
 */
export default async function SharedReportsPage() {
  const reports = await listSavedReports();
  const shared = reports.filter((r) => r.recipientEmails.length > 0 || r.scheduleFrequency !== "NONE");

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">Shared reports</h1>
      <p className="text-sm text-[var(--color-neutral-600)] mb-6 max-w-2xl">
        Saved reports that email their contents to teammates on a schedule. Add recipients or a
        cadence on any report under <Link href="/admin/reports" className="underline">Custom reports</Link>{" "}
        to see it here. For one-off read-only public links, use the &ldquo;Share&rdquo; button on{" "}
        <Link href="/admin/analytics" className="underline">Analytics</Link>.
      </p>

      {shared.length === 0 ? (
        <EmptyState
          title="No shared reports yet"
          description="Add a recipient or schedule to a saved report to have it delivered automatically."
          primaryCta={{ label: "Create a report", href: "/admin/reports" }}
          secondaryCta={{ label: "Open analytics", href: "/admin/analytics" }}
        />
      ) : (
        <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-[var(--color-light-gray)] text-[11px] uppercase-label text-[var(--color-neutral-700)]">
              <tr>
                <th className="text-left font-semibold px-4 py-2.5">Report</th>
                <th className="text-left font-semibold px-4 py-2.5">Recipients</th>
                <th className="text-left font-semibold px-4 py-2.5">Cadence</th>
                <th className="text-left font-semibold px-4 py-2.5">Next run</th>
                <th className="text-left font-semibold px-4 py-2.5">Last sent</th>
                <th className="text-right font-semibold px-4 py-2.5">Manage</th>
              </tr>
            </thead>
            <tbody>
              {shared.map((r) => (
                <tr key={r.id} className="border-t border-[var(--color-neutral-100)]">
                  <td className="px-4 py-3">
                    <div className="font-medium">{r.name}</div>
                    {r.description ? (
                      <div className="text-[12px] text-[var(--color-neutral-500)]">{r.description}</div>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-[12px] text-[var(--color-neutral-600)]">
                    {r.recipientEmails.length === 0
                      ? "—"
                      : r.recipientEmails.length <= 2
                        ? r.recipientEmails.join(", ")
                        : `${r.recipientEmails[0]} + ${r.recipientEmails.length - 1} more`}
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-[11px] uppercase-label px-2 py-0.5 rounded-full bg-[var(--color-neutral-100)]">
                      {r.scheduleFrequency}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-[var(--color-neutral-600)] font-mono text-[12px]">
                    {r.nextRunAt ? new Date(r.nextRunAt).toLocaleString() : "—"}
                  </td>
                  <td className="px-4 py-3 text-[var(--color-neutral-600)] font-mono text-[12px]">
                    {r.lastRunAt ? new Date(r.lastRunAt).toLocaleString() : "—"}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href="/admin/reports"
                      className="text-[12px] font-medium px-3 py-1.5 rounded-lg border border-[var(--color-neutral-300)] hover:bg-[var(--color-neutral-100)]"
                    >
                      Edit
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
