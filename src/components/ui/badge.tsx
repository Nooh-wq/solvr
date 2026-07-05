import { cn } from "@/lib/utils";
import type { TicketStatus, Priority } from "@/generated/prisma";

const statusStyles: Record<TicketStatus, string> = {
  OPEN: "bg-[var(--color-orange-pale)] text-[var(--color-orange-deep)]",
  IN_PROGRESS: "bg-[var(--foreground)] text-[var(--background)]",
  PENDING: "bg-[var(--color-neutral-100)] text-[var(--color-neutral-700)]",
  RESOLVED: "bg-[var(--color-neutral-100)] text-[var(--foreground)]",
  CLOSED: "bg-[var(--color-surface)] text-[var(--color-neutral-400)] border border-[var(--color-neutral-300)]",
};

const statusLabels: Record<TicketStatus, string> = {
  OPEN: "Open",
  IN_PROGRESS: "In progress",
  PENDING: "Pending",
  RESOLVED: "Resolved",
  CLOSED: "Closed",
};

export function StatusBadge({ status, size = "sm" }: { status: TicketStatus; size?: "sm" | "lg" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full font-semibold",
        size === "lg" ? "px-3.5 py-1.5 text-[13px]" : "px-2.5 py-1 text-[11px] font-medium",
        statusStyles[status]
      )}
    >
      {statusLabels[status]}
    </span>
  );
}

// Solid, colored pill (not just tinted text) so URGENT/HIGH visually demand
// attention at a glance — the plain-text version was easy to miss next to a
// ticket title.
const priorityStyles: Record<Priority, string> = {
  LOW: "bg-[var(--color-neutral-100)] text-[var(--color-neutral-700)]",
  MEDIUM: "bg-[var(--color-neutral-100)] text-[var(--foreground)]",
  HIGH: "bg-[var(--color-orange-pale)] text-[var(--color-orange-deep)]",
  URGENT: "bg-[var(--color-primary)] text-white",
};

export function PriorityLabel({ priority, size = "sm" }: { priority: Priority; size?: "sm" | "lg" }) {
  if (size === "lg") {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[13px] font-semibold uppercase tracking-wide",
          priorityStyles[priority]
        )}
      >
        {priority === "URGENT" && <span className="h-1.5 w-1.5 rounded-full bg-white animate-pulse" />}
        {priority}
      </span>
    );
  }
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-mono font-semibold uppercase tracking-wide",
        priorityStyles[priority]
      )}
    >
      {priority}
    </span>
  );
}
