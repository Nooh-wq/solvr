"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { withRls } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { createGuestToken, parseGuestToken } from "@/lib/guest-access";
import { sendTicketGuestInviteEmail, sendClientReplyNotification } from "@/lib/email/events";
import { notify } from "@/lib/notifications";
import { uploadAttachment, getAttachmentSignedUrl } from "@/lib/storage";
import { ATTACHMENT_ALLOWED_MIME, ATTACHMENT_MAX_BYTES } from "@/lib/validation/ticket";
import type { TenantBranding } from "@/generated/prisma";
import crypto from "node:crypto";

function siteUrl() {
  return process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
}

const inviteGuestSchema = z.object({
  ticketId: z.string().cuid(),
  email: z.string().trim().email("Enter a valid email address."),
  name: z.string().trim().max(120).optional(),
});

/** Agent/admin can add a guest to any tenant ticket; a client only to their own — enforced by the ticket_guest_write RLS policy (see prisma/rls_policies.sql), same tenantId/ticket ownership check getTicket() applies. */
export async function inviteTicketGuest(
  input: z.infer<typeof inviteGuestSchema>
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await requireSession();
  const parsed = inviteGuestSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const data = parsed.data;

  const { raw, tokenHash } = createGuestToken(session.tenantId);

  let result: { reference: string; branding: TenantBranding | null };
  try {
    result = await withRls({ tenantId: session.tenantId, userId: session.id, role: session.role }, async (tx) => {
      const ticket = await tx.ticket.findFirst({ where: { id: data.ticketId, tenantId: session.tenantId } });
      if (!ticket) throw new Error("NOT_FOUND");
      if (session.role === "CLIENT" && ticket.clientId !== session.id) throw new Error("NOT_FOUND");

      await tx.ticketGuest.create({
        data: {
          tenantId: session.tenantId,
          ticketId: ticket.id,
          email: data.email,
          name: data.name,
          tokenHash,
          invitedById: session.id,
        },
      });
      const branding = await tx.tenantBranding.findUnique({ where: { tenantId: session.tenantId } });
      return { reference: ticket.reference, branding };
    });
  } catch {
    return { ok: false, error: "Ticket not found." };
  }

  const guestUrl = `${siteUrl()}/guest/${raw}`;
  await sendTicketGuestInviteEmail(data.email, guestUrl, result.reference, session.name, result.branding);

  revalidatePath(`/agent/tickets/${data.ticketId}`);
  revalidatePath(`/portal/tickets/${data.ticketId}`);
  return { ok: true };
}

export type TicketGuestSummary = { id: string; email: string; name: string | null; createdAt: string; revoked: boolean };

export async function listTicketGuests(ticketId: string): Promise<TicketGuestSummary[]> {
  const session = await requireSession();
  const rows = await withRls({ tenantId: session.tenantId, userId: session.id, role: session.role }, (tx) =>
    tx.ticketGuest.findMany({ where: { ticketId, tenantId: session.tenantId }, orderBy: { createdAt: "desc" } })
  );
  return rows.map((g) => ({ id: g.id, email: g.email, name: g.name, createdAt: g.createdAt.toISOString(), revoked: g.revokedAt !== null }));
}

export async function revokeTicketGuest(guestId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await requireSession();
  const result = await withRls({ tenantId: session.tenantId, userId: session.id, role: session.role }, (tx) =>
    tx.ticketGuest.updateMany({
      where: { id: guestId, tenantId: session.tenantId },
      data: { revokedAt: new Date() },
    })
  );
  if (result.count === 0) return { ok: false, error: "Guest not found." };
  return { ok: true };
}

/** Resolves + validates a raw guest token without requiring any session. Returns null for an invalid, revoked, or tampered token. */
async function resolveGuestSession(rawToken: string) {
  const parsed = parseGuestToken(rawToken);
  if (!parsed) return null;

  // Neutral (non-GUEST) role for this one lookup: ticket_guest_read is
  // tenant-scoped only, and we don't know the guest's ticket yet — that's
  // exactly what this query resolves.
  const guest = await withRls({ tenantId: parsed.tenantId, userId: null }, (tx) =>
    tx.ticketGuest.findFirst({ where: { tenantId: parsed.tenantId, tokenHash: parsed.tokenHash } })
  );
  if (!guest || guest.revokedAt) return null;
  return { guestId: guest.id, tenantId: guest.tenantId, ticketId: guest.ticketId, email: guest.email, name: guest.name };
}

export type GuestTicketView = {
  reference: string;
  title: string;
  status: string;
  priority: string;
  description: string;
  clientName: string;
  guestName: string;
  messages: {
    id: string;
    body: string;
    senderRole: string;
    isInternal: boolean;
    createdAt: string;
    sender: { name: string; avatarUrl: string | null } | null;
    attachments: { id: string; fileName: string; mimeType: string; sizeBytes: number; fileUrl: string }[];
  }[];
};

