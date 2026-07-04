import { notFound } from "next/navigation";
import { getTicket, listAgents } from "@/actions/tickets";
import { StatusBadge, PriorityLabel } from "@/components/ui/badge";
import { TicketConversation } from "./ticket-conversation";
import { ClientProfileCard } from "./client-profile-card";
import { AgentReplyBox } from "./agent-reply-box";
import { AgentControls } from "./agent-controls";
import { CopilotPanel } from "./copilot-panel";

export default async function AgentTicketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [ticket, agents] = await Promise.all([getTicket(id), listAgents()]);
  if (!ticket) notFound();

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 flex flex-col min-w-0">
        <div className="flex items-start justify-between mb-4">
          <div className="min-w-0">
            <span className="font-mono text-[12px] text-[var(--color-neutral-600)]">{ticket.reference}</span>
            <h1 className="text-2xl font-bold truncate">{ticket.title}</h1>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <PriorityLabel priority={ticket.priority} size="lg" />
            <StatusBadge status={ticket.status} size="lg" />
          </div>
        </div>

        <TicketConversation
          description={ticket.description}
          clientName={ticket.client.name}
          messages={ticket.messages.map((m) => ({
            id: m.id,
            body: m.body,
            senderRole: m.senderRole,
            isInternal: m.isInternal,
            createdAt: m.createdAt.toISOString(),
            sender: m.sender ? { name: m.sender.name, avatarUrl: m.sender.avatarUrl } : null,
          }))}
          composer={<AgentReplyBox ticketId={ticket.id} />}
        />
      </div>

      <div className="lg:col-span-1">
        <AgentControls
          ticketId={ticket.id}
          status={ticket.status}
          priority={ticket.priority}
          assignedToId={ticket.assignedToId}
          agents={agents.map((a) => ({ id: a.id, name: a.name }))}
        />

        <ClientProfileCard
          client={{
            name: ticket.client.name,
            email: ticket.client.email,
            company: ticket.client.company,
            avatarUrl: ticket.client.avatarUrl,
          }}
          ticketMeta={{
            createdAt: ticket.createdAt.toISOString(),
            source: ticket.source,
            category: ticket.category?.name ?? null,
          }}
        />

        <CopilotPanel ticketId={ticket.id} />
      </div>
    </div>
  );
}
