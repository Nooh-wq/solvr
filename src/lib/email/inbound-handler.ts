import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { prisma, withRls } from "@/lib/db";
import { resend } from "@/lib/email/send";
import { sendTicketCreatedEmail, sendClientReplyNotification, sendEmailAutoAccountNotice } from "@/lib/email/events";
import { createWithReference } from "@/lib/ticket-number";
import { notify } from "@/lib/notifications";
import {
  getEmailDecision,
  queueDigestEmail,
  shouldWriteInAppInTx,
} from "@/lib/notification-prefs";
import {
  extractTicketNumberFromSubject,
  extractReferencedMessageIds,
  stripQuotedReply,
  htmlToPlainText,
} from "@/lib/email/inbound";
import {
  systemContext,
  getEndUser,
  getTeamMember,
  createEndUser,
} from "@/lib/shared-platform";
import { matchCompanyByEmail } from "@/lib/company-match";
import { randomUUID } from "node:crypto";
import type { EmailReceivedEvent } from "resend";

type ReceivedEmailEventData = EmailReceivedEvent["data"];

/**
 * Resolves the tenant that owns a given inbound "to" address: exact match
 * on TenantBranding.supportEmail (the dedicated inbound mailbox an admin
 * sets in /admin/branding), falling back to the "support@<slug>.<base
 * domain>" convention for tenants that haven't set a custom one yet.
 */
async function resolveTenantByInboundAddress(toAddresses: string[]) {
  for (const to of toAddresses) {
    const address = to.toLowerCase().trim();
    const branding = await prisma.tenantBranding.findUnique({ where: { supportEmail: address } });
    if (branding) return prisma.tenant.findUnique({ where: { id: branding.tenantId } });

    const baseDomain = (process.env.APP_BASE_DOMAIN ?? "stralis.app").toLowerCase();
    const match = address.match(new RegExp(`^support@([a-z0-9-]+)\\.${baseDomain.replace(/\./g, "\\.")}$`));
    if (match) {
      const tenant = await prisma.tenant.findUnique({ where: { slug: match[1] } });
      if (tenant) return tenant;
    }
  }
  return null;
}

/**
 * Looks up a ticket by its globally-unique ticketNumber (or a referenced
 * Message-ID) without knowing the tenant in advance. Uses the
 * `super_admin_read` RLS policy — a system process (this webhook) reading
 * across tenants to resolve routing, same trust boundary as the cross-tenant
 * health dashboard.
 */
async function findTicketAcrossTenants(where: { ticketNumber: string } | { emailMessageId: { in: string[] } }) {
  return withRls({ tenantId: "system", userId: null, role: "SUPER_ADMIN" }, (tx) => tx.ticket.findFirst({ where }));
}

type InboundSender = {
  id: string;
  email: string;
  name: string;
  organizationId: string | null;
};

/**
 * Z1.5b: finds a wrapper EndUser by email or creates one at PENDING.
 * All inbound-email senders are CLIENT (EndUser) — email is never used as
 * a staff-onboarding channel. No legacy user is created.
 */
