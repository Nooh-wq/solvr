import { listRecentLoginActivity } from "@/actions/adminPeople";
import { EmptyState } from "@/components/empty-state";

export const dynamic = "force-dynamic";

export default async function LoginActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  const sp = await searchParams;
  const days = Math.min(Math.max(parseInt(sp.days ?? "30", 10) || 30, 1), 90);
  const rows = await listRecentLoginActivity({ days, limit: 300 });

  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <h1 className="text-2xl font-bold">Login activity</h1>
        <div className="flex gap-1">
          {[7, 30, 90].map((d) => (
            <a
              key={d}
              href={`?days=${d}`}
              className={`text-[12px] px-3 py-1 rounded-lg border ${
                d === days
                  ? "bg-[var(--color-neutral-900)] text-[var(--color-neutral-100)] border-transparent"
                  : "border-[var(--color-neutral-300)] hover:bg-[var(--color-neutral-100)]"
              }`}
            >
              Last {d} days
            </a>
          ))}
        </div>
      </div>
      <p className="text-sm text-[var(--color-neutral-600)] mb-6">
        Successful logins across all users in your workspace, most recent first.
      </p>

      {rows.length === 0 ? (
        <EmptyState
          title="No logins in this window"
          description="Widen the window or check back after your team signs in."
        />
      ) : (
        <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[var(--color-light-gray)] text-[11px] uppercase-label text-[var(--color-neutral-700)]">
                <tr>
                  <th className="text-left font-semibold px-4 py-2.5">When</th>
                  <th className="text-left font-semibold px-4 py-2.5">Person</th>
                  <th className="text-left font-semibold px-4 py-2.5">Kind</th>
                  <th className="text-left font-semibold px-4 py-2.5">IP</th>
                  <th className="text-left font-semibold px-4 py-2.5">Country</th>
                  <th className="text-left font-semibold px-4 py-2.5">Device</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-[var(--color-neutral-100)]">
                    <td className="px-4 py-3 text-[var(--color-neutral-600)] font-mono text-[12px]">
                      {new Date(r.createdAt).toLocaleString()}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium">{r.subjectName}</div>
                      <div className="text-[12px] text-[var(--color-neutral-500)]">{r.subjectEmail}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-[11px] uppercase-label px-2 py-0.5 rounded-full bg-[var(--color-neutral-100)]">
                        {r.subjectKind === "team_member" ? "Staff" : "Customer"}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-[12px]">{r.ipAddress ?? "—"}</td>
                    <td className="px-4 py-3 font-mono text-[12px]">{r.country ?? "—"}</td>
                    <td className="px-4 py-3 text-[12px] text-[var(--color-neutral-600)] max-w-[260px] truncate">
                      {r.userAgent ?? "—"}
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
