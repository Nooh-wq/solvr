import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { withRls } from "@/lib/db";
import { systemContext, listGroups, listTeamMembersInGroup } from "@/lib/shared-platform";
import { getAgentLoadSnapshot } from "@/lib/routing";

// M3 admin surface. Read-only overview: per-group snapshot of agents
// with their skills, capacity, current open count, and availability.
// The mutations (skills, maxOpen, isAvailable) live on each team
// member's detail page — this page just aggregates the picture so an
// admin can spot "why isn't routing picking anyone?" at a glance.

export default async function RoutingPage() {
  const session = await requireSession({ minRole: "ADMIN" });
  const ctx = systemContext(session.tenantId);
  const groups = await listGroups(ctx);

  // Parallel snapshot per group. Each snapshot is one groupBy + one
  // findMany — cheap. Small tenants have <10 groups; larger ones we'd
  // paginate, but that's out of scope here.
  const groupSnapshots = await Promise.all(
    groups.map(async (g) => {
      const [members, snapshot] = await Promise.all([
        listTeamMembersInGroup(ctx, g.id),
        getAgentLoadSnapshot({
          session: {
            tenantId: session.tenantId,
            subjectId: session.subjectId,
            role: session.role,
          },
          groupId: g.id,
        }),
      ]);
      const byMember = new Map(members.map((m) => [m.id, m]));
      return {
        group: g,
        rows: snapshot.map((s) => {
          const m = byMember.get(s.teamMemberId);
          return {
            ...s,
            name: m?.name ?? m?.email ?? s.teamMemberId,
            email: m?.email ?? "",
          };
        }),
      };
    })
  );

  // Lifecycle status is needed to explain "deactivated → excluded".
  // Pulled in one batch across every visible team member.
  const allMemberIds = groupSnapshots.flatMap((s) => s.rows.map((r) => r.teamMemberId));
  const lifecycles = await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    (tx) =>
      tx.teamMemberLifecycle.findMany({
        where: { subjectId: { in: allMemberIds } },
        select: { subjectId: true, status: true },
      })
  );
  const statusById = new Map(lifecycles.map((l) => [l.subjectId, l.status]));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-[var(--foreground)]">Routing</h1>
        <p className="mt-2 text-[13px] text-[var(--color-neutral-600)] max-w-2xl">
          Snapshot of every group&apos;s agents — skills, capacity, current
          load, and availability. Auto-routing (Escalation Paths + rule
          actions) picks from this pool using round-robin, load-based, or
          skills-based strategies. Configure per-agent details on their{" "}
          <Link href="/admin/team-members" className="underline hover:text-[var(--foreground)]">
            team member profile
          </Link>
          .
        </p>
      </div>

      {groupSnapshots.length === 0 ? (
        <div className="rounded-2xl border border-[var(--color-neutral-300)] bg-[var(--color-surface)] p-6 text-[13px] text-[var(--color-neutral-600)]">
          No groups defined yet. Create one under{" "}
          <Link href="/admin/groups" className="underline hover:text-[var(--foreground)]">
            Groups
          </Link>{" "}
          before configuring routing.
        </div>
      ) : (
        groupSnapshots.map(({ group, rows }) => (
          <div
            key={group.id}
            className="rounded-2xl border border-[var(--color-neutral-300)] bg-[var(--color-surface)] overflow-hidden"
          >
            <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--color-neutral-200)]">
              <div>
                <h2 className="text-sm font-semibold">{group.name}</h2>
                <p className="text-[11px] text-[var(--color-neutral-500)]">
                  {rows.length} {rows.length === 1 ? "agent" : "agents"} in this group
                </p>
              </div>
              <Link
                href={`/admin/groups/${group.id}`}
                className="text-[12px] text-[var(--color-neutral-500)] hover:text-[var(--foreground)]"
              >
                Edit group →
              </Link>
            </div>
            {rows.length === 0 ? (
              <div className="px-5 py-6 text-[13px] text-[var(--color-neutral-500)] italic">
                No members. Routing to this group will fail.
              </div>
            ) : (
              <table className="w-full text-[13px]">
                <thead className="text-[11px] uppercase tracking-wide text-[var(--color-neutral-500)] bg-[var(--color-neutral-100)]/50">
                  <tr>
                    <th className="text-left px-5 py-2 font-medium">Agent</th>
                    <th className="text-left px-5 py-2 font-medium">Availability</th>
                    <th className="text-left px-5 py-2 font-medium">Skills</th>
                    <th className="text-left px-5 py-2 font-medium">Load</th>
                    <th className="text-left px-5 py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const status = statusById.get(r.teamMemberId) ?? "ACTIVE";
                    const isCapped = r.maxOpen > 0 && r.openCount >= r.maxOpen;
                    const routable = r.isAvailable && status === "ACTIVE" && !isCapped;
                    return (
                      <tr
                        key={r.teamMemberId}
                        className="border-t border-[var(--color-neutral-200)]"
                      >
                        <td className="px-5 py-2.5">
                          <Link
                            href={`/admin/users/${r.teamMemberId}`}
                            className="hover:underline"
                          >
                            <div className="font-medium">{r.name}</div>
                            {r.email && r.email !== r.name && (
                              <div className="text-[11px] text-[var(--color-neutral-500)]">
                                {r.email}
                              </div>
                            )}
                          </Link>
                        </td>
                        <td className="px-5 py-2.5">
                          <span
                            className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] ${
                              r.isAvailable
                                ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30"
                                : "bg-[var(--color-neutral-100)] text-[var(--color-neutral-600)] border-[var(--color-neutral-300)]"
                            }`}
                          >
                            <span
                              className={`h-1.5 w-1.5 rounded-full ${
                                r.isAvailable ? "bg-emerald-500" : "bg-[var(--color-neutral-400)]"
                              }`}
                            />
                            {r.isAvailable ? "Available" : "Away"}
                          </span>
                        </td>
                        <td className="px-5 py-2.5">
                          {r.skills.length === 0 ? (
                            <span className="text-[12px] text-[var(--color-neutral-500)] italic">
                              None
                            </span>
                          ) : (
                            <div className="flex flex-wrap gap-1">
                              {r.skills.map((s) => (
                                <span
                                  key={s}
                                  className="rounded-full border border-[var(--color-neutral-300)] bg-[var(--color-neutral-100)] px-1.5 py-0.5 text-[10px]"
                                >
                                  {s}
                                </span>
                              ))}
                            </div>
                          )}
                        </td>
                        <td className="px-5 py-2.5">
                          <span className={isCapped ? "text-red-600 font-medium" : ""}>
                            {r.openCount}
                            {r.maxOpen > 0 ? ` / ${r.maxOpen}` : ""}
                          </span>
                        </td>
                        <td className="px-5 py-2.5">
                          {routable ? (
                            <span className="text-[11px] text-[var(--color-neutral-500)]">
                              Routable
                            </span>
                          ) : (
                            <span className="text-[11px] text-amber-700 dark:text-amber-300">
                              {!r.isAvailable
                                ? "Away"
                                : status !== "ACTIVE"
                                  ? `Excluded (${status.toLowerCase()})`
                                  : "At capacity"}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        ))
      )}
    </div>
  );
}
