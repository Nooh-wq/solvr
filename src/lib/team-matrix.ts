// Status → available-actions matrix. Single source of truth used by BOTH
// the UI (to render the right buttons) and the server actions (to reject
// invalid transitions even if the client is bypassed). See
// Stralis_Team_Roles_Build_Spec §3.
//
// The existing enum uses `PENDING` and `SUSPENDED`; the build spec calls
// those `PENDING_APPROVAL` and `DEACTIVATED` — semantics are identical,
// only display labels differ. UNVERIFIED (self-registered, hasn't
// confirmed their email OTP yet) is treated as a not-yet-actionable state
// — no admin decision is meaningful until the email is proven real.

import type { UserStatus } from "@/generated/prisma";

// Z1.6 note: `approve` and `reject` were already in this union but were
// never routed through assertActionAllowed — approveUser/rejectUser in
// admin.ts used raw `WHERE status: "PENDING"` filters that silently
// returned null on invalid state. Z1.6 replaces those with explicit
// assertActionAllowed calls (below). No union change needed; these were
// always intended endpoints of the matrix.
export type TeamAction =
  // PENDING (pending admin approval, spec's PENDING_APPROVAL)
  | "approve"
  | "reject"
  // INVITED (admin-created, hasn't accepted the email link yet)
  | "resendInvite"
  | "revokeInvite"
  // ACTIVE (fully joined)
  | "changeRole"
  | "deactivate"
  // REJECTED (terminal by default; re-invite starts a fresh INVITED flow)
  | "reinvite"
  // SUSPENDED (spec's DEACTIVATED)
  | "reactivate"
  // ACTIVE + SUSPENDED — never INVITED (revoke instead) or PENDING (reject)
  | "delete";

type Options = {
  // True only for the *last* remaining ACTIVE Super Admin on this tenant.
  // Blocks role-change / deactivate / delete for that specific row so the
  // tenant can never lock itself out.
  isLastSuperAdmin: boolean;
};

export function getAvailableActions(status: UserStatus, opts: Options): TeamAction[] {
  const { isLastSuperAdmin } = opts;
  switch (status) {
    case "PENDING":
      return ["approve", "reject"];
    case "INVITED":
      return ["resendInvite", "revokeInvite"];
    case "ACTIVE":
      if (isLastSuperAdmin) return [];
      return ["changeRole", "deactivate", "delete"];
    case "REJECTED":
      return ["reinvite"];
    case "SUSPENDED":
      return ["reactivate", "delete"];
    case "UNVERIFIED":
    default:
      return [];
  }
}

/**
 * Server-action guard: throws if the given action is not currently available
 * for a user in this status. The client already only renders allowed buttons
 * per getAvailableActions(); this exists so a direct API call bypassing the
 * UI still gets rejected.
 */
export function assertActionAllowed(
  action: TeamAction,
  status: UserStatus,
  opts: Options
): void {
  const allowed = getAvailableActions(status, opts);
  if (!allowed.includes(action)) {
    throw new Error(
      `Action "${action}" is not allowed for a user with status ${status}.`
    );
  }
}
