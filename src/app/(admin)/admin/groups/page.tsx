import Link from "next/link";
import { listGroupsWithStats } from "@/actions/groups";
import { CreateGroupButton } from "./create-group-button";

// Z4.3 — Groups list. Simpler than orgs: name, member count, open
// tickets, avg first response. Detail page handles editing.

export default async function GroupsPage() {
  const groups = await listGroupsWithStats();
  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Groups</h1>
        <CreateGroupButton />
      </div>

      {groups.length === 0 ? (
        <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-10 text-center text-sm text-[var(--color-neutral-600)]">
          No groups yet. Every tenant is seeded with a default &quot;Support&quot; group during setup.
        </div>
      ) : (
        <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[12px] text-[var(--color-neutral-600)] bg-[var(--color-light-gray)]/60">
                <th className="px-4 py-2 font-medium">Group</th>
                <th className="px-4 py-2 font-medium">Members</th>
                <th className="px-4 py-2 font-medium">Open tickets</th>
                <th className="px-4 py-2 font-medium">Avg first response</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <tr
                  key={g.id}
                  className="border-t border-[var(--color-neutral-200)] dark:border-white/5 hover:bg-[var(--color-light-gray)]/40 transition-colors"
                >
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/groups/${g.id}`}
                      className="text-[13px] font-medium hover:text-[var(--color-primary)] inline-flex items-center gap-2"
                    >
                      {g.name}
                      {g.isDefault && (
                        <span className="px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-700 dark:text-blue-300 text-[10px] font-semibold">
                          DEFAULT
                        </span>
                      )}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-[13px] tabular-nums">{g.memberCount}</td>
                  <td className="px-4 py-3 text-[13px] tabular-nums">{g.openTicketCount}</td>
                  <td className="px-4 py-3 text-[13px] tabular-nums">
                    {g.avgFirstResponseHours === null ? (
                      <span className="text-[var(--color-neutral-400)]">—</span>
                    ) : (
                      `${g.avgFirstResponseHours.toFixed(1)}h`
                    )}
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
