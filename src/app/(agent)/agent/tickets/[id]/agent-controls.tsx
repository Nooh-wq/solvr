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

  return (
    <div className="bg-white border border-[var(--color-neutral-300)] rounded p-4 space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="status">Status</Label>
        <Select
          id="status"
          value={status}
          disabled={pending}
          onChange={(e) => apply({ status: e.target.value as TicketStatus })}
        >
          {STATUS_OPTIONS[status].map((s) => (
            <option key={s} value={s}>
              {s.replace("_", " ")}
            </option>
          ))}
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="priority">Priority</Label>
        <Select
          id="priority"
          value={priority}
          disabled={pending}
          onChange={(e) => apply({ priority: e.target.value as Priority })}
        >
          <option value="LOW">Low</option>
          <option value="MEDIUM">Medium</option>
          <option value="HIGH">High</option>
          <option value="URGENT">Urgent</option>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="assignee">Assignee</Label>
        <Select
          id="assignee"
          value={assignedToId ?? ""}
          disabled={pending}
          onChange={(e) => apply({ assignedToId: e.target.value || null })}
        >
          <option value="">Unassigned</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </Select>
      </div>
    </div>
  );
}