/** Public, token-authenticated ticket view for a guest — no session cookie involved anywhere in this path. */
export async function getGuestTicketView(rawToken: string): Promise<GuestTicketView | null> {
  const guest = await resolveGuestSession(rawToken);
  if (!guest) return null;

  const ticket = await withRls(
    { tenantId: guest.tenantId, userId: null, role: "GUEST", guestTicketId: guest.ticketId },
    async (tx) => {
      const t = await tx.ticket.findFirst({
        where: { id: guest.ticketId },
        include: {
          client: { select: { name: true } },
          messages: {
            where: { isInternal: false },
            orderBy: { createdAt: "asc" },
            include: { sender: { select: { name: true, avatarUrl: true } }, attachments: true },
          },
        },
      });
      return t;
    }
  );
  if (!ticket) return null;

  const messages = await Promise.all(
    ticket.messages.map(async (m) => ({
      id: m.id,
      body: m.body,
      senderRole: m.senderRole,
      isInternal: m.isInternal,
      createdAt: m.createdAt.toISOString(),
      sender: m.sender ? { name: m.sender.name, avatarUrl: m.sender.avatarUrl } : m.guestId ? { name: guest.name ?? guest.email, avatarUrl: null } : null,
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

  return {
    reference: ticket.reference,
    title: ticket.title,
    status: ticket.status,
    priority: ticket.priority,
    description: ticket.description,
    clientName: ticket.client.name,
    guestName: guest.name ?? guest.email,
    messages,
  };
}

/** Lighter sibling of getGuestTicketView() for the polling loop in conversation-thread.tsx's `onPoll` — same message shape, no ticket metadata. */
export async function getGuestTicketMessages(rawToken: string): Promise<GuestTicketView["messages"] | null> {
  const guest = await resolveGuestSession(rawToken);
  if (!guest) return null;

  const ticket = await withRls({ tenantId: guest.tenantId, userId: null, role: "GUEST", guestTicketId: guest.ticketId }, (tx) =>
    tx.ticket.findFirst({
      where: { id: guest.ticketId },
      select: {
        messages: {
          where: { isInternal: false },
          orderBy: { createdAt: "asc" },
          include: { sender: { select: { name: true, avatarUrl: true } }, attachments: true },
        },
      },
    })
  );
  if (!ticket) return null;

  return Promise.all(
    ticket.messages.map(async (m) => ({
      id: m.id,
      body: m.body,
      senderRole: m.senderRole,
      isInternal: m.isInternal,
      createdAt: m.createdAt.toISOString(),
      sender: m.sender ? { name: m.sender.name, avatarUrl: m.sender.avatarUrl } : m.guestId ? { name: guest.name ?? guest.email, avatarUrl: null } : null,
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

const guestReplySchema = z.object({
  token: z.string().min(1),
  body: z.string().min(1).max(20000),
  attachmentIds: z.array(z.string().cuid()).max(10).optional(),
});

export async function postGuestReply(
  input: z.infer<typeof guestReplySchema>
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = guestReplySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const data = parsed.data;

  const guest = await resolveGuestSession(data.token);
  if (!guest) return { ok: false, error: "This link is no longer valid." };

  const { ticket, assignedAgent, branding } = await withRls(
    { tenantId: guest.tenantId, userId: null, role: "GUEST", guestTicketId: guest.ticketId },
    async (tx) => {
      const ticket = await tx.ticket.findFirst({ where: { id: guest.ticketId } });
      if (!ticket) throw new Error("NOT_FOUND");

      const message = await tx.message.create({
        data: {
          tenantId: guest.tenantId,
          ticketId: ticket.id,
          guestId: guest.guestId,
          senderRole: "GUEST",
          body: data.body,
        },
      });
      if (data.attachmentIds && data.attachmentIds.length > 0) {
        await tx.attachment.updateMany({
          where: { id: { in: data.attachmentIds }, ticketId: ticket.id, tenantId: guest.tenantId, messageId: null },
          data: { messageId: message.id },
        });
      }

      const assignedAgent = ticket.assignedToId ? await tx.user.findUnique({ where: { id: ticket.assignedToId } }) : null;
      if (assignedAgent) {
        await notify(tx, {
          tenantId: guest.tenantId,
          userId: assignedAgent.id,
          type: "TICKET_REPLY",
          title: `${guest.name ?? guest.email} replied on ${ticket.reference}`,
          body: data.body.slice(0, 140),
          ticketId: ticket.id,
        });
      }
      const branding = await tx.tenantBranding.findUnique({ where: { tenantId: guest.tenantId } });
      return { ticket, assignedAgent, branding };
    }
  );

  if (assignedAgent) await sendClientReplyNotification(ticket, assignedAgent.email, branding);

  revalidatePath(`/guest/${data.token}`);
  return { ok: true };
}

export type StagedGuestAttachment = { id: string; fileName: string; mimeType: string; sizeBytes: number; previewUrl: string | null };

export async function uploadGuestAttachment(
  token: string,
  formData: FormData
): Promise<{ ok: true; attachment: StagedGuestAttachment } | { ok: false; error: string }> {
  const guest = await resolveGuestSession(token);
  if (!guest) return { ok: false, error: "This link is no longer valid." };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "No file provided." };

  const path = `${guest.tenantId}/${guest.ticketId}/${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-100)}`;
  const result = await uploadAttachment(path, file, ATTACHMENT_ALLOWED_MIME, ATTACHMENT_MAX_BYTES);
  if (!result.ok) return { ok: false, error: result.error };

  const attachment = await withRls(
    { tenantId: guest.tenantId, userId: null, role: "GUEST", guestTicketId: guest.ticketId },
    (tx) =>
      tx.attachment.create({
        data: {
          tenantId: guest.tenantId,
          ticketId: guest.ticketId,
          fileUrl: path,
          fileName: file.name,
          mimeType: file.type,
          sizeBytes: file.size,
        },
      })
  );

  const previewUrl = await getAttachmentSignedUrl(path);
  return {
    ok: true,
    attachment: { id: attachment.id, fileName: attachment.fileName, mimeType: attachment.mimeType, sizeBytes: attachment.sizeBytes, previewUrl },
  };
}
