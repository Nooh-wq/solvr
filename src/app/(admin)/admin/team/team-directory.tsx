"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { PlusIcon } from "@/components/icons";
import { InviteUserForm } from "./invite-user-form";
import { TeamTable } from "./team-table";
import type { Role, UserStatus } from "@/generated/prisma";

type TeamMember = {
  id: string;
  name: string;
  email: string;
  role: Role;
  status: UserStatus;
  company: string | null;
  lastActiveAt: string | null;
  isLastSuperAdmin: boolean;
};

const ROLE_OPTIONS: { value: Role | "ALL"; label: string }[] = [
  { value: "ALL", label: "All roles" },
  { value: "CLIENT", label: "Client" },
  { value: "AGENT", label: "Agent" },
  { value: "ADMIN", label: "Admin" },
  { value: "SUPER_ADMIN", label: "Super admin" },
];

const STATUS_OPTIONS: { value: UserStatus | "ALL"; label: string }[] = [
  { value: "ALL", label: "All statuses" },
  { value: "ACTIVE", label: "Active" },
  { value: "SUSPENDED", label: "Deactivated" },
  { value: "REJECTED", label: "Rejected" },
];

export function TeamDirectory({ users }: { users: TeamMember[] }) {
  const [role, setRole] = useState<Role | "ALL">("ALL");
  const [status, setStatus] = useState<UserStatus | "ALL">("ALL");
  const [search, setSearch] = useState("");
  const [inviteOpen, setInviteOpen] = useState(false);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users.filter(
      (u) =>
        (role === "ALL" || u.role === role) &&
        (status === "ALL" || u.status === status) &&
        (q === "" || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q))
    );
  }, [users, role, status, search]);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name or email…"
          className="h-9 px-3 text-sm border border-[var(--color-neutral-300)] rounded-lg w-56 bg-[var(--color-surface)] text-[var(--foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30"
        />
        <Select value={role} onChange={(e) => setRole(e.target.value as Role | "ALL")} className="h-9 w-40">
          {ROLE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
        <Select value={status} onChange={(e) => setStatus(e.target.value as UserStatus | "ALL")} className="h-9 w-40">
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
        <span className="text-[12px] text-[var(--color-neutral-500)] ml-1">
          {filtered.length} of {users.length}
        </span>
        <Button onClick={() => setInviteOpen(true)} className="ml-auto gap-1.5">
          <PlusIcon className="h-4 w-4" />
          Invite
        </Button>
      </div>

      {filtered.length === 0 ? (
        <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-10 text-center text-sm text-[var(--color-neutral-600)]">
          No team members match these filters.
        </div>
      ) : (
        <TeamTable users={filtered} />
      )}

      <Modal open={inviteOpen} onClose={() => setInviteOpen(false)} title="Invite someone">
        <InviteUserForm embedded />
      </Modal>
    </div>
  );
}
