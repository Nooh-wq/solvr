import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { getTicket, getTicketMessages, listAgents } from "@/actions/tickets";
import { listCannedResponses } from "@/actions/cannedResponses";
import { listMacros } from "@/actions/macros";
import { markTicketViewed } from "@/actions/ticketViews";
import { MacroLauncher } from "./macro-launcher";
import { getTenantById } from "@/lib/tenant";
import { listTicketGuests } from "@/actions/guest";
import { listValuesForTarget } from "@/actions/customFields";
import { getPriorActivityForClient, getOrgActivity } from "@/actions/priorActivity";
import { StatusBadge, PriorityLabel } from "@/components/ui/badge";
import { ConversationThread } from "@/components/conversation-thread";
import { participantNames } from "@/lib/participants";
import { FilesAndLinksPanel } from "@/components/files-and-links-panel";
import { TicketPeoplePanel } from "@/components/ticket-people-panel";
import { CustomFieldsEditor } from "@/components/custom-fields-editor";
import { ContactCard } from "./contact-card";
import { AgentReplyBox } from "./agent-reply-box";
import { AgentControls } from "./agent-controls";
import { CopilotPanel } from "./copilot-panel";
import { EscalateRail } from "./escalate-rail";
import { listEscalationPathsForTicket } from "@/actions/escalations";

