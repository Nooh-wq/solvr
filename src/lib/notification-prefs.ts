// M21.4 — the single choke point every outbound email/notify() flows through.
//
// `getEmailDecision` returns one of three verdicts:
//   * "send"   — the user still wants this event by email in real time
//   * "digest" — user wants it but as part of a daily summary; caller
//                queues into digest_queue instead of sending now
//   * "skip"   — user has turned this event off
//
// `shouldWriteInApp` is the same idea for the in-app bell notifications
// written via lib/notifications.ts's notify().
//
// Preferences default to "send everything, no digest" for subjects with
// no row — pre-M21.4 behaviour is preserved for users who never touch
// the tab. This also means the very first read for a subject is a
// cache miss + no row; that's OK, it just returns the default without
// creating anything.

import { prisma, withRls } from "@/lib/db";
import type { PrismaClient } from "@/generated/prisma";

export type EmailEventKey =
  | "ticketCreated"
  | "ticketReply"
  | "statusChange"
  | "assigned"
  | "csatRequest";

export type InAppEventKey = "ticketReply" | "statusChange" | "assigned";

type PrefRow = {
  emailTicketCreated: boolean;
  emailTicketReply: boolean;
  emailStatusChange: boolean;
  emailAssigned: boolean;
  emailCsatRequest: boolean;
  inAppTicketReply: boolean;
  inAppStatusChange: boolean;
  inAppAssigned: boolean;
  digestMode: string;
};

const EMAIL_COLUMN: Record<EmailEventKey, keyof PrefRow> = {
  ticketCreated: "emailTicketCreated",
  ticketReply: "emailTicketReply",
  statusChange: "emailStatusChange",
  assigned: "emailAssigned",
  csatRequest: "emailCsatRequest",
};

const IN_APP_COLUMN: Record<InAppEventKey, keyof PrefRow> = {
  ticketReply: "inAppTicketReply",
  statusChange: "inAppStatusChange",
  assigned: "inAppAssigned",
};

// CSAT is time-sensitive (single-use survey link) and never digested —
// forcing it into a daily summary would defeat the purpose. Every other
// email event honours the user's INSTANT/DAILY choice.
const DIGESTABLE: Record<EmailEventKey, boolean> = {
  ticketCreated: false,
  ticketReply: true,
  statusChange: true,
  assigned: true,
  csatRequest: false,
};

async function readPref(tenantId: string, subjectId: string): Promise<PrefRow | null> {
  return withRls(
    { tenantId, userId: subjectId, role: "SUPER_ADMIN" },
    (tx) =>
      tx.notificationPreference.findUnique({
        where: { subjectId },
        select: {
          emailTicketCreated: true,
          emailTicketReply: true,
          emailStatusChange: true,
          emailAssigned: true,
          emailCsatRequest: true,
          inAppTicketReply: true,
          inAppStatusChange: true,
          inAppAssigned: true,
          digestMode: true,
        },
      })
  );
}

export type EmailDecision = "send" | "digest" | "skip";

export async function getEmailDecision(
  tenantId: string,
  subjectId: string,
  event: EmailEventKey
): Promise<EmailDecision> {
  const pref = await readPref(tenantId, subjectId);
  if (!pref) return "send"; // no row → defaults, send everything
  if (!pref[EMAIL_COLUMN[event]]) return "skip";
  if (pref.digestMode === "DAILY" && DIGESTABLE[event]) return "digest";
  return "send";
}

export async function shouldWriteInApp(
  tenantId: string,
  subjectId: string,
  event: InAppEventKey
): Promise<boolean> {
  const pref = await readPref(tenantId, subjectId);
  if (!pref) return true;
  return pref[IN_APP_COLUMN[event]] as boolean;
}

/**
 * Enqueues an email that would otherwise fire now. Called by every
 * gated send site when getEmailDecision returned "digest". The daily
 * Inngest job drains this table.
 */
export async function queueDigestEmail(input: {
  tenantId: string;
  subjectId: string;
  eventKey: EmailEventKey;
  subject: string;
  body: string;
  ticketRef?: string | null;
  ticketUrl?: string | null;
}) {
  await withRls(
    { tenantId: input.tenantId, userId: input.subjectId, role: "SUPER_ADMIN" },
    (tx) =>
      tx.digestQueue.create({
        data: {
          tenantId: input.tenantId,
          subjectId: input.subjectId,
          eventKey: input.eventKey,
          subject: input.subject,
          body: input.body,
          ticketRef: input.ticketRef ?? null,
          ticketUrl: input.ticketUrl ?? null,
        },
      })
  );
}

// Convenience wrapper for callers who already hold a tx (e.g. notify()
// batching inside postAgentReply). Reads inside the same tx so it sees
// through the caller's RLS setup.
export async function shouldWriteInAppInTx(
  tx: Pick<PrismaClient, "notificationPreference">,
  subjectId: string,
  event: InAppEventKey
): Promise<boolean> {
  const pref = await tx.notificationPreference.findUnique({
    where: { subjectId },
    select: {
      inAppTicketReply: true,
      inAppStatusChange: true,
      inAppAssigned: true,
    },
  });
  if (!pref) return true;
  return pref[IN_APP_COLUMN[event] as "inAppTicketReply" | "inAppStatusChange" | "inAppAssigned"];
}

// ---------------------------------------------------------------------------
// Actions surface — get/set for the Notifications tab.
// ---------------------------------------------------------------------------

export type NotificationPreferencesDto = PrefRow;

const DEFAULT_PREFS: NotificationPreferencesDto = {
  emailTicketCreated: true,
  emailTicketReply: true,
  emailStatusChange: true,
  emailAssigned: true,
  emailCsatRequest: true,
  inAppTicketReply: true,
  inAppStatusChange: true,
  inAppAssigned: true,
  digestMode: "INSTANT",
};

export async function readMyPreferences(tenantId: string, subjectId: string): Promise<NotificationPreferencesDto> {
  const row = await readPref(tenantId, subjectId);
  return row ?? DEFAULT_PREFS;
}

export async function writeMyPreferences(
  tenantId: string,
  subjectId: string,
  patch: Partial<NotificationPreferencesDto>
) {
  await withRls(
    { tenantId, userId: subjectId, role: "SUPER_ADMIN" },
    (tx) =>
      tx.notificationPreference.upsert({
        where: { subjectId },
        create: { subjectId, tenantId, ...DEFAULT_PREFS, ...patch },
        update: patch,
      })
  );
}

/**
 * Cross-tenant drain path used by the digest Inngest job. Not RLS-scoped
 * on the read (it needs to see every tenant to pick up work) — the
 * import is prisma directly. The write-and-delete cycle IS RLS-scoped
 * per tenant so nothing crosses boundaries.
 */
export async function readAllPendingDigestSubjects(): Promise<Array<{ tenantId: string; subjectId: string }>> {
  const rows = await prisma.digestQueue.findMany({
    distinct: ["tenantId", "subjectId"],
    select: { tenantId: true, subjectId: true },
  });
  return rows;
}
