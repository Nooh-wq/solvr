// Wrapper error taxonomy. Callers of the shared-platform wrapper should
// catch these three specific error classes (never `Error` broadly) to
// distinguish "the requested row doesn't exist" from "the mutation
// violated a uniqueness constraint" from "a business rule rejected the
// mutation" from actual DB/network failures.
//
// Post-M7, these map cleanly to HTTP status codes:
//   WrapperNotFoundError    → 404
//   WrapperConflictError    → 409
//   WrapperValidationError  → 422

/**
 * Thrown by mutating functions (updateX, deleteX, assignX, ...) when
 * the referenced resource id doesn't exist. Read functions (getX)
 * return `null` on miss instead of throwing.
 */
export class WrapperNotFoundError extends Error {
  readonly resourceType: string;
  readonly id: string;
  constructor(resourceType: string, id: string) {
    super(`${resourceType} not found: ${id}`);
    this.name = "WrapperNotFoundError";
    this.resourceType = resourceType;
    this.id = id;
  }
}

/**
 * Thrown when a mutation would violate a unique constraint — a
 * (tenantId, name) tuple already taken, an email already in use, etc.
 * `field` names the conflicting column (e.g. "email", "name") so
 * callers can branch on it. `value` is the value that collided.
 */
export class WrapperConflictError extends Error {
  readonly resourceType: string;
  readonly field: string;
  readonly value: string;
  constructor(resourceType: string, field: string, value: string) {
    super(`${resourceType} conflict: ${field}=${value} already in use`);
    this.name = "WrapperConflictError";
    this.resourceType = resourceType;
    this.field = field;
    this.value = value;
  }
}

/**
 * Thrown when a business-rule guard rejects a mutation. `reason` is a
 * stable machine-readable code so callers can branch on it; `message`
 * is human-readable. Reason codes currently in use:
 *
 * - `"LAST_SUPER_ADMIN"` — updateTeamMember/deleteTeamMember rejected
 *    because target is the sole active Super Admin on this tenant.
 * - `"DUPLICATE_DEFAULT_GROUP"` — createGroup rejected because
 *    isDefault:true was requested but a default group already exists
 *    on this tenant. (See docs/shared-platform-boundary.md §7.4 for
 *    the DB-level backstop planned in Shared Platform.)
 * - `"CANNOT_UNSET_LAST_DEFAULT_GROUP"` — updateGroup rejected because
 *    it would leave the tenant with zero default groups. Promote
 *    another group instead.
 * - `"DEFAULT_GROUP_DELETE"` — deleteGroup rejected because target has
 *    isDefault:true. Promote another group first.
 * - `"STANDARD_ROLE_MODIFY"` — updateRole/deleteRole rejected because
 *    target has isCustom:false. Standard roles are immutable.
 * - `"ROLE_IN_USE"` — deleteRole rejected because TeamMembers still
 *    reference this role. Reassign them first.
 * - `"INVALID_ROLE"` — createTeamMember/updateTeamMember rejected
 *    because the specified roleId doesn't exist in this tenant.
 */
export class WrapperValidationError extends Error {
  readonly reason: string;
  constructor(reason: string, message: string) {
    super(message);
    this.name = "WrapperValidationError";
    this.reason = reason;
  }
}
