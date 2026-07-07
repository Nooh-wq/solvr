// Z1.4b UI view-models: the common shape UI consumers need when
// displaying a person on a ticket, message, audit log, notification,
// etc. Decoupled from the wrapper's DTO shape on purpose — the wrapper
// stays minimal (see docs/shared-platform-boundary.md §2), and UI
// consumers shouldn't couple to its internal shape either.
//
// If a consumer needs a field the view-model doesn't expose, that's a
// signal to widen the view-model in ONE place (this file), not to
// bypass the wrapper. Widening in one place keeps the surface small
// and the widening decision auditable.
//
// Legacy-only fields (avatarUrl, status) are documented as null in
// Z1.4b — the wrapper does not yet expose them. If they turn out to
// be truly required post-Z1.5, the fix is to widen the Shared Platform
// EndUser/TeamMember schema (cross-repo migration), not to keep dual
// reads live in Support long-term.

import type { EndUser, TeamMember } from "@/lib/shared-platform";

/** Which flavor of person this view-model came from. UIs typically use
 *  this to pick an icon or default color (client vs staff). */
export type UserLikeKind = "END_USER" | "TEAM_MEMBER";

export type UserLike = {
  id: string;
  name: string | null;
  email: string;
  kind: UserLikeKind;
  // ---- Fields not currently exposed by the wrapper ----
  // In Z1.4b these are always null. Consumers that today read
  // `user.avatarUrl` off the legacy `include: { sender: {...} }`
  // shape will see avatars stop rendering. If avatars are a hard
  // requirement post-Z1.5, widen the wrapper (Shared Platform schema
  // change) — do NOT add a legacy-User read alongside the wrapper
  // call. See boundary doc §7.9.
  avatarUrl: string | null;
  // Legacy User.status ("ACTIVE" | "INVITED" | "PENDING" | ...) is a
  // Support-side lifecycle concept, not a Shared Platform concept.
  // EndUser/TeamMember rows simply exist — there's no PENDING EndUser.
  // If a consumer needs "is this account provisioned yet" post-Z1.5,
  // that lookup lives on the Support side (invites table etc.), not
  // on the person view-model.
  status: null;
};

// ---------------------------------------------------------------------------
// DTO → view-model converters
// ---------------------------------------------------------------------------

export function endUserToUserLike(eu: EndUser): UserLike {
  return {
    id: eu.id,
    name: eu.name,
    email: eu.email,
    kind: "END_USER",
    avatarUrl: null,
    status: null,
  };
}

export function teamMemberToUserLike(tm: TeamMember): UserLike {
  return {
    id: tm.id,
    name: tm.name,
    email: tm.email,
    kind: "TEAM_MEMBER",
    avatarUrl: null,
    status: null,
  };
}

// ---------------------------------------------------------------------------
// Dual-FK resolver — the pattern every Z1.4b list-view uses
// ---------------------------------------------------------------------------

/**
 * Given a row's dual-FK column pair (populated by Z1.4a's backfill +
 * dual-write) and pre-fetched batch Maps from
 * `getEndUsersByIds`/`getTeamMembersByIds`, return the display
 * view-model. `null` when neither column is set (SYSTEM/BOT/GUEST
 * rows) or when the referenced row is missing from the batch.
 *
 * Deliberately synchronous — the async batch fetches happen ONCE per
 * list (before rendering), then this resolver runs per row over the
 * pre-fetched Maps. Keeps the pattern O(1) per row, O(1) roundtrips
 * per identity kind per list.
 */
