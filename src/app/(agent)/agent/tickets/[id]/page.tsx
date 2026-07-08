import { notFound } from "next/navigation";
import { getTicket, getTicketMessages, listAgents } from "@/actions/tickets";
import { listTicketGuests } from "@/actions/guest";
import { listValuesForTarget } from "@/actions/customFields";
import { getPriorActivityForClient, getOrgActivity } from "@/actions/priorActivity";
import { OrganizationCard } from "./organization-card";
import { StatusBadge, PriorityLabel } from "@/components/ui/badge";
import { ConversationThread } from "@/components/conversation-thread";
import { participantNames } from "@/lib/participants";
import { FilesAndLinksPanel } from "@/components/files-and-links-panel";
import { TicketPeoplePanel } from "@/components/ticket-people-panel";
import { CustomFieldsEditor } from "@/components/custom-fields-editor";
import { ClientProfileCard } from "./client-profile-card";
import { AgentReplyBox } from "./agent-reply-box";
import { AgentControls } from "./agent-controls";
import { CopilotPanel } from "./copilot-panel";

export default async function AgentTicketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [ticket, agents, guests] = await Promise.all([getTicket(id), listAgents(), listTicketGuests(id)]);
  if (!ticket) notFound();

  // Z2.1: three independent custom-field lookups — ticket + its requester
  // (if a real EndUser) + its organization. Run in parallel; each is one
  // definitions + values query pair. Requester/org lookups are skipped
  // when the ticket doesn't have that side (guest requester, no org).
  const [ticketFields, userFields, orgFields, priorActivity, orgActivity] = await Promise.all([
    listValuesForTarget("TICKET", ticket.id),
    ticket.clientEndUserId
      ? listValuesForTarget("USER", ticket.clientEndUserId)
      : Promise.resolve([]),
    ticket.organizationId
      ? listValuesForTarget("ORG", ticket.organizationId)
      : Promise.resolve([]),
    ticket.clientEndUserId
      ? getPriorActivityForClient(ticket.clientEndUserId, ticket.id)
      : Promise.resolve(null),
    // Z4.4 — "N open tickets on this org" for the customer-context card.
    ticket.organizationId ? getOrgActivity(ticket.organizationId) : Promise.resolve(null),
  ]);

  // Z1.4b: ticket.client is now UserLike | null (wrapper-resolved).
  // "Unknown" fallback covers dual-FK rows whose target row is missing
  // (RLS-invisible / not yet backfilled).
  const clientName = ticket.client?.name ?? "Unknown";
  const mentionNames = participantNames(clientName, ticket.messages);

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

        <ConversationThread
          description={ticket.description}
          clientName={clientName}
          mySenderRoles={["AGENT", "ADMIN", "SUPER_ADMIN"]}
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
            // Sender is pre-resolved by getTicket() (MessageSender union).
            // Adapt to ConversationThread's simpler shape: name+avatar.
            sender: { name: m.sender.name ?? "Unknown", avatarUrl: m.sender.avatarUrl },
            attachments: m.attachments.map((a) => ({ id: a.id, fileName: a.fileName, mimeType: a.mimeType, sizeBytes: a.sizeBytes, fileUrl: a.fileUrl })),
          }))}
          composer={<AgentReplyBox ticketId={ticket.id} mentionNames={mentionNames} />}
        />
      </div>

      <div className="lg:col-span-1">
        <AgentControls
          ticketId={ticket.id}
          status={ticket.status}
          priority={ticket.priority}
          assignedToId={ticket.assignedTeamMemberId}
          agents={agents.map((a) => ({ id: a.id, name: a.name ?? a.email }))}
        />

        <ClientProfileCard
          client={{
            name: clientName,
            email: ticket.client?.email ?? "",
            company: ticket.organization?.name ?? null,
            avatarUrl: null,
            // Z3.5 — link into the deep profile page when the requester is
            // a real EndUser. Guest / legacy / TM-requester tickets don't
            // have a profile URL and just get the classic card.
            profileHref: ticket.clientEndUserId
              ? `/admin/users/${ticket.clientEndUserId}`
              : null,
          }}
          ticketMeta={{
            createdAt: ticket.createdAt.toISOString(),
            source: ticket.source,
            category: ticket.category?.name ?? null,
          }}
          priorActivity={priorActivity}
        />

        {ticket.organization && ticket.organizationId && (
          <OrganizationCard
            organizationId={ticket.organizationId}
            name={ticket.organization.name}
            openTicketCount={orgActivity?.openTicketCount ?? 0}
          />
        )}

        <CustomFieldsEditor title="Ticket fields" rows={ticketFields} targetId={ticket.id} />
        {ticket.clientEndUserId ? (
          <CustomFieldsEditor
            title="Requester fields"
            rows={userFields}
            targetId={ticket.clientEndUserId}
          />
        ) : null}
        {ticket.organizationId ? (
          <CustomFieldsEditor
            title="Organization fields"
            rows={orgFields}
            targetId={ticket.organizationId}
          />
        ) : null}

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

        <CopilotPanel ticketId={ticket.id} />
      </div>
    </div>
  );
}
