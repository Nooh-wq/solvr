"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateUser } from "@/actions/admin";
import { Select } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import type { Role, UserStatus } from "@/generated/prisma";

type TeamMember = { id: string; name: string; email: string; role: Role; status: UserStatus };
type AssignableRole = "CLIENT" | "AGENT" | "ADMIN";

const STATUS_LABEL: Record<UserStatus, string> = {
  PENDING: "Pending",
  ACTIVE: "Active",
  REJECTED: "Rejected",
  SUSPENDED: "Deactivated",
};

export function TeamTable({ users }: { users: TeamMember[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

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

  return (
    <div className="bg-white border border-[var(--color-neutral-300)] rounded-2xl overflow-hidden">
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
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={pending}
                  onClick={() => toggleActive(u.id, u.name, u.status === "ACTIVE")}
                >
                  {u.status === "ACTIVE" ? "Deactivate" : "Reactivate"}
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );
}
