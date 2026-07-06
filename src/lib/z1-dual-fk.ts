// Z1.4a dual-FK bridge helper. Maps a legacy User's id + role to the
// correct dual-FK column pair for the transition tables (tickets,
// messages, audit_logs, notifications, attachments, ticket_guests,
// login_otps, chat_conversations).
//
// Exactly one of the two returned fields is set on a per-column-pair
// basis — matching the num_nonnulls(...) <= 1 CHECK constraints added
// by prisma/z1_4a_migration.sql. Pass the result directly into Prisma
// data blocks via spread:
//
//   const author = dualFkForUser(session.id, session.role);
//   await tx.message.create({
//     data: {
//       ...base,
//       senderId: session.id,
//       ...senderCols(author),
//     },
//   });
//
// Every existing legacy write path stays intact (senderId still
// populated) — this helper adds the dual-FK columns alongside without
// touching the legacy semantics. Z1.5 will drop the legacy columns.

import type { LegacyRole } from "@/generated/prisma";

type DualFk = { endUserId: string | null; teamMemberId: string | null };

/**
 * Neutral shape: exactly one of {endUserId, teamMemberId} is set based
 * on legacy role. The per-table col*() functions below rename the
 * fields to match each destination table's column names.
 */
export function dualFkForUser(userId: string, role: LegacyRole): DualFk {
  if (role === "CLIENT") return { endUserId: userId, teamMemberId: null };
  return { endUserId: null, teamMemberId: userId };
}

/** SYSTEM/BOT actor — both null. Used for cron jobs, auto-close, etc. */
export const SYSTEM_ACTOR: DualFk = { endUserId: null, teamMemberId: null };

// ---------------------------------------------------------------------------
// Per-table column-name mappings. Every function returns exactly the
// columns needed by its target table's dual-FK pair, ready to spread.
// ---------------------------------------------------------------------------

/** messages.senderEndUserId / senderTeamMemberId */
export function senderCols(x: DualFk) {
  return {
    senderEndUserId: x.endUserId,
    senderTeamMemberId: x.teamMemberId,
  };
}

/** audit_logs.actorEndUserId / actorTeamMemberId */
export function actorCols(x: DualFk) {
  return {
    actorEndUserId: x.endUserId,
    actorTeamMemberId: x.teamMemberId,
  };
}

/** tickets.clientEndUserId / clientTeamMemberId (see boundary §7.7) */
export function ticketClientCols(x: DualFk) {
  return {
    clientEndUserId: x.endUserId,
    clientTeamMemberId: x.teamMemberId,
  };
}

/**
 * tickets.assignedTeamMemberId — assignee is always staff, so this is
 * a single column, not a dual pair. Pass the legacy assignedToId
 * (nullable) and the mapping is 1:1 (preserved id from Z1.3).
 */
export function assignedTeamMemberCol(assignedToId: string | null | undefined) {
  return { assignedTeamMemberId: assignedToId ?? null };
}

/** attachments.uploadedByEndUserId / uploadedByTeamMemberId */
export function uploaderCols(x: DualFk) {
  return {
    uploadedByEndUserId: x.endUserId,
    uploadedByTeamMemberId: x.teamMemberId,
  };
}

/** ticket_guests.invitedByEndUserId / invitedByTeamMemberId */
export function inviterCols(x: DualFk) {
  return {
    invitedByEndUserId: x.endUserId,
    invitedByTeamMemberId: x.teamMemberId,
  };
}

/** login_otps.endUserId / teamMemberId */
export function otpSubjectCols(x: DualFk) {
  return {
    endUserId: x.endUserId,
    teamMemberId: x.teamMemberId,
  };
}

/** notifications.recipientEndUserId / recipientTeamMemberId */
export function recipientCols(x: DualFk) {
  return {
    recipientEndUserId: x.endUserId,
    recipientTeamMemberId: x.teamMemberId,
  };
}

/** chat_conversations.endUserId / teamMemberId */
export function chatSubjectCols(x: DualFk) {
  return {
    endUserId: x.endUserId,
    teamMemberId: x.teamMemberId,
  };
}
