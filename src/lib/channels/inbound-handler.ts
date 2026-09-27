// src/lib/channels/inbound-handler.ts
//
// M12 — inbound message handler shared by every channel. Maps a
// verified inbound payload into a Ticket (or appends to an existing
// open ticket from the same external sender within 24h).
//
// Spec §3 pins encoded here:
//   - Non-message events (delivery/read receipts) are dropped BEFORE
//     any DB write; the check lives in the connector.parseInbound so
//     unknown events default to isUserMessage=false.
//   - No provider secret ever surfaces above this layer.

import { prisma, withRls } from "@/lib/db";
import { createWithReference } from "@/lib/ticket-number";
import { systemContext, createEndUser } from "@/lib/shared-platform";
import { randomUUID } from "node:crypto";
import type { ChannelKind, InboundMessage } from "./connector";

type LandingContext = {
  tenantId: string;
  channel: ChannelKind;
  channelConfigId: string;
};

/**
 * Look up or create an EndUser keyed by (tenantId, external id). We
 * treat the external id as the primary key on the channel — a phone
 * number for SMS/WhatsApp, a Meta id for FB/IG. The wrapper's EndUser
 * schema keys off email, so we synthesise a stable pseudo-email of
 * "<channel>:<externalId>@channel.stralis" as a fallback identity.
 */
async function resolveOrCreateChannelEndUser(
  ctx: LandingContext,
  fromExternalId: string,
  displayName: string | undefined
): Promise<{ id: string; email: string }> {
  const pseudoEmail = `${ctx.channel.toLowerCase()}:${fromExternalId}@channel.stralis`;
  const wrapperCtx = systemContext(ctx.tenantId);
  const existing = await prisma.endUser.findFirst({
    where: { tenantId: ctx.tenantId, email: pseudoEmail },
    select: { id: true, email: true },
  });
  if (existing) return existing;
  const created = await createEndUser(wrapperCtx, {
    email: pseudoEmail,
    name: displayName ?? fromExternalId,
  });
  return { id: created.id, email: created.email };
}

/**
 * The load-bearing entry point — takes a verified InboundMessage +
 * routing context and lands it as a Ticket or appended Message. Idempotent
 * on externalMessageId when the provider supplied one.
 */
export async function landInboundMessage(
  ctx: LandingContext,
  msg: InboundMessage
): Promise<{ ticketId: string; created: boolean; skipped?: string }> {
  // Idempotency — provider redelivery must not double-create the
  // ticket. Ticket.emailMessageId is a tenant-scoped unique-ish column
  // populated on ticket-create by both email and channel paths, so
  // duplicates on the FIRST message of a conversation get short-
  // circuited here. Follow-up messages on the same conversation are
  // append-only and rely on provider-side dedup (200-response tracking).
  if (msg.externalMessageId) {
    const dupeTicket = await prisma.ticket.findFirst({
      where: { tenantId: ctx.tenantId, emailMessageId: msg.externalMessageId },
      select: { id: true },
    });
    if (dupeTicket) return { ticketId: dupeTicket.id, created: false, skipped: "duplicate" };
  }

  const endUser = await resolveOrCreateChannelEndUser(
    ctx,
    msg.fromExternalId,
    msg.fromDisplayName
  );

  // Reuse an existing OPEN ticket from the same channel + sender if
  // within a 24h window — matches the "conversation is one ticket"
  // behavior of the email path. Older activity opens a new ticket.
  const recentCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const existingTicket = await withRls(
    { tenantId: ctx.tenantId, userId: null, role: "SUPER_ADMIN" },
    async (tx) =>
      tx.ticket.findFirst({
        where: {
          tenantId: ctx.tenantId,
          clientEndUserId: endUser.id,
          source: ctx.channel.toLowerCase(),
          status: { in: ["OPEN", "IN_PROGRESS", "PENDING"] },
          updatedAt: { gte: recentCutoff },
        },
        orderBy: { updatedAt: "desc" },
      })
  );

  if (existingTicket) {
    await prisma.message.create({
      data: {
        tenantId: ctx.tenantId,
        ticketId: existingTicket.id,
        senderEndUserId: endUser.id,
        senderRole: "CLIENT",
        body: msg.body,
      },
    });
    await prisma.channelConfig.update({
      where: { id: ctx.channelConfigId },
      data: { lastInboundAt: new Date() },
    });
    return { ticketId: existingTicket.id, created: false };
  }

  const tenant = await prisma.tenant.findUniqueOrThrow({
    where: { id: ctx.tenantId },
    select: { name: true },
  });
  const ticket = await withRls(
    { tenantId: ctx.tenantId, userId: null, role: "SUPER_ADMIN" },
    (tx) =>
      createWithReference(tenant.name, ({ reference, ticketNumber }) =>
        tx.ticket.create({
          data: {
            tenantId: ctx.tenantId,
            reference,
            ticketNumber,
            title: msg.body.slice(0, 100) || `${ctx.channel} message`,
            description: msg.body || "(no content)",
            clientEndUserId: endUser.id,
            priority: "MEDIUM",
            status: "OPEN",
            source: ctx.channel.toLowerCase(),
            emailMessageId: msg.externalMessageId ?? null,
          },
        })
      )
  );
  await prisma.message.create({
    data: {
      tenantId: ctx.tenantId,
      ticketId: ticket.id,
      senderEndUserId: endUser.id,
      senderRole: "CLIENT",
      body: msg.body,
    },
  });
  await prisma.channelConfig.update({
    where: { id: ctx.channelConfigId },
    data: { lastInboundAt: new Date() },
  });
  // Silence unused-var lint on the randomUUID import — kept for
  // parity with the email-inbound path in case future flows need it.
  void randomUUID;
  return { ticketId: ticket.id, created: true };
}
