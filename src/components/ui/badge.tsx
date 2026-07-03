import { cn } from "@/lib/utils";
import type { TicketStatus, Priority } from "@/generated/prisma";

const statusStyles: Record<TicketStatus, string> = {
  OPEN: "bg-[var(--color-orange-pale)] text-[var(--color-orange-deep)]",
  IN_PROGRESS: "bg-black text-white",
  PENDING: "bg-[var(--color-neutral-100)] text-[var(--color-neutral-700)]",
  RESOLVED: "bg-[var(--color-neutral-100)] text-black",
  CLOSED: "bg-white text-[var(--color-neutral-400)] border border-[var(--color-neutral-300)]",
};

const statusLabels: Record<TicketStatus, string> = {
  OPEN: "Open",
  IN_PROGRESS: "In progress",
  PENDING: "Pending",
  RESOLVED: "Resolved",
  CLOSED: "Closed",
};

export function StatusBadge({ status }: { status: TicketStatus }) {
  return (
    <span className={cn("inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-medium", statusStyles[status])}>
      {statusLabels[status]}
    </span>
  );
}

const priorityStyles: Record<Priority, string> = {
  LOW: "text-[var(--color-neutral-600)]",
  MEDIUM: "text-black",
  HIGH: "text-[var(--color-orange-deep)]",
  URGENT: "text-[var(--color-orange-core)] font-semibold",
};

export function PriorityLabel({ priority }: { priority: Priority }) {
  return (
    <span className={cn("text-[11px] font-mono uppercase tracking-wide", priorityStyles[priority])}>
      {priority}
    </span>
  );
}
