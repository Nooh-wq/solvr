// The single argument every wrapper function takes. See docs/shared-platform-
// boundary.md for the full boundary rules and this module's contract.
//
// WrapperContext deliberately does NOT expose a `role` field:
// - The shared-platform tables' RLS policies only check `tenantId`
//   (see docs/shared-platform-boundary.md §5).
// - The wrapper's internal `withRls` call always uses `SUPER_ADMIN` as the
//   role, which is irrelevant to the shared-platform side and defends
//   against accidental writes to Support-owned tables (SUPER_ADMIN can
//   read everything but this repo's mirror rule 4 forbids the wrapper
//   from touching Support-owned tables to begin with).
// - Post-M7 the API caller's identity comes from an auth header, not a
//   role field. Keeping `role` off the wrapper surface makes the swap
//   cleaner.

import type { SessionUser } from "@/lib/auth";

export type WrapperContext = {
  tenantId: string;
  /**
   * Who's making the request, for CoreAuditLog attribution. `null` means
   * system-actor (backfills, cron jobs, unauthenticated verification
   * flows). The wrapper's mutation functions translate this to the
   * `AuditActorType` enum: `teamMemberId` set → `TEAM_MEMBER`,
   * `null` → `SYSTEM`.
   */
  actor: { teamMemberId: string } | null;
};

/**
 * Build a system-actor context. For backfills, cron jobs, and any server
 * flow that isn't attributable to a specific TeamMember. Every mutation
 * made through this context emits a CoreAuditLog row with
 * `actorType = SYSTEM` and `actorId = null`.
 */
export function systemContext(tenantId: string): WrapperContext {
  return { tenantId, actor: null };
}

/**
 * Build a WrapperContext from an authenticated SessionUser (i.e. a
 * staff request from a Support-app server action).
 *
 * IMPORTANT: between now and Z1.3's backfill, no `team_members` rows
 * exist for any real user, so `matchTeamMemberByEmail` returns null and
 * this function falls back to a system-actor context. Every
 * CoreAuditLog entry emitted through the wrapper during this window
 * will therefore attribute as SYSTEM — that's expected. Post-Z1.3
 * backfill, the TeamMember lookup by session.email will succeed and
 * `actor.teamMemberId` will populate correctly with no code change here.
 *
 * The lookup uses a fresh `systemContext(session.tenantId)` internally
 * to avoid a chicken-and-egg (we can't fill actor before we've found
 * the actor). Auditing that particular read as SYSTEM is correct — the
 * lookup is bookkeeping, not a mutation.
 */
export async function contextFromSession(session: SessionUser): Promise<WrapperContext> {
  const { matchTeamMemberByEmail } = await import("./team-members");
  const teamMember = await matchTeamMemberByEmail(systemContext(session.tenantId), session.email);
  return {
    tenantId: session.tenantId,
    actor: teamMember ? { teamMemberId: teamMember.id } : null,
  };
}
