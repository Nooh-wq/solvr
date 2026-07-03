import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { prisma, withRls } from "@/lib/db";
import { resend } from "@/lib/email/send";
import { sendTicketCreatedEmail, sendClientReplyNotification, sendEmailAutoAccountNotice } from "@/lib/email/events";
import { createWithReference } from "@/lib/ticket-number";
import { notify } from "@/lib/notifications";
import {
  extractTicketNumberFromSubject,
  extractReferencedMessageIds,
  stripQuotedReply,
  htmlToPlainText,
} from "@/lib/email/inbound";
import type { EmailReceivedEvent } from "resend";

type ReceivedEmailEventData = EmailReceivedEvent["data"];

/**
 * Resolves the tenant that owns a given inbound "to" address: exact match
 * on TenantBranding.supportEmail (the dedicated inbound mailbox an admin
 * sets in /admin/branding), falling back to the "support@<slug>.<base
 * domain>" convention for tenants that haven't set a custom one yet.
 * `tenant_branding`/`tenants` are public-read tables (see
 * prisma/rls_policies.sql) so this needs no RLS context — same reasoning as
 * resolveTenantByHost() in lib/tenant.ts.
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
 * `super_admin_read` RLS policy (see prisma/rls_policies.sql) — a system
 * process (this webhook) reading across tenants to resolve routing, the
 * same trust boundary already granted to the cross-tenant health dashboard.
 * The tenantId passed to withRls is never checked by that policy branch, so
 * a placeholder is fine here.
 */
async function findTicketAcrossTenants(where: { ticketNumber: string } | { emailMessageId: { in: string[] } }) {
  return withRls({ tenantId: "system", userId: null, role: "SUPER_ADMIN" }, (tx) => tx.ticket.findFirst({ where }));
}

/**
 * Finds a user by email within a tenant, or creates a PENDING one — see
 * email flow design §"Unknown sender behavior": nothing gets dropped, but a
 * brand-new sender can't log into the portal until an admin approves them.
 * A newly created sender gets a random temp password (same shape as
 * inviteUser() in actions/admin.ts) so there's something for them to log in
 * with once approved — otherwise "you're approved, log in" would be a dead
 * end for someone who only ever emailed support and never visited the portal.
 */
async function findOrCreateSender(tenantId: string, fromEmail: string, fromName: string) {
  const tempPassword = crypto.randomBytes(9).toString("base64").replace(/[+/=]/g, "");
  const passwordHash = await bcrypt.hash(tempPassword, 10);

  return withRls({ tenantId, userId: null }, async (tx) => {
    const existing = await tx.user.findUnique({
      where: { tenantId_email: { tenantId, email: fromEmail } },
    });
    if (existing) return { user: existing, tempPassword: null };

    const user = await tx.user.create({
      data: {
        tenantId,
        email: fromEmail,
        name: fromName || fromEmail,
        passwordHash,
        role: "CLIENT",
        status: "PENDING",
      },
    });
    return { user, tempPassword };
  });
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
 * route this email" cases — those clear the case for logging without
 * causing the webhook provider to retry into a permanent failure.
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
    const { user: sender, tempPassword } = await findOrCreateSender(existingTicket.tenantId, fromEmail, fromName);

    const { ticket, assignedAgent, branding } = await withRls(
      { tenantId: existingTicket.tenantId, userId: sender.id, role: sender.role },
      async (tx) => {
        await tx.message.create({
          data: {
            tenantId: existingTicket.tenantId,
            ticketId: existingTicket.id,
            senderId: sender.id,
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
              actorId: sender.id,
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
            actorId: sender.id,
            action: "REPLY",
          },
        });

        const assignedAgent = ticket.assignedToId ? await tx.user.findUnique({ where: { id: ticket.assignedToId } }) : null;
        if (assignedAgent) {
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

    if (assignedAgent) await sendClientReplyNotification(ticket, assignedAgent.email, branding);
    if (tempPassword) await sendEmailAutoAccountNotice(sender.email, tempPassword, branding);
    return `appended reply to ticket ${ticket.ticketNumber}`;
  }

  // --- C. New ticket via email --------------------------------------------
  const tenant = await resolveTenantByInboundAddress(full.to);
  if (!tenant) return `skipped: no tenant matches inbound address(es) ${full.to.join(", ")}`;

  const { user: sender, tempPassword } = await findOrCreateSender(tenant.id, fromEmail, fromName);

  const { ticket, branding } = await withRls({ tenantId: tenant.id, userId: sender.id, role: sender.role }, async (tx) => {
    const t = await tx.tenant.findUniqueOrThrow({ where: { id: tenant.id } });

    const ticket = await createWithReference(t.name, ({ reference, ticketNumber }) =>
      tx.ticket.create({
        data: {
          tenantId: tenant.id,
          reference,
          ticketNumber,
          title: full.subject.replace(/^(re|fwd?):\s*/i, "").slice(0, 200) || "Email support request",
          description: body,
          clientId: sender.id,
          status: "OPEN",
          source: "email",
        },
      })
    );

    await tx.auditLog.create({
      data: { tenantId: tenant.id, ticketId: ticket.id, actorId: sender.id, action: "CREATE", toValue: "OPEN" },
    });

    const branding = await tx.tenantBranding.findUnique({ where: { tenantId: tenant.id } });
    return { ticket, branding };
  });

  await sendTicketCreatedEmail(ticket, sender.email, branding);
  if (tempPassword) await sendEmailAutoAccountNotice(sender.email, tempPassword, branding);
  return `created ticket ${ticket.ticketNumber} in tenant ${tenant.slug}`;
}
