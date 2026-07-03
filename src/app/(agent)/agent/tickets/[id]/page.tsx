import { notFound } from "next/navigation";
import { getTicket, listAgents } from "@/actions/tickets";
import { StatusBadge, PriorityLabel } from "@/components/ui/badge";
import { TicketMessageList } from "@/components/ticket-message-list";
import { AgentReplyBox } from "./agent-reply-box";
import { AgentControls } from "./agent-controls";
import { CopilotPanel } from "./copilot-panel";

export default async function AgentTicketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [ticket, agents] = await Promise.all([getTicket(id), listAgents()]);
  if (!ticket) notFound();

  return (
    <div className="grid grid-cols-3 gap-6">
      <div className="col-span-2">
        <div className="flex items-start justify-between mb-1">
          <div>
            <span className="font-mono text-[12px] text-[var(--color-neutral-600)]">{ticket.reference}</span>
            <h1 className="text-2xl font-bold">{ticket.title}</h1>
          </div>
          <div className="flex items-center gap-3">
            <PriorityLabel priority={ticket.priority} />
            <StatusBadge status={ticket.status} />
          </div>
        </div>
        <p className="text-sm text-[var(--color-neutral-600)] mb-6">
          {ticket.client.name} · {ticket.client.email}
          {ticket.client.company ? ` · ${ticket.client.company}` : ""}
        </p>

        <div className="bg-white border border-[var(--color-neutral-300)] rounded p-5 mb-6">
          <p className="text-sm whitespace-pre-wrap">{ticket.description}</p>
        </div>

        <TicketMessageList messages={ticket.messages} />
        <AgentReplyBox ticketId={ticket.id} />
      </div>

      <div className="col-span-1">
        <AgentControls
          ticketId={ticket.id}
          status={ticket.status}
          priority={ticket.priority}
          assignedToId={ticket.assignedToId}
          agents={agents.map((a) => ({ id: a.id, name: a.name }))}
        />

        <CopilotPanel ticketId={ticket.id} />
      </div>
    </div>
  );
}
