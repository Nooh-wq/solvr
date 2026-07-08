"use server";

import { revalidatePath } from "next/cache";
import geoip from "geoip-lite";
import { withRls } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { getClientIp } from "@/lib/rate-limit";
import {
  createTicketSchema,
  replySchema,
  agentReplySchema,
  updateTicketSchema,
  ticketFilterSchema,
} from "@/lib/validation/ticket";
import type { z } from "zod";
import type { TicketStatus } from "@/generated/prisma";
import { Prisma } from "@/generated/prisma";
import {
  sendTicketCreatedEmail,
  sendAgentReplyEmail,
  sendClientReplyNotification,
  sendStatusChangeEmail,
  sendCsatRequestEmail,
} from "@/lib/email/events";
import { createWithReference } from "@/lib/ticket-number";
import { notify } from "@/lib/notifications";
import {
  getEmailDecision,
  queueDigestEmail,
  shouldWriteInAppInTx,
  type EmailEventKey,
} from "@/lib/notification-prefs";
import { getAttachmentSignedUrl } from "@/lib/storage";
import { signCsatToken } from "@/lib/session";
import {
  dualFkForUser,
  ticketClientCols,
  ticketClientWhereFor,
  actorCols,
  senderCols,
  assignedTeamMemberCol,
} from "@/lib/z1-dual-fk";
import {
  systemContext,
  getEndUser,
  getEndUsersByIds,
  getTeamMember,
  getTeamMembersByIds,
  getOrganizationsByIds,
  matchOrganizationByEmailDomain,
  listTeamMembers,
  listTeamMembersInGroup,
  getRoleByName,
  type EndUser,
  type TeamMember,
  type Organization,
} from "@/lib/shared-platform";
import { getAvatarUrlsByIds } from "@/lib/avatars";
import {
  resolveUserLike,
  resolveMessageSender,
  teamMemberToUserLike,
  type UserLike,
} from "@/lib/z1-view-models";

function siteUrl() {
  return process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
}

/**
 * Z5.2 — resolves the acting team member's ticketAccessScope into a Prisma
 * `where` fragment. Composed with the caller's other filters via spread.
 *
 * Semantics per Zendesk parity:
 *   ALL / null      — no restriction (returns {}).
 *   ASSIGNED_ONLY   — only tickets assigned to this agent.
 *   GROUPS          — tickets assigned to this agent, to any teammate in
 *                     one of their groups, OR unassigned (so a group-scoped
 *                     agent can still see the intake queue and claim work).
 *
 * SUPER_ADMIN and CLIENT sessions get {} — SUPER_ADMIN needs cross-tenant
 * health visibility (see rls_policies.sql), CLIENT scope is enforced
 * separately by ticketClientWhereFor().
 *
 * Async because GROUPS needs a wrapper roundtrip: the assignedTeamMemberId
 * column is a raw scalar (no Prisma relation across the boundary, rule 3
 * in docs/shared-platform-boundary.md), so a nested relation filter isn't
 * possible — instead we pre-resolve the set of team-member ids in the
 * caller's groups and use `assignedTeamMemberId IN (...)`.
 */
async function ticketScopeWhereFor(session: {
  subjectId: string;
  tenantId: string;
  role: "CLIENT" | "AGENT" | "ADMIN" | "SUPER_ADMIN";
  ticketAccessScope: "ALL" | "GROUPS" | "ASSIGNED_ONLY" | null;
  groupIds: string[];
}): Promise<Prisma.TicketWhereInput> {
  if (session.role === "CLIENT" || session.role === "SUPER_ADMIN") return {};
  const scope = session.ticketAccessScope ?? "ALL";
  if (scope === "ALL") return {};
  if (scope === "ASSIGNED_ONLY") {
    return { assignedTeamMemberId: session.subjectId };
  }
  // GROUPS — resolve every teammate in one of the caller's groups.
  if (session.groupIds.length === 0) {
    // Zero groups → only self-assigned tickets are visible. Prevents an
    // admin accidentally locking an agent out of everything by setting
    // GROUPS scope without adding them to any group.
    return { assignedTeamMemberId: session.subjectId };
  }
  const ctx = systemContext(session.tenantId);
  const teammatesByGroup = await Promise.all(
    session.groupIds.map((groupId) => listTeamMembersInGroup(ctx, groupId))
  );
  const teammateIds = new Set<string>([session.subjectId]);
  for (const list of teammatesByGroup) for (const m of list) teammateIds.add(m.id);
  return {
    OR: [
      { assignedTeamMemberId: { in: [...teammateIds] } },
      { assignedTeamMemberId: null },
    ],
  };
}

