"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateTicket } from "@/actions/tickets";
import { Label, Select } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import type { TicketStatus, Priority } from "@/generated/prisma";

const STATUS_OPTIONS: Record<TicketStatus, TicketStatus[]> = {
  OPEN: ["OPEN", "IN_PROGRESS"],
  IN_PROGRESS: ["IN_PROGRESS", "PENDING", "RESOLVED"],
  PENDING: ["PENDING", "IN_PROGRESS", "RESOLVED"],
  RESOLVED: ["RESOLVED", "CLOSED", "IN_PROGRESS"],
  CLOSED: ["CLOSED", "IN_PROGRESS"],
};

export function AgentControls({
  ticketId,
  status,
  priority,
  assignedToId,
  agents,
}: {
  ticketId: string;
  status: TicketStatus;
  priority: Priority;
  assignedToId: string | null;
  agents: { id: string; name: string }[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  function apply(patch: Partial<{ status: TicketStatus; priority: Priority; assignedToId: string | null }>) {
    startTransition(async () => {
      try {
        await updateTicket({ ticketId, ...patch });
        if (patch.status) toast({ title: "Status updated", description: patch.status.replace("_", " "), variant: "success" });
        else if (patch.priority) toast({ title: "Priority updated", description: patch.priority, variant: "success" });
        else if ("assignedToId" in patch) {
          const agentName = agents.find((a) => a.id === patch.assignedToId)?.name;
          toast({ title: agentName ? "Ticket assigned" : "Ticket unassigned", description: agentName, variant: "success" });
        }
        router.refresh();
      } catch (e) {
        toast({ title: "Couldn't update ticket", description: e instanceof Error ? e.message : undefined, variant: "error" });
      }
    });
  }

  // Flat strip layout: three labeled selects stacked with hairline dividers.
  // The old outer card was making the whole right rail look like an
  // acropolis of boxes — this reads as a properties list instead.
  return (
    <div className="divide-y divide-[var(--color-neutral-200)] dark:divide-white/5">
      <PropertyRow label="Status">
        <Select
          id="status"
          value={status}
          disabled={pending}
          onChange={(e) => apply({ status: e.target.value as TicketStatus })}
          className="h-8 text-[13px] border-0 bg-transparent px-0 shadow-none focus:ring-0 -mr-1"
        >
          {STATUS_OPTIONS[status].map((s) => (
            <option key={s} value={s}>
              {s.replace("_", " ")}
            </option>
          ))}
        </Select>
      </PropertyRow>
      <PropertyRow label="Priority">
        <Select
          id="priority"
          value={priority}
          disabled={pending}
          onChange={(e) => apply({ priority: e.target.value as Priority })}
          className="h-8 text-[13px] border-0 bg-transparent px-0 shadow-none focus:ring-0 -mr-1"
        >
          <option value="LOW">Low</option>
          <option value="MEDIUM">Medium</option>
          <option value="HIGH">High</option>
          <option value="URGENT">Urgent</option>
        </Select>
      </PropertyRow>
      <PropertyRow label="Assignee">
        <Select
          id="assignee"
          value={assignedToId ?? ""}
          disabled={pending}
          onChange={(e) => apply({ assignedToId: e.target.value || null })}
          className="h-8 text-[13px] border-0 bg-transparent px-0 shadow-none focus:ring-0 -mr-1"
        >
          <option value="">Unassigned</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </Select>
      </PropertyRow>
    </div>
  );
}

function PropertyRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <Label className="text-[12px] text-[var(--color-neutral-500)] font-medium">
        {label}
      </Label>
      <div className="min-w-0 flex-1 text-right">{children}</div>
    </div>
  );
}
