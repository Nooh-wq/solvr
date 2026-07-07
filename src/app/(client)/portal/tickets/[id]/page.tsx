import { notFound } from "next/navigation";
import { getTicket, getTicketMessages } from "@/actions/tickets";
import { listTicketGuests } from "@/actions/guest";
import { StatusBadge, PriorityLabel } from "@/components/ui/badge";
import { FilesAndLinksPanel } from "@/components/files-and-links-panel";
import { TicketPeoplePanel } from "@/components/ticket-people-panel";
import { ClientAiChatPanel } from "@/components/client-ai-chat-panel";
import { participantNames } from "@/lib/participants";
import { TicketThread } from "./ticket-thread";
import { TicketActions } from "./ticket-actions";

export default async function ClientTicketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [ticket, guests] = await Promise.all([getTicket(id), listTicketGuests(id)]);
  if (!ticket) notFound();

  // Z1.4b: ticket.client is UserLike | null; sender is MessageSender (pre-resolved by getTicket).
  const clientName = ticket.client?.name ?? "Unknown";
  const mentionNames = participantNames(clientName, ticket.messages);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 flex flex-col min-w-0">
        <div className="flex items-start justify-between mb-1">
          <div className="min-w-0">
            <span className="font-mono text-[12px] text-[var(--color-neutral-600)]">{ticket.reference}</span>
            <h1 className="text-2xl font-bold truncate">{ticket.title}</h1>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <PriorityLabel priority={ticket.priority} size="lg" />
            <StatusBadge status={ticket.status} size="lg" />
          </div>
        </div>
        <p className="text-sm text-[var(--color-neutral-600)] mb-6">{ticket.category?.name ?? "Uncategorized"}</p>

        <TicketThread
          description={ticket.description}
          clientName={clientName}
          ticketId={ticket.id}
          mentionNames={mentionNames}
          onPoll={async () => {
            "use server";
            const msgs = await getTicketMessages(ticket.id);
            if (!msgs) return null;
            return msgs.map((m) => ({
              ...m,
              sender: { name: m.sender.name ?? "Unknown", avatarUrl: m.sender.avatarUrl },
            }));
          }}
          messages={ticket.messages.map((m) => ({
            id: m.id,
            body: m.body,
            senderRole: m.senderRole,
            isInternal: m.isInternal,
            createdAt: m.createdAt.toISOString(),
            sender: { name: m.sender.name ?? "Unknown", avatarUrl: m.sender.avatarUrl },
            attachments: m.attachments.map((a) => ({ id: a.id, fileName: a.fileName, mimeType: a.mimeType, sizeBytes: a.sizeBytes, fileUrl: a.fileUrl })),
          }))}
        />
        <TicketActions ticketId={ticket.id} status={ticket.status} />
      </div>

      <div className="lg:col-span-1">
        <ClientAiChatPanel />

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
    </div>
  );
}
