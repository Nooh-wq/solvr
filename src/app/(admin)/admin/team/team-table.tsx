"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateUser, deleteUser, resendInvite, revokeInvite, reinviteUser } from "@/actions/admin";
import { Select } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { TrashIcon } from "@/components/icons";
import { getAvailableActions } from "@/lib/team-matrix";
import type { Role, UserStatus } from "@/generated/prisma";

type TeamMember = {
  id: string;
  name: string;
  email: string;
  role: Role;
  status: UserStatus;
  isLastSuperAdmin: boolean;
};
type AssignableRole = "CLIENT" | "AGENT" | "ADMIN";

const STATUS_LABEL: Record<UserStatus, string> = {
  UNVERIFIED: "Unverified",
  PENDING: "Pending approval",
  ACTIVE: "Active",
  REJECTED: "Rejected",
  SUSPENDED: "Deactivated",
  INVITED: "Invite sent",
};

export function TeamTable({ users }: { users: TeamMember[] }) {
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
            <th className="text-left font-semibold px-4 py-2.5">Name</th>
            <th className="text-left font-semibold px-4 py-2.5">Email</th>
            <th className="text-left font-semibold px-4 py-2.5">Role</th>
            <th className="text-left font-semibold px-4 py-2.5">Status</th>
            <th className="text-left font-semibold px-4 py-2.5"></th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => {
            const actions = getAvailableActions(u.status, { isLastSuperAdmin: u.isLastSuperAdmin });
            const canChangeRole = actions.includes("changeRole");
            const canDelete = actions.includes("delete");
            return (
              <tr key={u.id} className="border-t border-[var(--color-neutral-100)]">
                <td className="px-4 py-3 whitespace-nowrap">{u.name}</td>
                <td className="px-4 py-3 text-[var(--color-neutral-600)] whitespace-nowrap">{u.email}</td>
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
                    // Super Admin is not in the assignable-role select (can't
                    // be assigned via UI — only the tenant-provisioning flow
                    // sets it). We just render its label for the row.
                    <span
                      className="text-[13px] text-[var(--color-neutral-700)]"
                      title={u.isLastSuperAdmin ? "Last Super Admin — role locked" : undefined}
                    >
                      {u.role === "SUPER_ADMIN" ? "Super admin" : u.role.charAt(0) + u.role.slice(1).toLowerCase()}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3">{STATUS_LABEL[u.status]}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
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
                    {actions.includes("resendInvite") && (
                      <Button variant="secondary" size="sm" disabled={pending} onClick={() => resend(u.id, u.name)}>
                        Resend invite
                      </Button>
                    )}
                    {actions.includes("revokeInvite") && (
                      <Button variant="secondary" size="sm" disabled={pending} onClick={() => revoke(u.id, u.name)}>
                        Revoke invite
                      </Button>
                    )}
                    {actions.includes("reinvite") && (
                      <Button size="sm" disabled={pending} onClick={() => reinvite(u.id, u.name)}>
                        Re-invite
                      </Button>
                    )}
                    {canDelete && (
                      <button
                        type="button"
                        onClick={() => setToDelete(u)}
                        title={`Delete ${u.name}`}
                        aria-label={`Delete ${u.name}`}
                        className="h-10 w-10 shrink-0 flex items-center justify-center rounded-full text-[var(--color-neutral-500)] hover:bg-red-50 hover:text-red-600 transition-colors duration-150 cursor-pointer"
                      >
                        <TrashIcon className="h-5 w-5" />
                      </button>
                    )}
                    {actions.length === 0 && (
                      <span className="text-[12px] text-[var(--color-neutral-500)] italic">
                        {u.isLastSuperAdmin ? "Last Super Admin — locked" : "No actions"}
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
