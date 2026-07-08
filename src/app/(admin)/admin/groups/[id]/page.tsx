import Link from "next/link";
import { notFound } from "next/navigation";
import { loadGroupDetail, listAssignableTeamMembersForGroup } from "@/actions/groups";
import { GroupMembersPanel } from "./members-panel";

// Z4.3 — Group detail. Members with scope + open-ticket count each,
// group-level stats row.

const SCOPE_LABEL: Record<string, string> = {
  ALL: "All tickets",
  GROUPS: "Their groups",
  ASSIGNED_ONLY: "Assigned only",
};

export default async function GroupDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const group = await loadGroupDetail(id);
  if (!group) notFound();

  const assignable = await listAssignableTeamMembersForGroup(id);
  void SCOPE_LABEL; // used inside members panel

  return (
    <div>
      <div className="mb-4 text-[12px] text-[var(--color-neutral-500)]">
        <Link href="/admin/groups" className="hover:text-[var(--foreground)]">
          ← Back to groups
        </Link>
      </div>

      <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-6 mb-6">
        <div className="flex items-start gap-4">
          <div className="h-16 w-16 rounded-2xl bg-[var(--color-primary)]/10 text-[var(--color-primary)] text-2xl font-semibold flex items-center justify-center">
            {group.name.slice(0, 2).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold">{group.name}</h1>
              {group.isDefault && (
                <span className="px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-700 dark:text-blue-300 text-[10px] font-semibold">
                  DEFAULT
                </span>
              )}
            </div>
            <p className="text-[12px] text-[var(--color-neutral-500)] mt-1">
              Team members in this group can be assigned tickets. Scope enforcement lands in Z5.
            </p>
          </div>
          <div className="text-right text-[12px] text-[var(--color-neutral-500)] space-y-0.5">
            <div>
              <span className="text-[var(--color-neutral-600)] font-medium">{group.members.length}</span> members
            </div>
            <div>
              <span className="text-[var(--color-neutral-600)] font-medium">{group.openTicketCount}</span> open tickets
            </div>
            {group.avgFirstResponseHours !== null && (
              <div>
                Avg first response <span className="text-[var(--color-neutral-600)] font-medium">{group.avgFirstResponseHours.toFixed(1)}h</span>
              </div>
            )}
          </div>
        </div>
      </div>

      <GroupMembersPanel
        groupId={group.id}
        groupName={group.name}
        members={group.members}
        assignable={assignable}
      />
    </div>
  );
}
