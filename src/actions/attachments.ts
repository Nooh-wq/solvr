"use server";

import crypto from "node:crypto";
import { withRls } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { uploadAttachment, getAttachmentSignedUrl } from "@/lib/storage";
import { ATTACHMENT_ALLOWED_MIME, ATTACHMENT_MAX_BYTES } from "@/lib/validation/ticket";

/** Every ticket-attachment action needs "does this session have any business touching this ticket" — same rule getTicket() already applies (staff: tenant match; client: must be the ticket's own client). */
async function assertTicketAccess(
  tenantId: string,
  userId: string,
  role: string,
  ticketId: string
) {
  return withRls({ tenantId, userId, role: role as never }, async (tx) => {
    const ticket = await tx.ticket.findFirst({ where: { id: ticketId, tenantId } });
    if (!ticket) throw new Error("NOT_FOUND");
    if (role === "CLIENT" && ticket.clientId !== userId) throw new Error("NOT_FOUND");
    return ticket;
  });
}

function sanitizeFileName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-100);
}

export type StagedAttachment = {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  previewUrl: string | null;
};

/**
 * Uploads a file and stages it (Attachment row with messageId = null) — it
 * only becomes visible in the conversation once the composer's Send actually
 * links it to a message (see postAgentReply/postClientReply's attachmentIds
 * param). An uploaded-but-never-sent file still shows up in Files & Links.
 */
export async function uploadTicketAttachment(
  ticketId: string,
  formData: FormData
): Promise<{ ok: true; attachment: StagedAttachment } | { ok: false; error: string }> {
  const session = await requireSession();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "No file provided." };

  try {
    await assertTicketAccess(session.tenantId, session.id, session.role, ticketId);
  } catch {
    return { ok: false, error: "Ticket not found." };
  }

  const path = `${session.tenantId}/${ticketId}/${crypto.randomUUID()}-${sanitizeFileName(file.name)}`;
  const result = await uploadAttachment(path, file, ATTACHMENT_ALLOWED_MIME, ATTACHMENT_MAX_BYTES);
  if (!result.ok) return { ok: false, error: result.error };

  const attachment = await withRls(
    { tenantId: session.tenantId, userId: session.id, role: session.role },
    (tx) =>
      tx.attachment.create({
        data: {
          tenantId: session.tenantId,
          ticketId,
          uploadedById: session.id,
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

export type TicketAttachment = StagedAttachment & { uploadedAt: string; uploadedByName: string | null };

/** All attachments for a ticket (any messageId, including unlinked/staged ones), newest first — backs the Files & Links panel. */
export async function listTicketAttachments(ticketId: string): Promise<TicketAttachment[]> {
  const session = await requireSession();
  await assertTicketAccess(session.tenantId, session.id, session.role, ticketId);

  const rows = await withRls(
    { tenantId: session.tenantId, userId: session.id, role: session.role },
    (tx) =>
      tx.attachment.findMany({
        where: { ticketId, tenantId: session.tenantId },
        include: { uploadedBy: { select: { name: true } } },
        orderBy: { uploadedAt: "desc" },
      })
  );

  return Promise.all(
    rows.map(async (r) => ({
      id: r.id,
      fileName: r.fileName,
      mimeType: r.mimeType,
      sizeBytes: r.sizeBytes,
      previewUrl: await getAttachmentSignedUrl(r.fileUrl),
      uploadedAt: r.uploadedAt.toISOString(),
      uploadedByName: r.uploadedBy?.name ?? null,
    }))
  );
}