/** FR-2: client creates a ticket. Status defaults to Open; fires the "received" email. */
export async function createTicket(input: z.infer<typeof createTicketSchema>) {
  const session = await requireSession();
  const data = createTicketSchema.parse(input);

  // geoip-lite is an offline/synchronous lookup (no external API call), so
  // unlike a remote geolocation service this is safe to do without worrying
  // about holding open the withRls transaction below during a network call —
  // it's just an in-memory data-file lookup. Powers the analytics "clients
  // by region" map/table; null for email-sourced tickets (no live request).
  const clientIp = await getClientIp();
  const clientCountry = clientIp !== "unknown" ? (geoip.lookup(clientIp)?.country ?? null) : null;

  const { ticket, branding } = await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: session.tenantId } });

      // Z1.4b: organizationId comes from the wrapper's EndUser.
      // Staff-authored tickets (Employee Service Suite path) resolve
      // to null organizationId — TeamMembers have no primary org.
      const wrapperCtx = systemContext(session.tenantId);
      const clientEndUser =
        session.role === "CLIENT" ? await getEndUser(wrapperCtx, session.subjectId) : null;
      const clientDual = dualFkForUser(session.subjectId, session.role);

      // Z2.3: if a ticket form is claimed, verify it exists and is active
      // for THIS tenant. Prevents a client from submitting some other
      // tenant's formId — RLS covers the SELECT, but we surface a friendly
      // error instead of silently ignoring.
      let resolvedFormId: string | null = null;
      if (data.ticketFormId) {
        const form = await tx.ticketForm.findFirst({
          where: { id: data.ticketFormId, tenantId: session.tenantId, isActive: true },
          select: { id: true },
        });
        if (form) resolvedFormId = form.id;
      }

      const ticket = await createWithReference(tenant.name, ({ reference, ticketNumber }) =>
        tx.ticket.create({
          data: {
            tenantId: session.tenantId,
            reference,
            ticketNumber,
            title: data.title,
            description: data.description,
            categoryId: data.categoryId,
            priority: data.priority,
            ...ticketClientCols(clientDual),
            organizationId: clientEndUser?.organizationId ?? null,
            status: "OPEN",
            source: "portal",
            clientIp: clientIp !== "unknown" ? clientIp : null,
            clientCountry,
            ticketFormId: resolvedFormId,
          },
        })
      );

      // Z2.3: apply custom-field values submitted alongside the ticket.
      // Only accept values whose definition IS on the resolved form —
      // this is the server-side gate that keeps end users from setting
      // arbitrary USER/ORG fields (Z2 spec §3: end users must not see or
      // edit those). If no form was resolved, all submitted values are
      // silently dropped (nothing to reference against).
      if (resolvedFormId && data.customFieldValues && data.customFieldValues.length > 0) {
        const formFields = await tx.ticketFormField.findMany({
          where: { ticketFormId: resolvedFormId, tenantId: session.tenantId },
          include: {
            fieldDefinition: { select: { id: true, type: true, scope: true, isActive: true } },
          },
        });
        const defsById = new Map(
          formFields
            .filter((ff) => ff.fieldDefinition.scope === "TICKET" && ff.fieldDefinition.isActive)
            .map((ff) => [ff.fieldDefinition.id, ff.fieldDefinition])
        );

        for (const v of data.customFieldValues) {
          const def = defsById.get(v.fieldDefinitionId);
          if (!def) continue; // Silent drop — not on the form.

          const dateVal =
            v.valueDate == null
              ? null
              : typeof v.valueDate === "string"
                ? new Date(v.valueDate)
                : v.valueDate;

          await tx.customFieldValue.create({
            data: {
              tenantId: session.tenantId,
              fieldDefinitionId: def.id,
              targetType: "TICKET",
              targetId: ticket.id,
              valueText: def.type === "TEXT" ? (v.valueText ?? null) : null,
              valueNumber:
                def.type === "NUMBER" && v.valueNumber != null
                  ? new Prisma.Decimal(v.valueNumber)
                  : null,
              valueDate: def.type === "DATE" ? dateVal : null,
              valueBoolean: def.type === "CHECKBOX" ? (v.valueBoolean ?? null) : null,
              valueOptionId: def.type === "DROPDOWN" ? (v.valueOptionId ?? null) : null,
              valueOptionIds:
                def.type === "MULTISELECT" && v.valueOptionIds ? v.valueOptionIds : [],
            },
          });
        }
      }

      await tx.auditLog.create({
        data: {
          tenantId: session.tenantId,
          ticketId: ticket.id,
          ...actorCols(clientDual),
          action: "CREATE",
          toValue: "OPEN",
        },
      });

      const branding = await tx.tenantBranding.findUnique({ where: { tenantId: session.tenantId } });
      return { ticket, branding };
    }
  );

  // Sent after the transaction commits — email delivery never blocks/rolls back the mutation.
  // M21.4: gated by the requester's own notification preferences.
  const decision = await getEmailDecision(session.tenantId, session.subjectId, "ticketCreated");
  if (decision === "send") {
    await sendTicketCreatedEmail(ticket, session.email, branding);
  } else if (decision === "digest") {
    await queueDigestEmail({
      tenantId: session.tenantId,
      subjectId: session.subjectId,
      eventKey: "ticketCreated",
      subject: `[#${ticket.ticketNumber}] We received your request`,
      body: `Your ticket ${ticket.reference} was created.`,
      ticketRef: ticket.reference,
      ticketUrl: `/portal/tickets/${ticket.id}`,
    });
  }

  // Z8.2 — fire TICKET_CREATED triggers. Awaited so a rule that
  // reassigns the just-created ticket is reflected in the response
  // (matters for the redirect to /portal); failures are caught so a
  // broken rule can't fail the primary create.
  try {
    const { runRulesForEvent } = await import("@/lib/rule-engine");
    await runRulesForEvent({
      event: "TICKET_CREATED",
      ticketId: ticket.id,
      session: { tenantId: session.tenantId, subjectId: session.subjectId, role: session.role },
    });
  } catch {
    // Non-fatal — rule failures are logged to RuleRunLog by the engine.
  }

  revalidatePath("/portal");
  return { ok: true, ticket };
}