export function resolveUserLike(
  cols: { endUserId: string | null; teamMemberId: string | null },
  endUsers: Map<string, EndUser>,
  teamMembers: Map<string, TeamMember>
): UserLike | null {
  if (cols.endUserId) {
    const eu = endUsers.get(cols.endUserId);
    return eu ? endUserToUserLike(eu) : null;
  }
  if (cols.teamMemberId) {
    const tm = teamMembers.get(cols.teamMemberId);
    return tm ? teamMemberToUserLike(tm) : null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Message + Audit-log author view-models
//
// These handle the FULL author state space, including the legitimate
// "no author FK set" case that the Z1.1b/Z1.4a CHECKs allow
// (num_nonnulls(...) <= 1, which permits 0 non-nulls). For messages
// that's SYSTEM/BOT rows; for audit_logs it's SYSTEM-attributed
// rows (backfills, crons, auto-close, etc.).
// ---------------------------------------------------------------------------

/**
 * The full "who wrote this message" state space:
 *   - a real person (EndUser or TeamMember, via dual-FK)
 *   - a ticket guest (Support-owned, `Message.guestId`)
 *   - a labeled system/bot fallback (all sender FKs + guestId null)
 *
 * Never `null`. UI can render `name` as the display attribution and
 * branch on `kind` for icon/color if needed.
 */
export type MessageSender =
  | UserLike
  | { kind: "GUEST"; name: string; avatarUrl: null; email: string; id: null; status: null }
  | { kind: "SYSTEM"; name: string; avatarUrl: null; email: null; id: null; status: null };

/**
 * The full "who did this audit action" state space:
 *   - a real person (EndUser or TeamMember, via dual-FK)
 *   - a labeled system fallback (both actor FKs null — legitimate
 *     for auto-close cron, backfills, and 5 existing pre-Z1.1b rows)
 *
 * Never `null`. Boundary doc §7.2 explicitly documents that the
 * `<= 1` bound must remain (not `= 1`) precisely to allow this.
 */
export type AuditActor =
  | UserLike
  | { kind: "SYSTEM"; name: string; avatarUrl: null; email: null; id: null; status: null };

/**
 * Resolves a message's displayed sender. Handles all four author
 * states declared by the Z1.4a `messages_sender_exclusive` CHECK
 * (endUser | teamMember | guest | none).
 *
 * `senderRoleLabel` disambiguates the none case: BOT messages surface
 * as "Bot", everything else as "System". Callers pass their message's
 * `senderRole` directly.
 */
export function resolveMessageSender(
  cols: {
    senderEndUserId: string | null;
    senderTeamMemberId: string | null;
    guest: { name: string | null; email: string } | null;
    senderRole: string; // "CLIENT" | "AGENT" | "ADMIN" | "BOT" | "SYSTEM" | ...
  },
  endUsers: Map<string, EndUser>,
  teamMembers: Map<string, TeamMember>
): MessageSender {
  const user = resolveUserLike(
    { endUserId: cols.senderEndUserId, teamMemberId: cols.senderTeamMemberId },
    endUsers,
    teamMembers
  );
  if (user) return user;
  if (cols.guest) {
    return {
      kind: "GUEST",
      name: cols.guest.name ?? cols.guest.email,
      avatarUrl: null,
      email: cols.guest.email,
      id: null,
      status: null,
    };
  }
  // No user, no guest — labeled fallback derived from senderRole.
  return {
    kind: "SYSTEM",
    name: cols.senderRole === "BOT" ? "Bot" : "System",
    avatarUrl: null,
    email: null,
    id: null,
    status: null,
  };
}

/**
 * Resolves an audit_log's displayed actor. Handles all three actor
 * states declared by the Z1.4a `audit_logs_actor_exclusive` CHECK
 * (endUser | teamMember | none).
 */
export function resolveAuditActor(
  cols: {
    actorEndUserId: string | null;
    actorTeamMemberId: string | null;
  },
  endUsers: Map<string, EndUser>,
  teamMembers: Map<string, TeamMember>
): AuditActor {
  const user = resolveUserLike(
    { endUserId: cols.actorEndUserId, teamMemberId: cols.actorTeamMemberId },
    endUsers,
    teamMembers
  );
  if (user) return user;
  return {
    kind: "SYSTEM",
    name: "System",
    avatarUrl: null,
    email: null,
    id: null,
    status: null,
  };
}
