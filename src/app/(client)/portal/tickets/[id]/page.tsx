import { notFound } from "next/navigation";
import { getTicket } from "@/actions/tickets";
import { StatusBadge, PriorityLabel } from "@/components/ui/badge";
import { TicketThread } from "./ticket-thread";
import { TicketActions } from "./ticket-actions";

export default async function ClientTicketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ticket = await getTicket(id);
  if (!ticket) notFound();

  return (
    <div className="max-w-3xl">
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
      <p className="text-sm text-[var(--color-neutral-600)] mb-6">{ticket.category?.name ?? "Uncategorized"}</p>

      <div className="bg-white border border-[var(--color-neutral-300)] rounded p-5 mb-6">
        <p className="text-sm whitespace-pre-wrap">{ticket.description}</p>
      </div>

      <TicketThread messages={ticket.messages} ticketId={ticket.id} />
      <TicketActions ticketId={ticket.id} status={ticket.status} />
    </div>
  );
}