export async function listMyTickets(filter: Partial<z.infer<typeof ticketFilterSchema>> = {}) {
  const session = await requireSession();
  const f = ticketFilterSchema.parse(filter);
  const PAGE_SIZE = 20;

  return withRls({ tenantId: session.tenantId, userId: session.subjectId, role: session.role }, (tx) =>
    tx.ticket.findMany({
      where: {
        tenantId: session.tenantId,
        ...ticketClientWhereFor(session.subjectId, session.role),
        status: f.status,
      },
      include: { category: true },
      orderBy: { updatedAt: "desc" },
      skip: (f.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    })
  );
}

export async function listAllTickets(filter: Partial<z.infer<typeof ticketFilterSchema>> = {}) {
  const session = await requireSession({ minRole: "AGENT" });
  const f = ticketFilterSchema.parse(filter);
  const PAGE_SIZE = 50;

  const scopeWhere = await ticketScopeWhereFor(session);

  const rows = await withRls({ tenantId: session.tenantId, userId: session.subjectId, role: session.role }, (tx) =>
    tx.ticket.findMany({
      where: {
        tenantId: session.tenantId,
        // Scope goes in AND so a caller-supplied assignedTeamMemberId
        // filter intersects with the scope rather than overwriting it —
        // otherwise a GROUPS-scoped agent could pass an out-of-scope
        // assignee id via the query string and escape their scope.
        AND: [scopeWhere],
        status: f.status,
        priority: f.priority,
        categoryId: f.categoryId,
        assignedTeamMemberId: f.assignedToId === "unassigned" ? null : f.assignedToId || undefined,
        // Search on ticket title stays; the legacy `client.name` search
        // subquery is dropped for Z1.4b — wrapper-side text search is a
        // Z1.5+ concern (see boundary doc §7.9). Practical impact:
        // typing a client name in the queue search box only matches
        // ticket titles; agents can filter by assignee via the dropdown.
        ...(f.search
          ? { title: { contains: f.search, mode: "insensitive" } }
          : {}),
      },
      include: { category: true },
      orderBy: { updatedAt: "desc" },
      skip: (f.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    })
  );

  // Z1.4b: batch-resolve client + assignedTo across the returned page.
  // One roundtrip per kind regardless of page size (up to 50 rows).
  const wrapperCtx = systemContext(session.tenantId);
  const endUserIds = new Set<string>();
  const teamMemberIds = new Set<string>();
  for (const t of rows) {
    if (t.clientEndUserId) endUserIds.add(t.clientEndUserId);
    if (t.clientTeamMemberId) teamMemberIds.add(t.clientTeamMemberId);
    if (t.assignedTeamMemberId) teamMemberIds.add(t.assignedTeamMemberId);
  }
  const [endUsers, teamMembers, avatars] = await Promise.all([
    getEndUsersByIds(wrapperCtx, [...endUserIds]),
    getTeamMembersByIds(wrapperCtx, [...teamMemberIds]),
    getAvatarUrlsByIds(session.tenantId, [...endUserIds, ...teamMemberIds]),
  ]);

  return rows.map((t) => ({
    ...t,
    client: resolveUserLike(
      { endUserId: t.clientEndUserId, teamMemberId: t.clientTeamMemberId },
      endUsers,
      teamMembers,
      avatars,
    ),
    assignedTo: t.assignedTeamMemberId
      ? (() => {
          const tm = teamMembers.get(t.assignedTeamMemberId);
          return tm ? teamMemberToUserLike(tm, avatars) : null;
        })()
      : null,
  }));
}

/** Returns the ticket + messages, filtering internal notes for clients. Every attachment's fileUrl comes back as a ready-to-use, short-lived signed URL (the DB only ever stores the private storage path). */
export async function getTicket(ticketId: string) {
  const session = await requireSession();

  // Z1.4b: identity comes from the wrapper (see docs/shared-platform-boundary.md
  // §7.9). Only category / guest / attachments (as rows) / messages
  // (as rows) stay as Prisma includes — those are Support-owned.
  const ticket = await withRls({ tenantId: session.tenantId, userId: session.subjectId, role: session.role }, async (tx) => {
    const t = await tx.ticket.findFirst({
      where: { id: ticketId, tenantId: session.tenantId },
      include: {
        category: true,
        attachments: { orderBy: { uploadedAt: "desc" } },
        messages: {
          where: session.role === "CLIENT" ? { isInternal: false } : undefined,
          orderBy: { createdAt: "asc" },
          include: {
            // Guest stays: Support-owned model, not the wrapper's turf.
            guest: { select: { name: true, email: true } },
            attachments: true,
          },
        },
      },
    });
    if (!t) return null;
    if (session.role === "CLIENT" && t.clientEndUserId !== session.subjectId) return null;
    return t;
  });
  if (!ticket) return null;

  // Z5.2 — scope re-check for team members. A GROUPS- or ASSIGNED_ONLY-
  // scoped agent must not be able to load an out-of-scope ticket by
  // pasting its id into the URL. Return null (upstream treats null as 404).
  if (session.role === "AGENT" || session.role === "ADMIN") {
    const scope = session.ticketAccessScope ?? "ALL";
    if (scope === "ASSIGNED_ONLY") {
      if (ticket.assignedTeamMemberId !== session.subjectId) return null;
    } else if (scope === "GROUPS") {
      const isSelf = ticket.assignedTeamMemberId === session.subjectId;
      const isUnassigned = ticket.assignedTeamMemberId === null;
      if (!isSelf && !isUnassigned) {
        const ctx = systemContext(session.tenantId);
        const teammates = await Promise.all(
          session.groupIds.map((gid) => listTeamMembersInGroup(ctx, gid))
        );
        const teammateIds = new Set(teammates.flat().map((m) => m.id));
        if (!ticket.assignedTeamMemberId || !teammateIds.has(ticket.assignedTeamMemberId)) return null;
      }
    }
  }

  // Batch-resolve every identity referenced in this ticket tree.
  // Three roundtrips per ticket, regardless of message/attachment count.
  const wrapperCtx = systemContext(session.tenantId);
  const endUserIds = new Set<string>();
  const teamMemberIds = new Set<string>();
  const organizationIds = new Set<string>();
  if (ticket.clientEndUserId) endUserIds.add(ticket.clientEndUserId);
  if (ticket.clientTeamMemberId) teamMemberIds.add(ticket.clientTeamMemberId);
  if (ticket.assignedTeamMemberId) teamMemberIds.add(ticket.assignedTeamMemberId);
  if (ticket.organizationId) organizationIds.add(ticket.organizationId);
  for (const a of ticket.attachments) {
    if (a.uploadedByEndUserId) endUserIds.add(a.uploadedByEndUserId);
    if (a.uploadedByTeamMemberId) teamMemberIds.add(a.uploadedByTeamMemberId);
  }
  for (const m of ticket.messages) {
    if (m.senderEndUserId) endUserIds.add(m.senderEndUserId);
    if (m.senderTeamMemberId) teamMemberIds.add(m.senderTeamMemberId);
    for (const a of m.attachments) {
      if (a.uploadedByEndUserId) endUserIds.add(a.uploadedByEndUserId);
      if (a.uploadedByTeamMemberId) teamMemberIds.add(a.uploadedByTeamMemberId);
    }
  }
  const [endUsers, teamMembers, organizations, avatars] = await Promise.all([
    getEndUsersByIds(wrapperCtx, [...endUserIds]),
    getTeamMembersByIds(wrapperCtx, [...teamMemberIds]),
    getOrganizationsByIds(wrapperCtx, [...organizationIds]),
    getAvatarUrlsByIds(session.tenantId, [...endUserIds, ...teamMemberIds]),
  ]);

  const client: UserLike | null = resolveUserLike(
    { endUserId: ticket.clientEndUserId, teamMemberId: ticket.clientTeamMemberId },
    endUsers,
    teamMembers,
    avatars,
  );
  const assignedTo: UserLike | null = ticket.assignedTeamMemberId
    ? (() => {
        const tm = teamMembers.get(ticket.assignedTeamMemberId);
        return tm ? teamMemberToUserLike(tm, avatars) : null;
      })()
    : null;
  const organization: Organization | null = ticket.organizationId
    ? organizations.get(ticket.organizationId) ?? null
    : null;

  // Resolving signed URLs is an external Storage call, not a DB query — done
  // outside the transaction above so the interactive tx isn't held open
  // waiting on it (same reasoning as withRls's own docs on connection budget).
  const [messages, attachments] = await Promise.all([
    Promise.all(
      ticket.messages.map(async (m) => ({
        ...m,
        sender: resolveMessageSender(
          {
            senderEndUserId: m.senderEndUserId,
            senderTeamMemberId: m.senderTeamMemberId,
            guest: m.guest,
            senderRole: m.senderRole,
          },
          endUsers,
          teamMembers,
          avatars,
        ),
        attachments: await Promise.all(
          m.attachments.map(async (a) => ({
            ...a,
            uploadedBy: resolveUserLike(
              { endUserId: a.uploadedByEndUserId, teamMemberId: a.uploadedByTeamMemberId },
              endUsers,
              teamMembers,
              avatars,
            ),
            fileUrl: (await getAttachmentSignedUrl(a.fileUrl)) ?? a.fileUrl,
          }))
        ),
      }))
    ),
    Promise.all(
      ticket.attachments.map(async (a) => ({
        ...a,
        uploadedBy: resolveUserLike(
          { endUserId: a.uploadedByEndUserId, teamMemberId: a.uploadedByTeamMemberId },
          endUsers,
          teamMembers,
          avatars,
        ),
        fileUrl: (await getAttachmentSignedUrl(a.fileUrl)) ?? a.fileUrl,
      }))
    ),
  ]);

  return { ...ticket, client, assignedTo, organization, messages, attachments };
}

/**
 * Lighter sibling of getTicket() — just the messages, shaped exactly like
 * ConversationThread's ConversationMessage, for the polling loop in
 * conversation-thread.tsx (see its `onPoll` prop). Polled every few seconds
 * while a ticket's detail page is open, so a reply from the other side shows
 * up without a manual refresh; returning only messages (not the whole
 * ticket + attachments + audit trail) keeps that frequent a query cheap.
 */
export async function getTicketMessages(ticketId: string) {
  const session = await requireSession();

  // Z1.4b: same pattern as getTicket() but messages-only.
  const ticket = await withRls({ tenantId: session.tenantId, userId: session.subjectId, role: session.role }, async (tx) => {
    const t = await tx.ticket.findFirst({
      where: { id: ticketId, tenantId: session.tenantId },
      select: {
        clientEndUserId: true,
        clientTeamMemberId: true,
        messages: {
          where: session.role === "CLIENT" ? { isInternal: false } : undefined,
          orderBy: { createdAt: "asc" },
          include: { guest: { select: { name: true, email: true } }, attachments: true },
        },
      },
    });
    if (!t) return null;
    if (session.role === "CLIENT" && t.clientEndUserId !== session.subjectId) return null;
    return t;
  });
  if (!ticket) return null;

  const wrapperCtx = systemContext(session.tenantId);
  const endUserIds = new Set<string>();
  const teamMemberIds = new Set<string>();
  for (const m of ticket.messages) {
    if (m.senderEndUserId) endUserIds.add(m.senderEndUserId);
    if (m.senderTeamMemberId) teamMemberIds.add(m.senderTeamMemberId);
  }
  const [endUsers, teamMembers, avatars] = await Promise.all([
    getEndUsersByIds(wrapperCtx, [...endUserIds]),
    getTeamMembersByIds(wrapperCtx, [...teamMemberIds]),
    getAvatarUrlsByIds(session.tenantId, [...endUserIds, ...teamMemberIds]),
  ]);

  return Promise.all(
    ticket.messages.map(async (m) => ({
      id: m.id,
      body: m.body,
      senderRole: m.senderRole,
      isInternal: m.isInternal,
      createdAt: m.createdAt.toISOString(),
      sender: resolveMessageSender(
        {
          senderEndUserId: m.senderEndUserId,
          senderTeamMemberId: m.senderTeamMemberId,
          guest: m.guest,
          senderRole: m.senderRole,
        },
        endUsers,
        teamMembers,
        avatars,
      ),
      attachments: await Promise.all(
        m.attachments.map(async (a) => ({
          id: a.id,
          fileName: a.fileName,
          mimeType: a.mimeType,
          sizeBytes: a.sizeBytes,
          fileUrl: (await getAttachmentSignedUrl(a.fileUrl)) ?? a.fileUrl,
        }))
      ),
    }))
  );
}

const STATUS_TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  OPEN: ["IN_PROGRESS"],
  IN_PROGRESS: ["PENDING", "RESOLVED"],
  PENDING: ["IN_PROGRESS", "RESOLVED"],
  RESOLVED: ["CLOSED", "IN_PROGRESS"],
  CLOSED: ["IN_PROGRESS"],
};

/** FR-3.5: client reply. Auto-flips Pending -> In Progress per the lifecycle state machine. */
export async function postClientReply(input: z.infer<typeof replySchema>) {
  const session = await requireSession();
  const data = replySchema.parse(input);

  const { ticket, assignedAgent, branding } = await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const ticket = await tx.ticket.findFirst({
        where: {
          id: data.ticketId,
          tenantId: session.tenantId,
          ...ticketClientWhereFor(session.subjectId, session.role),
        },
      });
      if (!ticket) throw new Error("NOT_FOUND");

      const clientDual = dualFkForUser(session.subjectId, session.role);
      const message = await tx.message.create({
        data: {
          tenantId: session.tenantId,
          ticketId: ticket.id,
          ...senderCols(clientDual),
          senderRole: "CLIENT",
          body: data.body,
        },
      });
      if (data.attachmentIds && data.attachmentIds.length > 0) {
        // messageId: null guard — a client can only claim their OWN
        // just-uploaded, not-yet-attached files, never re-parent an
        // attachment that's already linked to some other message.
        await tx.attachment.updateMany({
          where: { id: { in: data.attachmentIds }, ticketId: ticket.id, tenantId: session.tenantId, messageId: null },
          data: { messageId: message.id },
        });
      }

      let updatedTicket = ticket;
      if (ticket.status === "PENDING") {
        updatedTicket = await tx.ticket.update({ where: { id: ticket.id }, data: { status: "IN_PROGRESS" } });
        await tx.auditLog.create({
          data: {
            tenantId: session.tenantId,
            ticketId: ticket.id,
            ...actorCols(clientDual),
            action: "STATUS_CHANGE",
            fromValue: "PENDING",
            toValue: "IN_PROGRESS",
          },
        });
      }

      // Z1.4b: assignedTeamMemberId → wrapper TeamMember (preserved id).
      const assignedAgent = ticket.assignedTeamMemberId
        ? await getTeamMember(systemContext(session.tenantId), ticket.assignedTeamMemberId)
        : null;
      if (assignedAgent && await shouldWriteInAppInTx(tx, assignedAgent.id, "ticketReply")) {
        await notify(tx, {
          tenantId: session.tenantId,
          userId: assignedAgent.id,
          type: "TICKET_REPLY",
          title: `${session.name} replied on ${ticket.reference}`,
          body: data.body.slice(0, 140),
          ticketId: ticket.id,
        });
      }
      const branding = await tx.tenantBranding.findUnique({ where: { tenantId: session.tenantId } });
      return { ticket: updatedTicket, assignedAgent, branding };
    }
  );

  if (assignedAgent) {
    const decision = await getEmailDecision(session.tenantId, assignedAgent.id, "ticketReply");
    if (decision === "send") {
      await sendClientReplyNotification(ticket, assignedAgent.email, branding);
    } else if (decision === "digest") {
      await queueDigestEmail({
        tenantId: session.tenantId,
        subjectId: assignedAgent.id,
        eventKey: "ticketReply",
        subject: `[#${ticket.ticketNumber}] Client replied`,
        body: `Client replied on ${ticket.reference}: ${data.body.slice(0, 200)}`,
        ticketRef: ticket.reference,
        ticketUrl: `/agent/tickets/${ticket.id}`,
      });
    }
  }

  revalidatePath(`/portal/tickets/${ticket.id}`);
  return { ok: true };
}

