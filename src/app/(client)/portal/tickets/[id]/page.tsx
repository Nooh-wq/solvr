import { notFound } from "next/navigation";
import { getTicket } from "@/actions/tickets";
import { listTicketGuests } from "@/actions/guest";
import { StatusBadge, PriorityLabel } from "@/components/ui/badge";
import { FilesAndLinksPanel } from "@/components/files-and-links-panel";
import { TicketPeoplePanel } from "@/components/ticket-people-panel";
import { TicketThread } from "./ticket-thread";
import { TicketActions } from "./ticket-actions";

export default async function ClientTicketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [ticket, guests] = await Promise.all([getTicket(id), listTicketGuests(id)]);
  if (!ticket) notFound();

  return (
    <div className="max-w-3xl">
      <div className="flex items-start justify-between mb-1">
        <div>
          <span className="font-mono text-[12px] text-[var(--color-neutral-600)]">{ticket.reference}</span>
          <h1 className="text-2xl font-bold">{ticket.title}</h1>
        </div>
        <div className="flex items-center gap-2">
          <PriorityLabel priority={ticket.priority} size="lg" />
          <StatusBadge status={ticket.status} size="lg" />
        </div>
      </div>
      <p className="text-sm text-[var(--color-neutral-600)] mb-6">{ticket.category?.name ?? "Uncategorized"}</p>

      <TicketThread
        description={ticket.description}
        clientName={ticket.client.name}
        ticketId={ticket.id}
        messages={ticket.messages.map((m) => ({
          id: m.id,
          body: m.body,
          senderRole: m.senderRole,
          isInternal: m.isInternal,
          createdAt: m.createdAt.toISOString(),
          sender: m.sender ? { name: m.sender.name, avatarUrl: m.sender.avatarUrl } : null,
          attachments: m.attachments.map((a) => ({ id: a.id, fileName: a.fileName, mimeType: a.mimeType, sizeBytes: a.sizeBytes, fileUrl: a.fileUrl })),
        }))}
      />
      <TicketActions ticketId={ticket.id} status={ticket.status} />

      <TicketPeoplePanel ticketId={ticket.id} initialGuests={guests} />

      <FilesAndLinksPanel
        files={ticket.attachments.map((a) => ({
          id: a.id,
          fileName: a.fileName,
          mimeType: a.mimeType,
          sizeBytes: a.sizeBytes,
          url: a.fileUrl,
          uploadedAt: a.uploadedAt.toISOString(),
          uploadedByName: a.uploadedBy?.name ?? null,
        }))}
        messages={ticket.messages.map((m) => ({ body: m.body, createdAt: m.createdAt.toISOString() }))}
      />
    </div>
  );
}
