"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  updateUser,
  deleteUser,
  resendInvite,
  revokeInvite,
  reinviteUser,
  approveUser,
  rejectUser,
} from "@/actions/admin";
import { Select } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { getAvailableActions } from "@/lib/team-matrix";
import { RoleBadge } from "./role-badge";
import { StatusIndicator } from "./status-indicator";
import { RowActionsMenu, type RowMenuItem } from "./row-actions-menu";
import { Avatar } from "@/components/ui/avatar";
import type { TeamMember } from "./team-directory";

type AssignableRole = "CLIENT" | "AGENT" | "ADMIN";
type SortKey = "name" | "lastActiveAt";
type SortDir = "asc" | "desc";

function fmtLastActive(iso: string | null): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffMs = now - then;
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diffMs < minute) return "just now";
  if (diffMs < hour) return `${Math.floor(diffMs / minute)}m ago`;
  if (diffMs < day) return `${Math.floor(diffMs / hour)}h ago`;
  if (diffMs < 30 * day) return `${Math.floor(diffMs / day)}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function SortHeader({
  label,
  sk,
  active,
  dir,
  onClick,
}: {
  label: string;
  sk: SortKey;
  active: boolean;
  dir: SortDir;
  onClick: (sk: SortKey) => void;
}) {
  return (
    <th
      onClick={() => onClick(sk)}
      className="text-left font-semibold px-4 py-2.5 cursor-pointer select-none hover:text-[var(--foreground)]"
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {active && <span className="text-[var(--color-neutral-400)]">{dir === "asc" ? "▴" : "▾"}</span>}
      </span>
    </th>
  );
}

export function TeamTable({
  users,
  selectableIds,
  selected,
  allSelected,
  onToggle,
  onToggleAll,
  sortKey,
  sortDir,
  onSort,
}: {
  users: TeamMember[];
  selectableIds: string[];
  selected: Set<string>;
  allSelected: boolean;
  onToggle: (id: string) => void;
  onToggleAll: () => void;
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (sk: SortKey) => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [deletePending, startDeleteTransition] = useTransition();
  const [toDelete, setToDelete] = useState<TeamMember | null>(null);

  function changeRole(userId: string, name: string, role: AssignableRole) {
    startTransition(async () => {
      try {
        await updateUser({ userId, role });
        toast({ title: "Role updated", description: `${name} is now ${role.toLowerCase()}`, variant: "success" });
        router.refresh();
      } catch (e) {
        toast({ title: "Couldn't update role", description: e instanceof Error ? e.message : undefined, variant: "error" });
      }
    });
  }

  function deactivate(userId: string, name: string) {
    startTransition(async () => {
      try {
        await updateUser({ userId, status: "SUSPENDED" });
        toast({ title: "User deactivated", description: name, variant: "success" });
        router.refresh();
      } catch (e) {
        toast({ title: "Couldn't deactivate", description: e instanceof Error ? e.message : undefined, variant: "error" });
      }
    });
  }

  function reactivate(userId: string, name: string) {
    startTransition(async () => {
      try {
        await updateUser({ userId, status: "ACTIVE" });
        toast({ title: "User reactivated", description: name, variant: "success" });
        router.refresh();
      } catch (e) {
        toast({ title: "Couldn't reactivate", description: e instanceof Error ? e.message : undefined, variant: "error" });
      }
    });
  }

  function resend(userId: string, name: string) {
    startTransition(async () => {
      const result = await resendInvite({ userId });
      if (result.ok) {
        toast({ title: "Invite resent", description: name, variant: "success" });
        router.refresh();
      } else {
        toast({ title: "Couldn't resend invite", description: result.error, variant: "error" });
      }
    });
  }

  function revoke(userId: string, name: string) {
    startTransition(async () => {
      const result = await revokeInvite({ userId });
      if (result.ok) {
        toast({ title: "Invite revoked", description: name, variant: "success" });
        router.refresh();
      } else {
        toast({ title: "Couldn't revoke invite", description: result.error, variant: "error" });
      }
    });
  }

  function reinvite(userId: string, name: string) {
    startTransition(async () => {
      const result = await reinviteUser({ userId });
      if (result.ok) {
        toast({ title: "Invite sent", description: name, variant: "success" });
        router.refresh();
      } else {
        toast({ title: "Couldn't re-invite", description: result.error, variant: "error" });
      }
    });
  }

  function approve(userId: string, name: string) {
    startTransition(async () => {
      try {
        await approveUser({ userId });
        toast({ title: "Registration approved", description: name, variant: "success" });
        router.refresh();
      } catch (e) {
        toast({ title: "Couldn't approve", description: e instanceof Error ? e.message : undefined, variant: "error" });
      }
    });
  }

  function reject(userId: string, name: string) {
    startTransition(async () => {
      try {
        await rejectUser({ userId });
        toast({ title: "Registration rejected", description: name, variant: "success" });
        router.refresh();
      } catch (e) {
        toast({ title: "Couldn't reject", description: e instanceof Error ? e.message : undefined, variant: "error" });
      }
    });
  }

  function confirmDelete() {
    if (!toDelete) return;
    const { id, name } = toDelete;
    startDeleteTransition(async () => {
      const result = await deleteUser({ userId: id });
      if (result.ok) {
        toast({ title: "Person deleted", description: name, variant: "success" });
        setToDelete(null);
        router.refresh();
      } else {
        toast({ title: "Couldn't delete", description: result.error, variant: "error" });
      }
    });
  }

  return (
    <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-[var(--color-light-gray)] text-[11px] uppercase-label text-[var(--color-neutral-700)]">
            <tr>
              <th className="w-10 px-4 py-2.5">
                <input
                  type="checkbox"
                  aria-label={allSelected ? "Deselect all" : "Select all"}
                  checked={allSelected}
                  disabled={selectableIds.length === 0}
                  onChange={onToggleAll}
                  className="h-4 w-4 accent-[var(--color-primary)] cursor-pointer"
                />
              </th>
              <SortHeader label="Name" sk="name" active={sortKey === "name"} dir={sortDir} onClick={onSort} />
              <th className="text-left font-semibold px-4 py-2.5">Company</th>
              <th className="text-left font-semibold px-4 py-2.5">Role</th>
              <th className="text-left font-semibold px-4 py-2.5">Status</th>
              <SortHeader
                label="Last active"
                sk="lastActiveAt"
                active={sortKey === "lastActiveAt"}
                dir={sortDir}
                onClick={onSort}
              />
              <th className="text-left font-semibold px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const actions = getAvailableActions(u.status, { isLastSuperAdmin: u.isLastSuperAdmin });
              const canChangeRole = actions.includes("changeRole");
              const canDelete = actions.includes("delete");
              const selectable = selectableIds.includes(u.id);
              const isSelected = selected.has(u.id);

              const menuItems: RowMenuItem[] = [];
              if (actions.includes("resendInvite")) menuItems.push({ label: "Resend invite", onSelect: () => resend(u.id, u.name) });
              if (actions.includes("revokeInvite")) menuItems.push({ label: "Revoke invite", onSelect: () => revoke(u.id, u.name), danger: true });
              if (canDelete) menuItems.push({ label: "Delete", onSelect: () => setToDelete(u), danger: true });

              return (
                <tr key={u.id} className="border-t border-[var(--color-neutral-100)] hover:bg-black/[0.015] dark:hover:bg-white/[0.02]">
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      aria-label={`Select ${u.name}`}
                      checked={isSelected}
                      disabled={!selectable}
                      onChange={() => onToggle(u.id)}
                      className="h-4 w-4 accent-[var(--color-primary)] cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                    />
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <div className="flex items-center gap-3 min-w-0">
                      <Avatar name={u.name} seed={u.id} size="md" />
                      <div className="min-w-0">
                        <p className="font-semibold text-[13px] leading-tight truncate">{u.name}</p>
                        <p className="text-[12px] text-[var(--color-neutral-500)] leading-tight truncate">{u.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-[13px] text-[var(--color-neutral-600)] whitespace-nowrap">
                    {u.company ?? <span className="text-[var(--color-neutral-400)]">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    {canChangeRole ? (
                      <Select
                        value={u.role}
                        disabled={pending}
                        onChange={(e) => changeRole(u.id, u.name, e.target.value as AssignableRole)}
                        className="h-8 text-[13px] w-32"
                      >
                        <option value="CLIENT">Client</option>
                        <option value="AGENT">Agent</option>
                        <option value="ADMIN">Admin</option>
                      </Select>
                    ) : (
                      <span title={u.isLastSuperAdmin ? "Last Super Admin — role locked" : undefined}>
                        <RoleBadge role={u.role} />
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <StatusIndicator status={u.status} />
                  </td>
                  <td className="px-4 py-3 text-[var(--color-neutral-600)] whitespace-nowrap text-[12px]">
                    {fmtLastActive(u.lastActiveAt)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      {/* Inline primary/secondary actions per §6: PENDING gets
                          Approve/Reject as prominent buttons (not hidden in
                          the kebab); ACTIVE/SUSPENDED get Deactivate/
                          Reactivate inline; REJECTED gets Re-invite inline.
                          Delete + Resend/Revoke live only in the kebab. */}
                      {actions.includes("approve") && (
                        <Button size="sm" disabled={pending} onClick={() => approve(u.id, u.name)}>
                          Approve
                        </Button>
                      )}
                      {actions.includes("reject") && (
                        <Button variant="secondary" size="sm" disabled={pending} onClick={() => reject(u.id, u.name)}>
                          Reject
                        </Button>
                      )}
                      {actions.includes("deactivate") && (
                        <Button variant="secondary" size="sm" disabled={pending} onClick={() => deactivate(u.id, u.name)}>
                          Deactivate
                        </Button>
                      )}
                      {actions.includes("reactivate") && (
                        <Button variant="secondary" size="sm" disabled={pending} onClick={() => reactivate(u.id, u.name)}>
                          Reactivate
                        </Button>
                      )}
                      {actions.includes("reinvite") && (
                        <Button size="sm" disabled={pending} onClick={() => reinvite(u.id, u.name)}>
                          Re-invite
                        </Button>
                      )}
                      {menuItems.length > 0 && <RowActionsMenu items={menuItems} ariaLabel={`Actions for ${u.name}`} />}
                      {actions.length === 0 && (
                        <span className="text-[12px] text-[var(--color-neutral-500)] italic">
                          {u.isLastSuperAdmin ? "Last Super Admin — locked" : "—"}
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Modal open={toDelete !== null} onClose={() => setToDelete(null)} title="Delete this person?">
        <p className="text-[13px] text-[var(--color-neutral-600)] mb-4">
          This permanently removes <span className="font-semibold text-[var(--foreground)]">{toDelete?.name}</span> ({toDelete?.email}). This
          can&apos;t be undone. If they have ticket history on record, deleting will fail — deactivate them instead.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setToDelete(null)} disabled={deletePending}>
            Cancel
          </Button>
          <Button variant="danger" onClick={confirmDelete} disabled={deletePending}>
            {deletePending ? "Deleting…" : "Delete"}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
