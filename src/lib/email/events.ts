import { sendTicketEmail, sendSystemNotice } from "./send";
import type { TenantBranding, TicketStatus } from "@/generated/prisma";

function siteUrl() {
  return process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
}

type TicketRef = {
  id: string;
  reference: string;
  ticketNumber: string;
  title: string;
  status: TicketStatus;
};

const STATUS_LABEL: Record<TicketStatus, string> = {
  OPEN: "Open",
  IN_PROGRESS: "In progress",
  PENDING: "Pending",
  RESOLVED: "Resolved",
  CLOSED: "Closed",
};

// Email flow design §3 "Status Mapping — Backend to Email Tracker": the
// 4-stage visual tracker shown in every notification email. Resolved and
// Closed share the final stage — from the client's point of view, both mean
// "done", the Resolved->Closed distinction is an internal confirm-or-auto-close
// detail (see updateTicket()/confirmResolution() in actions/tickets.ts).
const TRACKER_STAGE: Record<TicketStatus, number> = {
  OPEN: 0,
  IN_PROGRESS: 1,
  PENDING: 2,
  RESOLVED: 3,
  CLOSED: 3,
};

/** §8.2 event → email matrix, ticket-created. */
export async function sendTicketCreatedEmail(ticket: TicketRef, clientEmail: string, branding: TenantBranding | null) {
  return sendTicketEmail({
    to: clientEmail,
    branding,
    reference: ticket.reference,
    title: ticket.title,
    statusLabel: STATUS_LABEL[ticket.status],
    trackerStage: TRACKER_STAGE[ticket.status],
    contextLine: "We received your request and will follow up soon.",
    subject: `[#${ticket.ticketNumber}] We received your request`,
    ticketUrl: `${siteUrl()}/portal/tickets/${ticket.id}`,
  });
}

/** Agent/admin posts a client-visible reply. */
export async function sendAgentReplyEmail(ticket: TicketRef, clientEmail: string, branding: TenantBranding | null) {
  return sendTicketEmail({
    to: clientEmail,
    branding,
    reference: ticket.reference,
    title: ticket.title,
    statusLabel: STATUS_LABEL[ticket.status],
    trackerStage: TRACKER_STAGE[ticket.status],
    contextLine: "There's a new reply on your ticket.",
    subject: `[#${ticket.ticketNumber}] New reply on your ticket`,
    ticketUrl: `${siteUrl()}/portal/tickets/${ticket.id}`,
  });
}

/** Client replied — notify the assigned agent. */
export async function sendClientReplyNotification(ticket: TicketRef, agentEmail: string, branding: TenantBranding | null) {
  return sendTicketEmail({
    to: agentEmail,
    branding,
    reference: ticket.reference,
    title: ticket.title,
    statusLabel: STATUS_LABEL[ticket.status],
    trackerStage: TRACKER_STAGE[ticket.status],
    contextLine: "The client replied to this ticket.",
    subject: `[#${ticket.ticketNumber}] Client replied`,
    ticketUrl: `${siteUrl()}/agent/tickets/${ticket.id}`,
  });
}

const STATUS_CONTEXT: Partial<Record<TicketStatus, { subject: string; contextLine: string }>> = {
  IN_PROGRESS: { subject: "Your ticket is in progress", contextLine: "An agent has started working on your ticket." },
  PENDING: { subject: "We need a bit more info", contextLine: "We need a bit more information to keep going — please reply when you can." },
  RESOLVED: { subject: "Your ticket has been resolved", contextLine: "We've marked this resolved. Confirm or reopen it from the ticket page." },
  CLOSED: { subject: "Your ticket has been closed", contextLine: "This ticket is now closed." },
};

