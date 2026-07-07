// Dual-FK column mapper for Support-owned tables that reference the
// wrapper (tickets, messages, audit_logs, notifications, attachments,
// ticket_guests, login_otps, chat_conversations).
//
// Exactly one of the two returned fields is set on a per-column-pair
// basis — matching the num_nonnulls(...) <= 1 CHECK constraints.
//
// Post-Z1.5c: the legacy singular FK columns (senderId, clientId,
// actorId, uploadedById, invitedById, users-side userId) are gone —
// callers no longer pair these col-writers with a legacy write.

import type { UserRole } from "@/lib/auth";

type DualFk = { endUserId: string | null; teamMemberId: string | null };

/**
 * Neutral shape: exactly one of {endUserId, teamMemberId} is set based
 * on session role. CLIENT → EndUser, everything else → TeamMember.
 */
export function dualFkForUser(userId: string, role: UserRole): DualFk {
  if (role === "CLIENT") return { endUserId: userId, teamMemberId: null };
  return { endUserId: null, teamMemberId: userId };
}

/** SYSTEM/BOT actor — both null. Used for cron jobs, auto-close, etc. */
export const SYSTEM_ACTOR: DualFk = { endUserId: null, teamMemberId: null };

/**
 * Session-cookie subjectKind for a given role. CLIENT users live in
 * end_users; every other role lives in team_members.
 */
export function roleToSubjectKind(role: UserRole): "END_USER" | "TEAM_MEMBER" {
  return role === "CLIENT" ? "END_USER" : "TEAM_MEMBER";
}

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

/** tickets.clientEndUserId / clientTeamMemberId */
export function ticketClientCols(x: DualFk) {
  return {
    clientEndUserId: x.endUserId,
    clientTeamMemberId: x.teamMemberId,
  };
}

/** tickets.assignedTeamMemberId — assignee is always staff. */
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

// ---------------------------------------------------------------------------
// Where-clause helpers — filter a Support-owned row by the current
// session's dual-FK identity.
// ---------------------------------------------------------------------------

/** tickets — "this session IS the ticket client" (portal reads). */
export function ticketClientWhereFor(subjectId: string, role: UserRole) {
  return role === "CLIENT"
    ? { clientEndUserId: subjectId }
    : { clientTeamMemberId: subjectId };
}

/** notifications — "this session IS the recipient". */
export function notificationRecipientWhereFor(subjectId: string, role: UserRole) {
  return role === "CLIENT"
    ? { recipientEndUserId: subjectId }
    : { recipientTeamMemberId: subjectId };
}

/** chat_conversations — "this session IS the subject". */
export function chatSubjectWhereFor(subjectId: string, role: UserRole) {
  return role === "CLIENT"
    ? { endUserId: subjectId }
    : { teamMemberId: subjectId };
}