/** FR-4.7/4.8: agent client-visible reply or internal note. */
export async function postAgentReply(input: z.infer<typeof agentReplySchema>) {
  const session = await requireSession({ minRole: "AGENT" });
  const data = agentReplySchema.parse(input);

  // Z5.5 — Light Agent guardrail. Light Agents can read every ticket in
  // their scope and add internal notes, but must never be able to send a
  // public message. Enforced server-side (not just hidden in the UI) so
  // macros, keyboard shortcuts, or a hand-crafted request can't bypass it.
  if (session.roleName === "Light Agent" && !data.isInternal) {
    throw new Error("LIGHT_AGENT_NO_PUBLIC_REPLY");
  }

  const { ticket, client, branding } = await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const ticket = await tx.ticket.findFirst({ where: { id: data.ticketId, tenantId: session.tenantId } });
      if (!ticket) throw new Error("NOT_FOUND");

      const staffDual = dualFkForUser(session.subjectId, session.role);
      const message = await tx.message.create({
        data: {
          tenantId: session.tenantId,
          ticketId: ticket.id,
          ...senderCols(staffDual),
          senderRole: session.role === "ADMIN" || session.role === "SUPER_ADMIN" ? "ADMIN" : "AGENT",
          body: data.body,
          isInternal: data.isInternal,
        },
      });
      if (data.attachmentIds && data.attachmentIds.length > 0) {
        await tx.attachment.updateMany({
          where: { id: { in: data.attachmentIds }, ticketId: ticket.id, tenantId: session.tenantId, messageId: null },
          data: { messageId: message.id },
        });
      }

      if (!data.isInternal && !ticket.firstReplyAt) {
        await tx.ticket.update({ where: { id: ticket.id }, data: { firstReplyAt: new Date() } });
      }

      await tx.auditLog.create({
        data: {
          tenantId: session.tenantId,
          ticketId: ticket.id,
          ...actorCols(staffDual),
          action: data.isInternal ? "INTERNAL_NOTE" : "REPLY",
        },
      });

      // Z1.4b: resolve client via wrapper. Ticket.clientEndUserId or
      // .clientTeamMemberId is guaranteed non-null (dual-write invariant).
      const wrapperCtx = systemContext(session.tenantId);
      const client = ticket.clientEndUserId
        ? await getEndUser(wrapperCtx, ticket.clientEndUserId)
        : ticket.clientTeamMemberId
          ? await getTeamMember(wrapperCtx, ticket.clientTeamMemberId)
          : null;
      if (!client) throw new Error("CLIENT_MISSING");
      if (!data.isInternal && await shouldWriteInAppInTx(tx, client.id, "ticketReply")) {
        await notify(tx, {
          tenantId: session.tenantId,
          userId: client.id,
          type: "TICKET_REPLY",
          title: `New reply on ${ticket.reference}`,
          body: data.body.slice(0, 140),
          ticketId: ticket.id,
        });
      }
      const branding = await tx.tenantBranding.findUnique({ where: { tenantId: session.tenantId } });
      return { ticket, client, branding };
    }
  );

  if (!data.isInternal) {
    const decision = await getEmailDecision(session.tenantId, client.id, "ticketReply");
    if (decision === "send") {
      await sendAgentReplyEmail(ticket, client.email, branding);
    } else if (decision === "digest") {
      await queueDigestEmail({
        tenantId: session.tenantId,
        subjectId: client.id,
        eventKey: "ticketReply",
        subject: `[#${ticket.ticketNumber}] New reply on your ticket`,
        body: `New reply on ${ticket.reference}: ${data.body.slice(0, 200)}`,
        ticketRef: ticket.reference,
        ticketUrl: `/portal/tickets/${ticket.id}`,
      });
    }
  }

  // Z8.2 — fire TICKET_REPLIED. Internal notes don't fire (spec's
  // "reply posted" is a public-message event).
  if (!data.isInternal) {
    try {
      const { runRulesForEvent } = await import("@/lib/rule-engine");
      await runRulesForEvent({
        event: "TICKET_REPLIED",
        ticketId: ticket.id,
        session: { tenantId: session.tenantId, subjectId: session.subjectId, role: session.role },
      });
    } catch {
      // Non-fatal.
    }
  }

  revalidatePath(`/agent/tickets/${ticket.id}`);
  return { ok: true };
}

