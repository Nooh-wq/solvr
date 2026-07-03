"use server";

import { revalidatePath } from "next/cache";
import { withRls } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import {
  createTicketSchema,
  replySchema,
  agentReplySchema,
  updateTicketSchema,
  ticketFilterSchema,
} from "@/lib/validation/ticket";
import type { z } from "zod";
import type { TicketStatus } from "@/generated/prisma";
import {
  sendTicketCreatedEmail,
  sendAgentReplyEmail,
  sendClientReplyNotification,
  sendStatusChangeEmail,
} from "@/lib/email/events";
import { createWithReference } from "@/lib/ticket-number";
import { notify } from "@/lib/notifications";

/** FR-2: client creates a ticket. Status defaults to Open; fires the "received" email. */
export async function createTicket(input: z.infer<typeof createTicketSchema>) {
  const session = await requireSession();
  const data = createTicketSchema.parse(input);

  const { ticket, branding } = await withRls(
    { tenantId: session.tenantId, userId: session.id, role: session.role },
    async (tx) => {
      const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: session.tenantId } });

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
            clientId: session.id,
            status: "OPEN",
            source: "portal",
          },
        })
      );

      await tx.auditLog.create({
        data: {
          tenantId: session.tenantId,
          ticketId: ticket.id,
          actorId: session.id,
          action: "CREATE",
          toValue: "OPEN",
        },
      });

      const branding = await tx.tenantBranding.findUnique({ where: { tenantId: session.tenantId } });
      return { ticket, branding };
    }
  );

  // Sent after the transaction commits — email delivery never blocks/rolls back the mutation.
  await sendTicketCreatedEmail(ticket, session.email, branding);

  revalidatePath("/portal");
  return { ok: true, ticket };
}

