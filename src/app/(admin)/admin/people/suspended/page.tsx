import { listSuspendedUsers } from "@/actions/adminPeople";
import { EmptyState } from "@/components/empty-state";
import { SuspendedActions } from "./suspended-actions";

export const dynamic = "force-dynamic";

export default async function SuspendedUsersPage() {
  const rows = await listSuspendedUsers();

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">Suspended users</h1>
      <p className="text-sm text-[var(--color-neutral-600)] mb-6">
        Deactivated accounts. Their tickets stay on record, but they can&apos;t log in until reactivated.
      </p>

      {rows.length === 0 ? (
        <EmptyState
          title="No suspended users"
          description="Users you deactivate from the People section will appear here so you can bring them back later."
          primaryCta={{ label: "View team members", href: "/admin/team-members" }}
        />
      ) : (
        <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-[var(--color-light-gray)] text-[11px] uppercase-label text-[var(--color-neutral-700)]">
              <tr>
                <th className="text-left font-semibold px-4 py-2.5">Person</th>
                <th className="text-left font-semibold px-4 py-2.5">Role</th>
                <th className="text-left font-semibold px-4 py-2.5">Last active</th>
                <th className="text-left font-semibold px-4 py-2.5">Suspended</th>
                <th className="text-right font-semibold px-4 py-2.5">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-[var(--color-neutral-100)]">
                  <td className="px-4 py-3">
                    <div className="font-medium">{r.name}</div>
                    <div className="text-[12px] text-[var(--color-neutral-500)]">{r.email}</div>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-[11px] uppercase-label px-2 py-0.5 rounded-full bg-[var(--color-neutral-100)]">
                      {r.role}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-[var(--color-neutral-600)] font-mono text-[12px]">
                    {r.lastActiveAt ? new Date(r.lastActiveAt).toLocaleString() : "—"}
                  </td>
                  <td className="px-4 py-3 text-[var(--color-neutral-600)] font-mono text-[12px]">
                    {r.suspendedAt ? new Date(r.suspendedAt).toLocaleString() : "—"}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <SuspendedActions userId={r.id} email={r.email} />
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
