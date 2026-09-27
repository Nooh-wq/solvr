// Public DTOs + input shapes for the shared-platform wrapper.
//
// These are the ONLY types consumers should reference. Consumers must not
// import Prisma types (e.g. `Organization` from `@/generated/prisma`) —
// that would couple them to the Shared Platform's internal schema and
// break the M7 swap contract (see docs/shared-platform-boundary.md §2).
//
// Enum literal unions here mirror the Shared Platform's Prisma enums
// exactly, and the wrapper implementations bridge between the two at
// call boundaries. If a shared enum ever changes, `npm run pull-core`
// catches the drift and this file must be updated in the same commit.

// ---- Enum mirrors ----

export type TicketAccessScope = "ALL" | "GROUPS" | "ASSIGNED_ONLY";
// Z8 widened the DB enum to include TICKET so `add_tag` rule
// actions can tag ticket rows. The wrapper's type mirror needs to
// track that — otherwise every TICKET-scoped row round-trips
// through toAssignmentDto and gets rejected.
export type TagTargetType = "END_USER" | "TEAM_MEMBER" | "ORGANIZATION" | "TICKET";
export type AuditActorType = "TEAM_MEMBER" | "SYSTEM";

// ---- Resource DTOs ----

export type Organization = {
  id: string;
  tenantId: string;
  name: string;
  domain: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type EndUser = {
  id: string;
  tenantId: string;
  email: string;
  name: string | null;
  /** Primary (auto-matched) organization. Additional memberships live on
   *  EndUserOrganization; use listOrganizationsForEndUser() to see all. */
  organizationId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type TeamMember = {
  id: string;
  tenantId: string;
  email: string;
  name: string | null;
  roleId: string;
  ticketAccessScope: TicketAccessScope;
  createdAt: Date;
  updatedAt: Date;
};

export type Group = {
  id: string;
  tenantId: string;
  name: string;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type Role = {
  id: string;
  tenantId: string;
  name: string;
  isCustom: boolean;
  permissions: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
};

export type Tag = {
  id: string;
  tenantId: string;
  name: string;
  color: string;
  createdAt: Date;
  updatedAt: Date;
};

export type TagAssignment = {
  id: string;
  tenantId: string;
  tagId: string;
  targetType: TagTargetType;
  targetId: string;
  createdAt: Date;
};

export type CoreAuditLogEntry = {
  id: string;
  tenantId: string;
  /** null when actorType is SYSTEM. */
  actorId: string | null;
  actorType: AuditActorType;
  action: string;
  resourceType: string;
  resourceId: string;
  fromValue: Record<string, unknown> | null;
  toValue: Record<string, unknown> | null;
  createdAt: Date;
};

// ---- Create + Update input shapes ----

/**
 * Optional `id` on Create*Input:
 *
 * Present on Organization, EndUser, and TeamMember inputs specifically
 * to let the Z1.3 backfill preserve legacy `User.id` / `Company.id`
 * across the boundary. Preserving ids turns Z1.4's FK rewrite
 * (`Message.senderId → Message.senderEndUserId`,
 *  `Ticket.companyId → Ticket.organizationId`, etc.) into a
 * one-statement column-level SQL update instead of a
 * lookup-table-driven migration with drift risk. See
 * `docs/shared-platform-boundary.md` §7.6 for the scoping-miss note
 * — this field was not part of Z1.2 as originally scoped
 * (online-use only), and was added when Z1.3 surfaced the need.
 *
 * Online consumers (Support-app server actions) should NEVER pass
 * `id` — leave it unset and the underlying Prisma default(cuid())
 * allocates one. Passing an id is a backfill-time concern only.
 *
 * Post-M7 (Shared Platform Public API), this maps cleanly to a
 * client-supplied `id` field on the create endpoint — same shape.
 */

export type CreateOrganizationInput = { id?: string; name: string; domain?: string | null };
export type UpdateOrganizationInput = { name?: string; domain?: string | null };

export type CreateEndUserInput = {
  id?: string;
  email: string;
  name?: string | null;
  organizationId?: string | null;
};
export type UpdateEndUserInput = {
  email?: string;
  name?: string | null;
  organizationId?: string | null;
};

export type CreateTeamMemberInput = {
  id?: string;
  email: string;
  name?: string | null;
  roleId: string;
  ticketAccessScope?: TicketAccessScope;
};
export type UpdateTeamMemberInput = {
  email?: string;
  name?: string | null;
  roleId?: string;
  ticketAccessScope?: TicketAccessScope;
};

export type CreateGroupInput = { name: string; isDefault?: boolean };
/**
 * Update-group patch.
 *
 * `isDefault: true` PROMOTES this group to be the tenant's default and
 * atomically demotes whatever group is default today in the same
 * transaction (see groups.ts). `isDefault: false` on the current
 * default is rejected — a tenant must never end up with zero default
 * groups; promote another group instead, which cascades the demotion.
 */
export type UpdateGroupInput = { name?: string; isDefault?: boolean };

export type CreateRoleInput = { name: string; permissions?: Record<string, unknown> };
export type UpdateRoleInput = { name?: string; permissions?: Record<string, unknown> };

export type CreateTagInput = { name: string; color?: string };
export type UpdateTagInput = { name?: string; color?: string };

// ---- CoreAuditLog input ----

export type CoreAuditLogInput = {
  /** Free-form verb, resource-specific ("CREATE" | "UPDATE" | "DELETE" |
   *  "ASSIGN" | "PROMOTE_DEFAULT" | ...). Not an enum on purpose so
   *  future actions don't require a schema migration. */
  action: string;
  resourceType: string;
  resourceId: string;
  fromValue?: Record<string, unknown> | null;
  toValue?: Record<string, unknown> | null;
};

// ---- Pagination ----

/**
 * Cursor-based page. `nextCursor` is opaque to callers — pass it back
 * to the same list function to fetch the next page. `null` means "no
 * more pages." Concurrent writes never cause a caller to see the same
 * item twice or miss one (offset-based pagination has that failure mode).
 */
export type Page<T> = {
  items: T[];
  nextCursor: string | null;
};

export type ListFilter = {
  search?: string;
  /** Max items per page. Defaults to 50 in the wrapper, capped at 200. */
  limit?: number;
  /** Opaque cursor from a previous Page result. */
  cursor?: string;
};