async function findOrCreateSender(
  tenantId: string,
  fromEmail: string,
  fromName: string
): Promise<{ sender: InboundSender; tempPassword: string | null }> {
  const ctx = systemContext(tenantId);

  // Direct wrapper lookup via prisma under SUPER_ADMIN context (avoids
  // exposing an unauthenticated matchEndUserByEmail on the wrapper).
  const existing = await withRls({ tenantId, userId: null, role: "SUPER_ADMIN" }, (tx) =>
    tx.endUser.findFirst({ where: { tenantId, email: fromEmail } })
  );
  if (existing) {
    return {
      sender: {
        id: existing.id,
        email: existing.email,
        name: existing.name ?? existing.email,
        organizationId: existing.organizationId,
      },
      tempPassword: null,
    };
  }

  // New sender. Wrapper EndUser + credentials + lifecycle rows, all under
  // one preserved subject id.
  const organizationId = await matchCompanyByEmail(tenantId, fromEmail);
  const subjectId = randomUUID();
  const tempPassword = crypto.randomBytes(9).toString("base64").replace(/[+/=]/g, "");
  const passwordHash = await bcrypt.hash(tempPassword, 10);

  const newEndUser = await createEndUser(ctx, {
    id: subjectId,
    email: fromEmail,
    name: fromName || fromEmail,
    organizationId,
  });

  await withRls({ tenantId, userId: null, role: "SUPER_ADMIN" }, async (tx) => {
    await tx.authCredential.create({
      data: { tenantId, subjectEndUserId: subjectId, passwordHash },
    });
    await tx.endUserLifecycle.create({
      data: { tenantId, subjectId, status: "PENDING" },
    });
  });

  return {
    sender: {
      id: newEndUser.id,
      email: newEndUser.email,
      name: newEndUser.name ?? newEndUser.email,
      organizationId: newEndUser.organizationId,
    },
    tempPassword,
  };
}

function parseFromHeader(from: string): { email: string; name: string } {
  const match = from.match(/^\s*"?([^"<]*)"?\s*<([^>]+)>\s*$/);
  if (match) return { email: match[2].trim().toLowerCase(), name: match[1].trim() };
  return { email: from.trim().toLowerCase(), name: "" };
}

/**
 * Handles one `email.received` webhook event end to end (email flow design
 * §4 "The Full Email Flow", steps C and D). Called from
 * app/api/webhooks/email-inbound/route.ts after signature verification.
 * Returns a short status string for logging; never throws for "couldn't
 * route this email" cases.
 */
