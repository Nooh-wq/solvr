"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateUser, deleteUser } from "@/actions/admin";
import { Select } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { TrashIcon } from "@/components/icons";
import type { Role, UserStatus } from "@/generated/prisma";

type TeamMember = { id: string; name: string; email: string; role: Role; status: UserStatus };
type AssignableRole = "CLIENT" | "AGENT" | "ADMIN";

const STATUS_LABEL: Record<UserStatus, string> = {
  UNVERIFIED: "Unverified",
  PENDING: "Pending",
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

  function toggleActive(userId: string, name: string, isActive: boolean) {
    startTransition(async () => {
      try {
        await updateUser({ userId, status: isActive ? "SUSPENDED" : "ACTIVE" });
        toast({ title: isActive ? "User deactivated" : "User reactivated", description: name, variant: "success" });
        router.refresh();
      } catch (e) {
        toast({ title: "Couldn't update status", description: e instanceof Error ? e.message : undefined, variant: "error" });
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
          {users.map((u) => (
            <tr key={u.id} className="border-t border-[var(--color-neutral-100)]">
              <td className="px-4 py-3 whitespace-nowrap">{u.name}</td>
              <td className="px-4 py-3 text-[var(--color-neutral-600)] whitespace-nowrap">{u.email}</td>
              <td className="px-4 py-3">
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
              </td>
              <td className="px-4 py-3">{STATUS_LABEL[u.status]}</td>
              <td className="px-4 py-3">
                <div className="flex items-center gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={pending}
                    onClick={() => toggleActive(u.id, u.name, u.status === "ACTIVE")}
                  >
                    {u.status === "ACTIVE" ? "Deactivate" : "Reactivate"}
                  </Button>
                  <button
                    type="button"
                    onClick={() => setToDelete(u)}
                    title={`Delete ${u.name}`}
                    aria-label={`Delete ${u.name}`}
                    className="h-10 w-10 shrink-0 flex items-center justify-center rounded-full text-[var(--color-neutral-500)] hover:bg-red-50 hover:text-red-600 transition-colors duration-150 cursor-pointer"
                  >
                    <TrashIcon className="h-5 w-5" />
                  </button>
                </div>
              </td>
            </tr>
          ))}
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
