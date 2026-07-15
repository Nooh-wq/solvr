// M20.4 — PHI read-permission gate.
//
// A CustomFieldDefinition marked isPhi=true stores its value as an
// envelope-encrypted blob in valueEnc. Reads of that value are gated
// here: callers with the `phiRead` permission on their Role get the
// decrypted plaintext; every other caller gets a MASKED_PHI sentinel
// that the sidebar renders as "•••" (spec §4 diagram).
//
// Permission source: Role.permissions is a JSON blob (Z5.4). We look
// for `permissions.phiRead === true`. ADMIN and SUPER_ADMIN also
// inherit the read by convention — same as the Z5 pattern where
// admin+ bypasses per-role gates on the workspace surfaces.

import type { SessionUser } from "@/lib/auth";

export const MASKED_PHI = "•••";

/**
 * `permissions` on the caller's Role — pulled fresh at each check so
 * a permission revoke propagates on the next read (cheap: it's a JSON
 * column on a row we've usually already loaded elsewhere).
 */
export type RolePermissions = { phiRead?: boolean } & Record<string, unknown>;

export function canReadPhi(session: SessionUser, rolePermissions: RolePermissions | null): boolean {
  if (session.role === "SUPER_ADMIN" || session.role === "ADMIN") return true;
  return !!rolePermissions?.phiRead;
}

/**
 * Convenience wrapper for the common "callers can't read PHI unless
 * their role permits" branch. Returns the plaintext value or
 * MASKED_PHI. Never leaks the value if the definition is PHI and the
 * caller isn't authorised — closed by default.
 */
export function gatePhiValue<T>(
  isPhi: boolean,
  hasReadPermission: boolean,
  value: T
): T | typeof MASKED_PHI {
  if (!isPhi) return value;
  if (!hasReadPermission) return MASKED_PHI;
  return value;
}