export async function handleInboundEmail(eventData: ReceivedEmailEventData): Promise<string> {
  if (!resend) return "skipped: RESEND_API_KEY not configured";

  const { data: full, error } = await resend.emails.receiving.get(eventData.email_id);
  if (error || !full) return `skipped: could not fetch email body (${error?.message ?? "unknown error"})`;

  const { email: fromEmail, name: fromName } = parseFromHeader(full.from);
  const rawBody = full.text ?? (full.html ? htmlToPlainText(full.html) : "");
  const body = stripQuotedReply(rawBody).slice(0, 20_000) || "(no message body)";

  // --- D. Reply to an existing ticket -----------------------------------
  const ticketNumber = extractTicketNumberFromSubject(full.subject);
  const headerValue = (name: string) =>
    full.headers ? (full.headers[name] ?? full.headers[name.toLowerCase()] ?? full.headers[name.toUpperCase()]) : undefined;
  const referencedIds = extractReferencedMessageIds(headerValue("In-Reply-To") ?? headerValue("References"));

  const existingTicket = ticketNumber
    ? await findTicketAcrossTenants({ ticketNumber })
    : referencedIds.length > 0
      ? await findTicketAcrossTenants({ emailMessageId: { in: referencedIds } })
      : null;

  if (existingTicket) {
    const { sender, tempPassword } = await findOrCreateSender(existingTicket.tenantId, fromEmail, fromName);

    const { ticket, assignedAgent, branding } = await withRls(
      { tenantId: existingTicket.tenantId, userId: sender.id, role: "CLIENT" },
      async (tx) => {
        await tx.message.create({
          data: {
            tenantId: existingTicket.tenantId,
            ticketId: existingTicket.id,
            senderEndUserId: sender.id,
            senderRole: "CLIENT",
            body,
          },
        });

        let ticket = existingTicket;
        if (existingTicket.status === "PENDING") {
          ticket = await tx.ticket.update({ where: { id: existingTicket.id }, data: { status: "IN_PROGRESS" } });
          await tx.auditLog.create({
            data: {
              tenantId: existingTicket.tenantId,
              ticketId: existingTicket.id,
              actorEndUserId: sender.id,
              action: "STATUS_CHANGE",
              fromValue: "PENDING",
              toValue: "IN_PROGRESS",
            },
          });
        }
        await tx.auditLog.create({
          data: {
            tenantId: existingTicket.tenantId,
            ticketId: existingTicket.id,
            actorEndUserId: sender.id,
            action: "REPLY",
          },
        });

        const assignedAgent = ticket.assignedTeamMemberId
          ? await getTeamMember(systemContext(existingTicket.tenantId), ticket.assignedTeamMemberId)
          : null;
        if (assignedAgent && await shouldWriteInAppInTx(tx, assignedAgent.id, "ticketReply")) {
          await notify(tx, {
            tenantId: existingTicket.tenantId,
            userId: assignedAgent.id,
            type: "TICKET_REPLY",
            title: `${sender.name} replied on ${existingTicket.reference} (via email)`,
            body: body.slice(0, 140),
            ticketId: existingTicket.id,
          });
        }
        const branding = await tx.tenantBranding.findUnique({ where: { tenantId: existingTicket.tenantId } });
        return { ticket, assignedAgent, branding };
      }
    );

    if (assignedAgent) {
      const decision = await getEmailDecision(existingTicket.tenantId, assignedAgent.id, "ticketReply");
      if (decision === "send") {
        await sendClientReplyNotification(ticket, assignedAgent.email, branding);
      } else if (decision === "digest") {
        await queueDigestEmail({
          tenantId: existingTicket.tenantId,
          subjectId: assignedAgent.id,
          eventKey: "ticketReply",
          subject: `[#${ticket.ticketNumber}] Client replied (via email)`,
          body: `${sender.name} replied on ${ticket.reference}.`,
          ticketRef: ticket.reference,
          ticketUrl: `/agent/tickets/${ticket.id}`,
        });
      }
    }
    if (tempPassword) await sendEmailAutoAccountNotice(sender.email, tempPassword, branding);
    return `appended reply to ticket ${ticket.ticketNumber}`;
  }

  // --- C. New ticket via email --------------------------------------------
  const tenant = await resolveTenantByInboundAddress(full.to);
  if (!tenant) return `skipped: no tenant matches inbound address(es) ${full.to.join(", ")}`;

  const { sender, tempPassword } = await findOrCreateSender(tenant.id, fromEmail, fromName);

  const { ticket, branding } = await withRls({ tenantId: tenant.id, userId: sender.id, role: "CLIENT" }, async (tx) => {
    const t = await tx.tenant.findUniqueOrThrow({ where: { id: tenant.id } });

    const ticket = await createWithReference(t.name, ({ reference, ticketNumber }) =>
      tx.ticket.create({
        data: {
          tenantId: tenant.id,
          reference,
          ticketNumber,
          title: full.subject.replace(/^(re|fwd?):\s*/i, "").slice(0, 200) || "Email support request",
          description: body,
          clientEndUserId: sender.id,
          organizationId: sender.organizationId,
          status: "OPEN",
          source: "email",
        },
      })
    );

    await tx.auditLog.create({
      data: {
        tenantId: tenant.id,
        ticketId: ticket.id,
        actorEndUserId: sender.id,
        action: "CREATE",
        toValue: "OPEN",
      },
    });

    const branding = await tx.tenantBranding.findUnique({ where: { tenantId: tenant.id } });
    return { ticket, branding };
  });

  const decision = await getEmailDecision(tenant.id, sender.id, "ticketCreated");
  if (decision === "send") {
    await sendTicketCreatedEmail(ticket, sender.email, branding);
  } else if (decision === "digest") {
    await queueDigestEmail({
      tenantId: tenant.id,
      subjectId: sender.id,
      eventKey: "ticketCreated",
      subject: `[#${ticket.ticketNumber}] We received your request`,
      body: `Your ticket ${ticket.reference} was created from your email.`,
      ticketRef: ticket.reference,
      ticketUrl: `/portal/tickets/${ticket.id}`,
    });
  }
  if (tempPassword) await sendEmailAutoAccountNotice(sender.email, tempPassword, branding);
  return `created ticket ${ticket.ticketNumber} in tenant ${tenant.slug}`;
}