/** FR-4.5/4.6: status/priority/assignment updates, enforcing the lifecycle state machine. */
export async function updateTicket(input: z.infer<typeof updateTicketSchema>) {
  const session = await requireSession({ minRole: "AGENT" });
  const data = updateTicketSchema.parse(input);

  const { updated, statusChanged, client, branding } = await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const ticket = await tx.ticket.findFirst({ where: { id: data.ticketId, tenantId: session.tenantId } });
      if (!ticket) throw new Error("NOT_FOUND");

      if (data.status && data.status !== ticket.status) {
        const allowed = STATUS_TRANSITIONS[ticket.status];
        if (!allowed.includes(data.status)) {
          throw new Error(`INVALID_TRANSITION: ${ticket.status} -> ${data.status}`);
        }
      }

      // A manual agent-driven status change (not just the explicit
      // reopenTicket() action) can also move a ticket back out of
      // Resolved/Closed — counts as a reopen for the analytics KPI too, so
      // both paths increment the same counter (see reopenTicket() above).
      const isReopen =
        Boolean(data.status) &&
        ["RESOLVED", "CLOSED"].includes(ticket.status) &&
        !["RESOLVED", "CLOSED"].includes(data.status!);

      const staffDual = dualFkForUser(session.subjectId, session.role);
      const updated = await tx.ticket.update({
        where: { id: ticket.id },
        data: {
          status: data.status,
          priority: data.priority,
          // undefined preserves existing; null clears; a value sets it.
          ...(data.assignedToId !== undefined
            ? assignedTeamMemberCol(data.assignedToId)
            : {}),
          resolvedAt: data.status === "RESOLVED" ? new Date() : data.status === "IN_PROGRESS" ? null : undefined,
          ...(isReopen ? { reopenedAt: new Date(), reopenCount: { increment: 1 } } : {}),
        },
      });

      const statusChanged = Boolean(data.status && data.status !== ticket.status);

      if (statusChanged) {
        await tx.auditLog.create({
          data: {
            tenantId: session.tenantId,
            ticketId: ticket.id,
            ...actorCols(staffDual),
            action: "STATUS_CHANGE",
            fromValue: ticket.status,
            toValue: data.status,
          },
        });
      }
      if (data.priority && data.priority !== ticket.priority) {
        await tx.auditLog.create({
          data: {
            tenantId: session.tenantId,
            ticketId: ticket.id,
            ...actorCols(staffDual),
            action: "PRIORITY_CHANGE",
            fromValue: ticket.priority,
            toValue: data.priority,
          },
        });
      }
      if (data.assignedToId !== undefined && data.assignedToId !== ticket.assignedTeamMemberId) {
        // Store the agents' names (not their raw IDs) so the audit log reads
        // "Unassigned → Jordan Reyes" rather than a meaningless cuid. Sequential
        // (not Promise.all): concurrent queries on one interactive-tx client are
        // unsupported by Prisma.
        // Z1.4b: agent name resolution via wrapper (staff → TeamMember).
        const wrapperCtx = systemContext(session.tenantId);
        const fromAgent = ticket.assignedTeamMemberId
          ? await getTeamMember(wrapperCtx, ticket.assignedTeamMemberId)
          : null;
        const toAgent = data.assignedToId
          ? await getTeamMember(wrapperCtx, data.assignedToId)
          : null;
        await tx.auditLog.create({
          data: {
            tenantId: session.tenantId,
            ticketId: ticket.id,
            ...actorCols(staffDual),
            action: "ASSIGN",
            fromValue: fromAgent?.name ?? "Unassigned",
            toValue: toAgent?.name ?? "Unassigned",
          },
        });
        if (data.assignedToId && await shouldWriteInAppInTx(tx, data.assignedToId, "assigned")) {
          await notify(tx, {
            tenantId: session.tenantId,
            userId: data.assignedToId,
            type: "ASSIGNED",
            title: `You were assigned ${ticket.reference}`,
            body: ticket.title,
            ticketId: ticket.id,
          });
        }
      }

      // Z1.4b: resolve client via wrapper (dual-FK invariant guarantees non-null).
      const client = ticket.clientEndUserId
        ? await getEndUser(systemContext(session.tenantId), ticket.clientEndUserId)
        : ticket.clientTeamMemberId
          ? await getTeamMember(systemContext(session.tenantId), ticket.clientTeamMemberId)
          : null;
      if (!client) throw new Error("CLIENT_MISSING");
      if (statusChanged && await shouldWriteInAppInTx(tx, client.id, "statusChange")) {
        await notify(tx, {
          tenantId: session.tenantId,
          userId: client.id,
          type: "STATUS_CHANGE",
          title: `${ticket.reference} is now ${data.status?.replace("_", " ").toLowerCase()}`,
          ticketId: ticket.id,
        });
      }
      const branding = await tx.tenantBranding.findUnique({ where: { tenantId: session.tenantId } });
      return { updated, statusChanged, client, branding };
    }
  );

  // Auto-close (Resolved -> Closed after +7d) runs as an hourly Inngest cron —
  // see src/lib/inngest/functions/auto-close.ts. Requires `npx inngest-cli dev`
  // running locally to actually fire (see README "Background jobs").
  if (statusChanged) {
    const decision = await getEmailDecision(session.tenantId, client.id, "statusChange");
    if (decision === "send") {
      await sendStatusChangeEmail(updated, client.email, branding);
    } else if (decision === "digest") {
      await queueDigestEmail({
        tenantId: session.tenantId,
        subjectId: client.id,
        eventKey: "statusChange",
        subject: `[#${updated.ticketNumber}] Status changed`,
        body: `${updated.reference} is now ${updated.status.replace("_", " ").toLowerCase()}.`,
        ticketRef: updated.reference,
        ticketUrl: `/portal/tickets/${updated.id}`,
      });
    }
  }

  // CSAT request fires only the moment a ticket newly becomes Resolved (not
  // on every subsequent status touch, e.g. a later Resolved -> Closed
  // confirmation) — see analytics' CSAT KPI (actions/admin.ts) and the
  // rating page (app/rate/[token]).
  //
  // M21.4: CSAT emails are never digested (time-sensitive single-use link) —
  // the DIGESTABLE map in notification-prefs.ts flags this, so digest mode
  // still gets a real-time send if the toggle is on.
  if (statusChanged && updated.status === "RESOLVED") {
    const csatDecision = await getEmailDecision(session.tenantId, client.id, "csatRequest");
    if (csatDecision === "send") {
      const token = await signCsatToken({ ticketId: updated.id, tenantId: session.tenantId });
      const rateUrl = `${siteUrl()}/rate/${encodeURIComponent(token)}`;
      await sendCsatRequestEmail(client.email, rateUrl, branding);
    }
  }

  // Z8.2 — fire the update-family events. All are attempted best-effort
  // and share the same session; the rule engine tracks its own
  // invocation depth. TICKET_UPDATED always fires; STATUS_CHANGED and
  // PRIORITY_CHANGED only fire when those actually changed so their
  // rules don't run on unrelated edits.
  try {
    const { runRulesForEvent } = await import("@/lib/rule-engine");
    const engineSession = { tenantId: session.tenantId, subjectId: session.subjectId, role: session.role };
    await runRulesForEvent({ event: "TICKET_UPDATED", ticketId: updated.id, session: engineSession });
    if (statusChanged) {
      await runRulesForEvent({ event: "STATUS_CHANGED", ticketId: updated.id, session: engineSession });
    }
    if (data.priority !== undefined) {
      await runRulesForEvent({ event: "PRIORITY_CHANGED", ticketId: updated.id, session: engineSession });
    }
  } catch {
    // Non-fatal.
  }

  revalidatePath(`/agent/tickets/${updated.id}`);
  revalidatePath(`/portal/tickets/${updated.id}`);
  return { ok: true, ticket: updated };
}

