"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { InviteUserForm } from "./invite-user-form";
import { TeamTable } from "./team-table";
import { TeamFilterBar, type RoleFilter, type StatusFilter } from "./team-filter-bar";
import { BulkActionBar } from "./bulk-action-bar";
import { useTeamSelection } from "./hooks/use-team-selection";
import { bulkChangeRole, bulkDeactivate, bulkExport } from "@/actions/admin";
import type { UserStatus } from "@/generated/prisma";
import type { UserRole as Role } from "@/lib/auth";

export type TeamMember = {
  id: string;
  name: string;
  email: string;
  role: Role;
  status: UserStatus;
  company: string | null;
  lastActiveAt: string | null;
  isLastSuperAdmin: boolean;
};
type AssignableRole = "CLIENT" | "AGENT" | "ADMIN";

// PENDING rows always float to the top so approvals never get buried under
// the active team (spec §5.4). Otherwise sort by the selected column.
const STATUS_SORT_PRIORITY: Record<UserStatus, number> = {
  PENDING: 0,
  INVITED: 1,
  ACTIVE: 2,
  SUSPENDED: 3,
  REJECTED: 4,
  UNVERIFIED: 5,
};

type SortKey = "name" | "lastActiveAt";
type SortDir = "asc" | "desc";

export function TeamDirectory({ users }: { users: TeamMember[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [role, setRole] = useState<RoleFilter>("ALL");
  const [status, setStatus] = useState<StatusFilter>("ALL");
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [bulkPending, startBulkTransition] = useTransition();

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users.filter(
      (u) =>
        (role === "ALL" || u.role === role) &&
        (status === "ALL" || u.status === status) &&
        (q === "" || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q))
    );
  }, [users, role, status, search]);

  // Client-side sort — fine for the current tenant sizes (dozens of rows).
  // If the team grows past ~500 this should move to server-side ORDER BY
  // via query params, per spec §6.
  const sorted = useMemo(() => {
    const rows = [...filtered];
    rows.sort((a, b) => {
      const statusDelta = STATUS_SORT_PRIORITY[a.status] - STATUS_SORT_PRIORITY[b.status];
      if (statusDelta !== 0) return statusDelta;

      let cmp = 0;
      if (sortKey === "name") {
        cmp = a.name.localeCompare(b.name);
      } else {
        // Nulls last regardless of asc/desc — a never-active row shouldn't
        // sort ahead of an actively-recent one just because it's "smaller".
        const aTime = a.lastActiveAt ? new Date(a.lastActiveAt).getTime() : null;
        const bTime = b.lastActiveAt ? new Date(b.lastActiveAt).getTime() : null;
        if (aTime === null && bTime === null) cmp = 0;
        else if (aTime === null) cmp = 1;
        else if (bTime === null) cmp = -1;
        else cmp = aTime - bTime;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return rows;
  }, [filtered, sortKey, sortDir]);

  const selectableIds = useMemo(
    () => sorted.filter((u) => u.status === "ACTIVE" || u.status === "SUSPENDED").map((u) => u.id),
    [sorted]
  );
  const selection = useTeamSelection(selectableIds);

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  function summarize(actionLabel: string, succeededCount: number, failed: { userId: string; reason: string }[]) {
    if (failed.length === 0) {
      toast({ title: `${actionLabel} — ${succeededCount} updated`, variant: "success" });
      return;
    }
    // Group reasons so the summary is legible even when 3 rows fail for
    // the same reason ("last Super Admin" is a common one to hit twice).
    const reasonCounts = new Map<string, number>();
    for (const f of failed) reasonCounts.set(f.reason, (reasonCounts.get(f.reason) ?? 0) + 1);
    const reasonSummary = [...reasonCounts.entries()].map(([r, n]) => (n === 1 ? r : `${r} (${n})`)).join("; ");
    toast({
      title: `${actionLabel} — ${succeededCount} of ${succeededCount + failed.length}`,
      description: `${failed.length} skipped: ${reasonSummary}`,
      variant: succeededCount === 0 ? "error" : "success",
    });
  }

  function handleBulkChangeRole(newRole: AssignableRole) {
    const userIds = [...selection.selected];
    if (userIds.length === 0) return;
    startBulkTransition(async () => {
      try {
        const result = await bulkChangeRole({ userIds, role: newRole });
        summarize(`Role → ${newRole.toLowerCase()}`, result.succeeded.length, result.failed);
        selection.clear();
        router.refresh();
      } catch (e) {
        toast({ title: "Bulk role change failed", description: e instanceof Error ? e.message : undefined, variant: "error" });
      }
    });
  }

  function handleBulkDeactivate() {
    const userIds = [...selection.selected];
    if (userIds.length === 0) return;
    startBulkTransition(async () => {
      try {
        const result = await bulkDeactivate({ userIds });
        summarize("Deactivated", result.succeeded.length, result.failed);
        selection.clear();
        router.refresh();
      } catch (e) {
        toast({ title: "Bulk deactivate failed", description: e instanceof Error ? e.message : undefined, variant: "error" });
      }
    });
  }

  function handleBulkExport() {
    const userIds = [...selection.selected];
    if (userIds.length === 0) return;
    startBulkTransition(async () => {
      const result = await bulkExport({ userIds });
      if (!result.ok) {
        toast({ title: "Export failed", description: result.error, variant: "error" });
        return;
      }
      // Trigger a client-side download of the CSV the server built. Uses a
      // Blob + object URL rather than a data URI so large exports don't hit
      // the browser's URL-length ceiling; revoked on next tick to free memory.
      const blob = new Blob([result.csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = result.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
      toast({ title: `Exported ${userIds.length} row${userIds.length === 1 ? "" : "s"}`, variant: "success" });
    });
  }

  return (
    <div>
      <TeamFilterBar
        search={search}
        onSearchChange={setSearch}
        role={role}
        onRoleChange={setRole}
        status={status}
        onStatusChange={setStatus}
        filteredCount={sorted.length}
        totalCount={users.length}
        onOpenInvite={() => setInviteOpen(true)}
      />

      <BulkActionBar
        count={selection.count}
        onClear={selection.clear}
        onChangeRole={handleBulkChangeRole}
        onDeactivate={handleBulkDeactivate}
        onExport={handleBulkExport}
        disabled={bulkPending}
      />

      {sorted.length === 0 ? (
        <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-10 text-center text-sm text-[var(--color-neutral-600)]">
          No team members match these filters.
        </div>
      ) : (
        <TeamTable
          users={sorted}
          selectableIds={selectableIds}
          selected={selection.selected}
          allSelected={selection.allSelected}
          onToggle={selection.toggle}
          onToggleAll={selection.toggleAll}
          sortKey={sortKey}
          sortDir={sortDir}
          onSort={toggleSort}
        />
      )}

      <Modal open={inviteOpen} onClose={() => setInviteOpen(false)} title="Invite someone">
        <InviteUserForm embedded />
      </Modal>
    </div>
  );
}
