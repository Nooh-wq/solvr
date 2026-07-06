import type { UserStatus } from "@/generated/prisma";

// Colored dot + label per status. UserStatus.PENDING/SUSPENDED are shown
// as "Pending approval" / "Deactivated" — the enum uses the shorter
// pre-spec names, but the labels here match spec §3's matrix.

const STATUS_META: Record<UserStatus, { label: string; dot: string; text: string }> = {
  ACTIVE: {
    label: "Active",
    dot: "bg-emerald-500",
    text: "text-emerald-700 dark:text-emerald-300",
  },
  PENDING: {
    label: "Pending approval",
    dot: "bg-amber-500",
    text: "text-amber-700 dark:text-amber-300",
  },
  INVITED: {
    label: "Invite sent",
    dot: "bg-blue-500",
    text: "text-blue-700 dark:text-blue-300",
  },
  SUSPENDED: {
    label: "Deactivated",
    dot: "bg-[var(--color-neutral-400)]",
    text: "text-[var(--color-neutral-500)]",
  },
  REJECTED: {
    label: "Rejected",
    dot: "bg-red-500",
    text: "text-red-700 dark:text-red-300",
  },
  UNVERIFIED: {
    label: "Unverified email",
    dot: "bg-[var(--color-neutral-300)]",
    text: "text-[var(--color-neutral-500)]",
  },
};

export function StatusIndicator({ status }: { status: UserStatus }) {
  const meta = STATUS_META[status];
  return (
    <span className={`inline-flex items-center gap-1.5 text-[12px] font-medium ${meta.text}`}>
      <span className={`inline-block h-1.5 w-1.5 rounded-full ${meta.dot}`} />
      {meta.label}
    </span>
  );
}