/** A-9: client may confirm resolution (-> Closed) or reopen; cannot arbitrarily close. */
export async function confirmResolution(ticketId: string) {
  const session = await requireSession();
  return withRls({ tenantId: session.tenantId, userId: session.subjectId, role: session.role }, async (tx) => {
    const ticket = await tx.ticket.findFirst({
      where: {
        id: ticketId,
        tenantId: session.tenantId,
        ...ticketClientWhereFor(session.subjectId, session.role),
        status: "RESOLVED",
      },
    });
    if (!ticket) throw new Error("NOT_FOUND_OR_NOT_RESOLVED");
    await tx.ticket.update({ where: { id: ticket.id }, data: { status: "CLOSED" } });
    await tx.auditLog.create({
      data: {
        tenantId: session.tenantId,
        ticketId: ticket.id,
        ...actorCols(dualFkForUser(session.subjectId, session.role)),
        action: "STATUS_CHANGE",
        fromValue: "RESOLVED",
        toValue: "CLOSED",
      },
    });
    revalidatePath(`/portal/tickets/${ticket.id}`);
    return { ok: true };
  });
}

export async function reopenTicket(ticketId: string) {
  const session = await requireSession();
  return withRls({ tenantId: session.tenantId, userId: session.subjectId, role: session.role }, async (tx) => {
    const where =
      session.role === "CLIENT"
        ? { id: ticketId, tenantId: session.tenantId, clientEndUserId: session.subjectId }
        : { id: ticketId, tenantId: session.tenantId };
    const ticket = await tx.ticket.findFirst({ where });
    if (!ticket || !["RESOLVED", "CLOSED"].includes(ticket.status)) throw new Error("NOT_FOUND_OR_NOT_REOPENABLE");

    await tx.ticket.update({
      where: { id: ticket.id },
      data: { status: "IN_PROGRESS", resolvedAt: null, reopenedAt: new Date(), reopenCount: { increment: 1 } },
    });
    await tx.auditLog.create({
      data: {
        tenantId: session.tenantId,
        ticketId: ticket.id,
        ...actorCols(dualFkForUser(session.subjectId, session.role)),
        action: "REOPEN",
        fromValue: ticket.status,
        toValue: "IN_PROGRESS",
      },
    });
    revalidatePath(`/portal/tickets/${ticket.id}`);
    revalidatePath(`/agent/tickets/${ticket.id}`);
    return { ok: true };
  });
}

export async function listCategories() {
  const session = await requireSession();
  return withRls({ tenantId: session.tenantId, userId: session.subjectId, role: session.role }, (tx) =>
    tx.category.findMany({ where: { tenantId: session.tenantId, isActive: true }, orderBy: { name: "asc" } })
  );
}

export async function listAgents() {
  const session = await requireSession({ minRole: "AGENT" });
  // Z1.4b: fetch every TeamMember on the tenant, then filter out the
  // Super Admin role client-side (preserves legacy behavior — legacy
  // listAgents excluded SUPER_ADMIN from the assignable pool). Not a
  // wrapper limitation worth widening for one call site; Z1.6's admin
  // refactor may generalize this if more places need role-filtered TM
  // lists.
  const wrapperCtx = systemContext(session.tenantId);
  const [tmPage, superAdminRole] = await Promise.all([
    listTeamMembers(wrapperCtx, { limit: 200 }),
    getRoleByName(wrapperCtx, "Super Admin"),
  ]);
  const assignable = tmPage.items
    .filter((tm) => !superAdminRole || tm.roleId !== superAdminRole.id)
    .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
  return assignable;
}
