import type { UserRole as Role } from "@/lib/auth";

// Colored badges per role. Deliberately muted — the table's real focus is
// the status column (StatusIndicator), so role is subtle context, not a
// visual anchor. Uses opacity over CSS variables so both light and dark
// mode render cleanly (same pattern as HeatmapChart / RegionMap dots).

const ROLE_META: Record<Role, { label: string; bg: string; text: string; ring: string }> = {
  SUPER_ADMIN: {
    label: "Super admin",
    bg: "bg-[var(--color-primary)]/12",
    text: "text-[var(--color-primary)]",
    ring: "ring-[var(--color-primary)]/25",
  },
  ADMIN: {
    label: "Admin",
    bg: "bg-blue-500/10 dark:bg-blue-400/15",
    text: "text-blue-700 dark:text-blue-300",
    ring: "ring-blue-500/20",
  },
  AGENT: {
    label: "Agent",
    bg: "bg-emerald-500/10 dark:bg-emerald-400/15",
    text: "text-emerald-700 dark:text-emerald-300",
    ring: "ring-emerald-500/20",
  },
  CLIENT: {
    label: "Client",
    bg: "bg-[var(--color-neutral-100)]",
    text: "text-[var(--color-neutral-700)]",
    ring: "ring-[var(--color-neutral-300)]/50",
  },
};

export function RoleBadge({ role }: { role: Role }) {
  const meta = ROLE_META[role];
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ring-1 ring-inset ${meta.bg} ${meta.text} ${meta.ring}`}
    >
      {meta.label}
    </span>
  );
}