export default async function AgentTicketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [session, ticket, agents, guests, cannedResponses, macros, escalationPaths] = await Promise.all([
    requireSession({ minRole: "AGENT" }),
    getTicket(id),
    listAgents(),
    listTicketGuests(id),
    listCannedResponses(),
    listMacros(),
    listEscalationPathsForTicket(id),
  ]);
  if (!ticket) notFound();
  const isLightAgent = session.roleName === "Light Agent";

  // Z6 DoD — record this view so the queue's unread counts drop it out
  // for the acting agent. Fire-and-forget: a mark-viewed failure must
  // never break the ticket-detail page.
  markTicketViewed(ticket.id).catch(() => {
    // Non-fatal.
  });
  const tenantForContext = await getTenantById(session.tenantId);

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

  // Z6.3 — placeholder context for canned-response expansion in the
  // composer. Client-side expand() runs on this snapshot; no additional
  // DB round-trips fire at insert time.
  const placeholderContext = {
    tenantId: session.tenantId,
    ticket: {
      reference: ticket.reference,
      title: ticket.title,
      priority: ticket.priority,
      status: ticket.status,
      requester: ticket.client
        ? { name: ticket.client.name, email: ticket.client.email }
        : null,
      organization: ticket.organization
        ? { name: ticket.organization.name }
        : null,
    },
    agent: { name: session.name, email: session.email },
    tenant: { productName: tenantForContext?.branding?.productName ?? null },
  };

  return (
    // Fill the viewport so the conversation column can stretch to the
    // bottom instead of leaving a big empty area under the composer.
    // 8rem covers the shell's header + main padding — same math as
    // other full-height admin surfaces.
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 min-h-[calc(100vh-8rem)]">
      <div className="lg:col-span-2 flex flex-col min-w-0 min-h-0">
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

        <div className="flex-1 min-h-0">
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
              sender: { name: m.sender.name ?? "Unknown", avatarUrl: m.sender.avatarUrl },
              attachments: m.attachments.map((a) => ({ id: a.id, fileName: a.fileName, mimeType: a.mimeType, sizeBytes: a.sizeBytes, fileUrl: a.fileUrl })),
            }))}
            composer={
              <AgentReplyBox
                ticketId={ticket.id}
                mentionNames={mentionNames}
                isLightAgent={isLightAgent}
                cannedResponses={cannedResponses.map((r) => ({
                  shortcut: r.shortcut,
                  name: r.name,
                  body: r.body,
                }))}
                placeholderContext={placeholderContext}
              />
            }
            // People + Files & links now surface as compact triggers in
            // the conversation header so the right rail can drop those
            // cards entirely.
            headerActions={
              <>
                <MacroLauncher
                  ticketId={ticket.id}
                  macros={macros.map((m) => ({
                    id: m.id,
                    name: m.name,
                    description: m.description,
                    actions: m.actions,
                    isShared: m.isShared,
                  }))}
                  placeholderContext={placeholderContext}
                />
                <TicketPeoplePanel
                  ticketId={ticket.id}
                  initialGuests={guests}
                  variant="chip"
                />
                <FilesAndLinksPanel
                  variant="chip"
                  files={ticket.attachments.map((a) => ({
                    id: a.id,
                    fileName: a.fileName,
                    mimeType: a.mimeType,
                    sizeBytes: a.sizeBytes,
                    url: a.fileUrl,
                    uploadedAt: a.uploadedAt.toISOString(),
                    uploadedByName: a.uploadedBy?.name ?? null,
                  }))}
                  messages={ticket.messages.map((m) => ({
                    body: m.body,
                    createdAt: m.createdAt.toISOString(),
                  }))}
                />
              </>
            }
          />
        </div>
      </div>

      {/*
        Right rail — flattened from the previous 8-box stack. The rule
        is: everything is a labeled section inside a shared card when
        the section shows structured content, and a flat block when
        it's just a properties list. Copilot keeps its own card because
        it's the highest-affordance surface in this rail.
      */}
      <div className="lg:col-span-1 space-y-4">
        {/* Properties: three inline rows, no card. */}
        <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl px-4 py-2">
          <AgentControls
            ticketId={ticket.id}
            status={ticket.status}
            priority={ticket.priority}
            assignedToId={ticket.assignedTeamMemberId}
            agents={agents.map((a) => ({ id: a.id, name: a.name ?? a.email }))}
          />
        </div>

        {/* Z8.4 — dynamic escalation rail. Only paths whose categoryIds
            include this ticket's category (or are empty = all) render. */}
        <EscalateRail
          ticketId={ticket.id}
          paths={escalationPaths.map((p) => ({ id: p.id, label: p.label, destKind: p.destKind }))}
        />

        {/* Contact = client identity + org line + prior activity + ticket meta. */}
        <ContactCard
          client={{
            name: clientName,
            email: ticket.client?.email ?? "",
            avatarUrl: null,
            profileHref: ticket.clientEndUserId
              ? `/admin/users/${ticket.clientEndUserId}`
              : null,
          }}
          organization={
            ticket.organization && ticket.organizationId
              ? {
                  id: ticket.organizationId,
                  name: ticket.organization.name,
                  openTicketCount: orgActivity?.openTicketCount ?? 0,
                }
              : null
          }
          priorActivity={priorActivity}
          ticketMeta={{
            createdAt: ticket.createdAt.toISOString(),
            source: ticket.source,
            category: ticket.category?.name ?? null,
          }}
        />

        {/* All custom fields under one shared card with subsection headings. */}
        {(ticketFields.length > 0 ||
          (ticket.clientEndUserId && userFields.length > 0) ||
          (ticket.organizationId && orgFields.length > 0)) && (
          <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-4 space-y-4">
            <CustomFieldsEditor
              title="Ticket fields"
              rows={ticketFields}
              targetId={ticket.id}
              variant="flat"
            />
            {ticket.clientEndUserId && userFields.length > 0 && (
              <div className="border-t border-[var(--color-neutral-200)] dark:border-white/5 pt-4">
                <CustomFieldsEditor
                  title="Requester fields"
                  rows={userFields}
                  targetId={ticket.clientEndUserId}
                  variant="flat"
                />
              </div>
            )}
            {ticket.organizationId && orgFields.length > 0 && (
              <div className="border-t border-[var(--color-neutral-200)] dark:border-white/5 pt-4">
                <CustomFieldsEditor
                  title="Organization fields"
                  rows={orgFields}
                  targetId={ticket.organizationId}
                  variant="flat"
                />
              </div>
            )}
          </div>
        )}

        {/* People + Files & links moved to the conversation header. */}
        <CopilotPanel ticketId={ticket.id} />
      </div>
    </div>
  );
}