/** Status-change email — only fires for statuses in STATUS_CONTEXT (not every transition emails the client). */
export async function sendStatusChangeEmail(ticket: TicketRef, clientEmail: string, branding: TenantBranding | null) {
  const copy = STATUS_CONTEXT[ticket.status];
  if (!copy) return { ok: true, skipped: true };
  return sendTicketEmail({
    to: clientEmail,
    branding,
    reference: ticket.reference,
    title: ticket.title,
    statusLabel: STATUS_LABEL[ticket.status],
    trackerStage: TRACKER_STAGE[ticket.status],
    contextLine: copy.contextLine,
    subject: `[#${ticket.ticketNumber}] ${copy.subject}`,
    ticketUrl: `${siteUrl()}/portal/tickets/${ticket.id}`,
  });
}

/** Sent alongside sendStatusChangeEmail the moment a ticket is newly marked
 * Resolved (see updateTicket() in actions/tickets.ts) — a "how did we do?"
 * rating link, no account needed. Separate from the 4-stage tracker email
 * since a CTA link doesn't fit that template. */
export async function sendCsatRequestEmail(toEmail: string, rateUrl: string, branding: TenantBranding | null) {
  const productName = branding?.productName ?? "Support";
  return sendSystemNotice({
    to: toEmail,
    branding,
    subject: `How did we do on your ${productName} ticket?`,
    heading: "Rate your experience",
    body: `Your ticket was just marked resolved. We'd love to know how it went — it only takes a few seconds.`,
    ctaLabel: "Rate this ticket",
    ctaUrl: rateUrl,
  });
}

/** §8.2 event → email matrix, agent invite. Still used for tenant provisioning's first-admin account (actions/super.ts) — Team's own invite flow (actions/admin.ts's inviteUser()) uses sendUserInviteEmail below instead, since that one goes through the accept-invite + OTP flow rather than a temp password. */
export async function sendAgentInviteEmail(
  toEmail: string,
  tempPassword: string,
  branding: TenantBranding | null
) {
  const productName = branding?.productName ?? "Support";
  return sendSystemNotice({
    to: toEmail,
    branding,
    subject: `You've been invited to ${productName}`,
    heading: `You've been invited to ${productName}`,
    body: `An admin created an account for you.\n\nEmail: ${toEmail}\nTemporary password: ${tempPassword}\n\nLog in and change your password from your account settings.`,
    ctaLabel: "Log in",
    ctaUrl: `${siteUrl()}/auth/login`,
  });
}

/** Team > Invite (actions/admin.ts's inviteUser()) — no temp password; the link lets the invitee set their own password, then verifies a one-time emailed code before their first session is created. */
export async function sendUserInviteEmail(toEmail: string, acceptUrl: string, branding: TenantBranding | null) {
  const productName = branding?.productName ?? "Support";
  return sendSystemNotice({
    to: toEmail,
    branding,
    subject: `You've been invited to ${productName}`,
    heading: `You've been invited to ${productName}`,
    body: `An admin created an account for you on ${productName}. Use the link below to set your password and get started.`,
    ctaLabel: "Accept invite",
    ctaUrl: acceptUrl,
  });
}

/** The one-time code entered at the end of acceptInvite() to verify a first login. */
export async function sendLoginOtpEmail(toEmail: string, code: string, branding: TenantBranding | null) {
  const productName = branding?.productName ?? "Support";
  return sendSystemNotice({
    to: toEmail,
    branding,
    subject: `Your ${productName} verification code`,
    heading: "Verify it's you",
    body: `Your verification code is:\n\n${code}\n\nThis code expires in 10 minutes. If you didn't request this, you can ignore this email.`,
  });
}

/** Sent when someone adds a guest to a ticket — a magic link scoped to that one ticket, no account needed. */
export async function sendTicketGuestInviteEmail(
  toEmail: string,
  guestUrl: string,
  ticketReference: string,
  invitedByName: string,
  branding: TenantBranding | null
) {
  const productName = branding?.productName ?? "Support";
  return sendSystemNotice({
    to: toEmail,
    branding,
    subject: `${invitedByName} added you to ${productName} ticket ${ticketReference}`,
    heading: `You've been added to a conversation`,
    body: `${invitedByName} added you to ticket ${ticketReference} on ${productName}. Use the link below to view and reply — no account needed.`,
    ctaLabel: "View ticket",
    ctaUrl: guestUrl,
  });
}