export async function listMyTickets(filter: Partial<z.infer<typeof ticketFilterSchema>> = {}) {
  const session = await requireSession();
  const f = ticketFilterSchema.parse(filter);
  const PAGE_SIZE = 20;

  return withRls({ tenantId: session.tenantId, userId: session.id, role: session.role }, (tx) =>
    tx.ticket.findMany({
      where: {
        tenantId: session.tenantId,
        clientId: session.id,
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

  return withRls({ tenantId: session.tenantId, userId: session.id, role: session.role }, (tx) =>
    tx.ticket.findMany({
      where: {
        tenantId: session.tenantId,
        status: f.status,
        priority: f.priority,
        categoryId: f.categoryId,
        assignedToId: f.assignedToId === "unassigned" ? null : f.assignedToId || undefined,
        ...(f.search
          ? {
              OR: [
                { title: { contains: f.search, mode: "insensitive" } },
                { client: { name: { contains: f.search, mode: "insensitive" } } },
              ],
            }
          : {}),
      },
      include: { category: true, client: true, assignedTo: true },
      orderBy: { updatedAt: "desc" },
      skip: (f.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    })
  );
}

/** Returns the ticket + messages, filtering internal notes for clients. */
export async function getTicket(ticketId: string) {
  const session = await requireSession();

  return withRls({ tenantId: session.tenantId, userId: session.id, role: session.role }, async (tx) => {
    const ticket = await tx.ticket.findFirst({
      where: { id: ticketId, tenantId: session.tenantId },
      include: {
        category: true,
        client: true,
        assignedTo: true,
        attachments: true,
        messages: {
          where: session.role === "CLIENT" ? { isInternal: false } : undefined,
          orderBy: { createdAt: "asc" },
          include: { sender: true },
        },
      },
    });
    if (!ticket) return null;
    if (session.role === "CLIENT" && ticket.clientId !== session.id) return null;
    return ticket;
  });
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
    { tenantId: session.tenantId, userId: session.id, role: session.role },
    async (tx) => {
      const ticket = await tx.ticket.findFirst({
        where: { id: data.ticketId, tenantId: session.tenantId, clientId: session.id },
      });
      if (!ticket) throw new Error("NOT_FOUND");

      await tx.message.create({
        data: {
          tenantId: session.tenantId,
          ticketId: ticket.id,
          senderId: session.id,
          senderRole: "CLIENT",
          body: data.body,
        },
      });

      let updatedTicket = ticket;
      if (ticket.status === "PENDING") {
        updatedTicket = await tx.ticket.update({ where: { id: ticket.id }, data: { status: "IN_PROGRESS" } });
        await tx.auditLog.create({
          data: {
            tenantId: session.tenantId,
            ticketId: ticket.id,
            actorId: session.id,
            action: "STATUS_CHANGE",
            fromValue: "PENDING",
            toValue: "IN_PROGRESS",
          },
        });
      }

      const assignedAgent = ticket.assignedToId
        ? await tx.user.findUnique({ where: { id: ticket.assignedToId } })
        : null;
      if (assignedAgent) {
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

  if (assignedAgent) await sendClientReplyNotification(ticket, assignedAgent.email, branding);

  revalidatePath(`/portal/tickets/${ticket.id}`);
  return { ok: true };
}

/** FR-4.7/4.8: agent client-visible reply or internal note. */
export async function postAgentReply(input: z.infer<typeof agentReplySchema>) {
  const session = await requireSession({ minRole: "AGENT" });
  const data = agentReplySchema.parse(input);

  const { ticket, client, branding } = await withRls(
    { tenantId: session.tenantId, userId: session.id, role: session.role },
    async (tx) => {
      const ticket = await tx.ticket.findFirst({ where: { id: data.ticketId, tenantId: session.tenantId } });
      if (!ticket) throw new Error("NOT_FOUND");

      await tx.message.create({
        data: {
          tenantId: session.tenantId,
          ticketId: ticket.id,
          senderId: session.id,
          senderRole: session.role === "ADMIN" || session.role === "SUPER_ADMIN" ? "ADMIN" : "AGENT",
          body: data.body,
          isInternal: data.isInternal,
        },
      });

      if (!data.isInternal && !ticket.firstReplyAt) {
        await tx.ticket.update({ where: { id: ticket.id }, data: { firstReplyAt: new Date() } });
      }

      await tx.auditLog.create({
        data: {
          tenantId: session.tenantId,
          ticketId: ticket.id,
          actorId: session.id,
          action: data.isInternal ? "INTERNAL_NOTE" : "REPLY",
        },
      });

      const client = await tx.user.findUniqueOrThrow({ where: { id: ticket.clientId } });
      if (!data.isInternal) {
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

  if (!data.isInternal) await sendAgentReplyEmail(ticket, client.email, branding);

  revalidatePath(`/agent/tickets/${ticket.id}`);
  return { ok: true };
}

/** FR-4.5/4.6: status/priority/assignment updates, enforcing the lifecycle state machine. */
export async function updateTicket(input: z.infer<typeof updateTicketSchema>) {
  const session = await requireSession({ minRole: "AGENT" });
  const data = updateTicketSchema.parse(input);

  const { updated, statusChanged, client, branding } = await withRls(
    { tenantId: session.tenantId, userId: session.id, role: session.role },
    async (tx) => {
      const ticket = await tx.ticket.findFirst({ where: { id: data.ticketId, tenantId: session.tenantId } });
      if (!ticket) throw new Error("NOT_FOUND");

      if (data.status && data.status !== ticket.status) {
        const allowed = STATUS_TRANSITIONS[ticket.status];
        if (!allowed.includes(data.status)) {
          throw new Error(`INVALID_TRANSITION: ${ticket.status} -> ${data.status}`);
        }
      }

      const updated = await tx.ticket.update({
        where: { id: ticket.id },
        data: {
          status: data.status,
          priority: data.priority,
          assignedToId: data.assignedToId === undefined ? undefined : data.assignedToId,
          resolvedAt: data.status === "RESOLVED" ? new Date() : data.status === "IN_PROGRESS" ? null : undefined,
        },
      });

      const statusChanged = Boolean(data.status && data.status !== ticket.status);

      if (statusChanged) {
        await tx.auditLog.create({
          data: {
            tenantId: session.tenantId,
            ticketId: ticket.id,
            actorId: session.id,
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
            actorId: session.id,
            action: "PRIORITY_CHANGE",
            fromValue: ticket.priority,
            toValue: data.priority,
          },
        });
      }
      if (data.assignedToId !== undefined && data.assignedToId !== ticket.assignedToId) {
        // Store the agents' names (not their raw IDs) so the audit log reads
        // "Unassigned → Jordan Reyes" rather than a meaningless cuid. Sequential
        // (not Promise.all): concurrent queries on one interactive-tx client are
        // unsupported by Prisma.
        const fromAgent = ticket.assignedToId
          ? await tx.user.findUnique({ where: { id: ticket.assignedToId }, select: { name: true } })
          : null;
        const toAgent = data.assignedToId
          ? await tx.user.findUnique({ where: { id: data.assignedToId }, select: { name: true } })
          : null;
        await tx.auditLog.create({
          data: {
            tenantId: session.tenantId,
            ticketId: ticket.id,
            actorId: session.id,
            action: "ASSIGN",
            fromValue: fromAgent?.name ?? "Unassigned",
            toValue: toAgent?.name ?? "Unassigned",
          },
        });
        if (data.assignedToId) {
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

      const client = await tx.user.findUniqueOrThrow({ where: { id: ticket.clientId } });
      if (statusChanged) {
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
  if (statusChanged) await sendStatusChangeEmail(updated, client.email, branding);

  revalidatePath(`/agent/tickets/${updated.id}`);
  revalidatePath(`/portal/tickets/${updated.id}`);
  return { ok: true, ticket: updated };
}

/** A-9: client may confirm resolution (-> Closed) or reopen; cannot arbitrarily close. */
export async function confirmResolution(ticketId: string) {
  const session = await requireSession();
  return withRls({ tenantId: session.tenantId, userId: session.id, role: session.role }, async (tx) => {
    const ticket = await tx.ticket.findFirst({
      where: { id: ticketId, tenantId: session.tenantId, clientId: session.id, status: "RESOLVED" },
    });
    if (!ticket) throw new Error("NOT_FOUND_OR_NOT_RESOLVED");
    await tx.ticket.update({ where: { id: ticket.id }, data: { status: "CLOSED" } });
    await tx.auditLog.create({
      data: {
        tenantId: session.tenantId,
        ticketId: ticket.id,
        actorId: session.id,
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
  return withRls({ tenantId: session.tenantId, userId: session.id, role: session.role }, async (tx) => {
    const where =
      session.role === "CLIENT"
        ? { id: ticketId, tenantId: session.tenantId, clientId: session.id }
        : { id: ticketId, tenantId: session.tenantId };
    const ticket = await tx.ticket.findFirst({ where });
    if (!ticket || !["RESOLVED", "CLOSED"].includes(ticket.status)) throw new Error("NOT_FOUND_OR_NOT_REOPENABLE");

    await tx.ticket.update({ where: { id: ticket.id }, data: { status: "IN_PROGRESS", resolvedAt: null } });
    await tx.auditLog.create({
      data: {
        tenantId: session.tenantId,
        ticketId: ticket.id,
        actorId: session.id,
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
  return withRls({ tenantId: session.tenantId, userId: session.id, role: session.role }, (tx) =>
    tx.category.findMany({ where: { tenantId: session.tenantId, isActive: true }, orderBy: { name: "asc" } })
  );
}

export async function listAgents() {
  const session = await requireSession({ minRole: "AGENT" });
  return withRls({ tenantId: session.tenantId, userId: session.id, role: session.role }, (tx) =>
    tx.user.findMany({
      where: { tenantId: session.tenantId, role: { in: ["AGENT", "ADMIN"] }, status: "ACTIVE" },
      orderBy: { name: "asc" },
    })
  );
}
