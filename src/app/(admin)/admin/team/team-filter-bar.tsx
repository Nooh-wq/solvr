"use client";

import { Select } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { PlusIcon, SearchIcon } from "@/components/icons";
import type { UserStatus } from "@/generated/prisma";
import type { UserRole as Role } from "@/lib/auth";

export type RoleFilter = Role | "ALL";
export type StatusFilter = UserStatus | "ALL";

const ROLE_OPTIONS: { value: RoleFilter; label: string }[] = [
  { value: "ALL", label: "All roles" },
  { value: "CLIENT", label: "Client" },
  { value: "AGENT", label: "Agent" },
  { value: "ADMIN", label: "Admin" },
  { value: "SUPER_ADMIN", label: "Super admin" },
];

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: "ALL", label: "All statuses" },
  { value: "ACTIVE", label: "Active" },
  { value: "INVITED", label: "Invited" },
  { value: "PENDING", label: "Pending approval" },
  { value: "SUSPENDED", label: "Deactivated" },
  { value: "REJECTED", label: "Rejected" },
];

export function TeamFilterBar({
  search,
  onSearchChange,
  role,
  onRoleChange,
  status,
  onStatusChange,
  filteredCount,
  totalCount,
  onOpenInvite,
}: {
  search: string;
  onSearchChange: (v: string) => void;
  role: RoleFilter;
  onRoleChange: (v: RoleFilter) => void;
  status: StatusFilter;
  onStatusChange: (v: StatusFilter) => void;
  filteredCount: number;
  totalCount: number;
  onOpenInvite: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 mb-4">
      <div className="relative">
        <SearchIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--color-neutral-500)] pointer-events-none" />
        <input
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search name or email…"
          className="h-9 pl-8 pr-3 text-sm border border-[var(--color-neutral-300)] rounded-lg w-64 bg-[var(--color-surface)] text-[var(--foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30"
        />
      </div>
      <Select value={role} onChange={(e) => onRoleChange(e.target.value as RoleFilter)} className="h-9 w-40">
        {ROLE_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
      <Select value={status} onChange={(e) => onStatusChange(e.target.value as StatusFilter)} className="h-9 w-44">
        {STATUS_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
      <span className="text-[12px] text-[var(--color-neutral-500)] ml-1">
        {filteredCount} of {totalCount}
      </span>
      <Button onClick={onOpenInvite} className="ml-auto gap-1.5">
        <PlusIcon className="h-4 w-4" />
        Invite
      </Button>
    </div>
  );
}