// ---------------------------------------------------------------------------
// Registration approval gate (Stralis_Email_Flow_Design.md §2 "A. Registration & Approval")
// ---------------------------------------------------------------------------

/** Sent to a newly registered user whose account needs a tenant admin's approval before they can log in. */
export async function sendRegistrationPendingEmail(toEmail: string, branding: TenantBranding | null) {
  const productName = branding?.productName ?? "Support";
  return sendSystemNotice({
    to: toEmail,
    branding,
    subject: "Your account is awaiting approval",
    heading: "Your account is awaiting approval",
    body: `Thanks for registering for ${productName}. An admin needs to approve your account before you can log in — we'll email you as soon as that happens.`,
  });
}

/** Notifies a tenant admin that a new user is waiting on their approval. */
export async function sendNewRegistrationAdminNotice(
  adminEmail: string,
  registrant: { name: string; email: string; company: string | null },
  branding: TenantBranding | null
) {
  return sendSystemNotice({
    to: adminEmail,
    branding,
    subject: `New registration awaiting approval: ${registrant.name}`,
    heading: "New registration awaiting approval",
    body: `${registrant.name} (${registrant.email}${registrant.company ? `, ${registrant.company}` : ""}) just registered and is waiting for approval.`,
    ctaLabel: "Review in Team & roles",
    ctaUrl: `${siteUrl()}/admin/team`,
  });
}

/** Sent when an admin approves a PENDING user (manually, or automatically via domain match). */
export async function sendRegistrationApprovedEmail(toEmail: string, branding: TenantBranding | null) {
  const productName = branding?.productName ?? "Support";
  return sendSystemNotice({
    to: toEmail,
    branding,
    subject: `You're approved — welcome to ${productName}`,
    heading: "You're approved",
    body: `Your account has been approved. You can log in now.`,
    ctaLabel: "Log in",
    ctaUrl: `${siteUrl()}/auth/login`,
  });
}

/** Password-reset link — see actions/auth.ts's requestPasswordReset(). Link is a signed, 30-minute, single-use token (src/lib/session.ts). */
export async function sendPasswordResetEmail(toEmail: string, resetUrl: string, branding: TenantBranding | null) {
  const productName = branding?.productName ?? "Support";
  return sendSystemNotice({
    to: toEmail,
    branding,
    subject: `Reset your ${productName} password`,
    heading: "Reset your password",
    body: `We received a request to reset your password. This link expires in 30 minutes and can only be used once. If you didn't request this, you can safely ignore this email — your password won't change.`,
    ctaLabel: "Reset password",
    ctaUrl: resetUrl,
  });
}

/** Sent when an admin rejects a PENDING registration. */
export async function sendRegistrationRejectedEmail(toEmail: string, branding: TenantBranding | null) {
  const productName = branding?.productName ?? "Support";
  return sendSystemNotice({
    to: toEmail,
    branding,
    subject: `Your ${productName} registration request`,
    heading: "Registration not approved",
    body: `Your registration request wasn't approved. If you think this is a mistake, please contact us directly.`,
  });
}

// ---------------------------------------------------------------------------
// Email-to-ticket (Stralis_Email_Flow_Design.md §4 "C. Ticket Created via Email")
// ---------------------------------------------------------------------------

/** Sent once, the first time someone emails support without an existing portal account — gives them a temp password so "you're approved, log in" (sendRegistrationApprovedEmail) isn't a dead end. */
export async function sendEmailAutoAccountNotice(toEmail: string, tempPassword: string, branding: TenantBranding | null) {
  const productName = branding?.productName ?? "Support";
  return sendSystemNotice({
    to: toEmail,
    branding,
    subject: `A ${productName} account was created for you`,
    heading: "We created a portal account for you",
    body: `We created a ${productName} account from your support email so you can track this ticket online. An admin needs to approve it first.\n\nEmail: ${toEmail}\nTemporary password: ${tempPassword}\n\nYou'll be able to log in once approved.`,
  });
}
