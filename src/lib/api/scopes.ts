// src/lib/api/scopes.ts
//
// M7.1 — canonical scope catalog. Flat kebab-case strings matching what
// most public APIs converge on (Stripe/GitHub/Slack). Each scope is
// derived from the Z5 permission catalog in src/lib/permissions.ts —
// this keeps API key permissions bounded by the role/permission model
// the human UI already enforces.
//
// Naming: <resource>:<verb>. `admin:*` is deliberately special-cased
// as "everything under the admin subtree" — used only for the initial
// bootstrap when there's no finer-grained catalog to map against.

import { PERMISSION_CATEGORIES } from "@/lib/permissions";

export type ApiScope = string;

/**
 * Canonical scope list. The order is display order for the admin UI.
 * Every scope MUST map to a permission (or a group of permissions) in
 * src/lib/permissions.ts — that's how deriveMaxScopes below narrows
 * a creator's grant.
 */
export const API_SCOPES: Array<{
  scope: ApiScope;
  label: string;
  description: string;
  requiredPermissions: string[]; // AND — creator must have ALL of these
}> = [
  {
    scope: "tickets:read",
    label: "Read tickets",
    description: "GET /api/v1/tickets and /api/v1/tickets/{ref}.",
    requiredPermissions: ["tickets.view"],
  },
  {
    scope: "tickets:write",
    label: "Create + update tickets",
    description: "POST/PATCH /api/v1/tickets.",
    requiredPermissions: ["tickets.view", "tickets.edit_properties"],
  },
  {
    scope: "users:read",
    label: "Read users",
    description: "GET /api/v1/users.",
    requiredPermissions: ["people.view"],
  },
  {
    scope: "users:write",
    label: "Create + update users",
    description: "POST/PATCH /api/v1/users.",
    requiredPermissions: ["people.view", "people.edit"],
  },
  {
    scope: "webhooks:manage",
    label: "Manage outbound webhooks",
    description: "Create/edit/delete webhook subscriptions.",
    requiredPermissions: ["apps.manage"],
  },
];

const ALL_SCOPES = new Set(API_SCOPES.map((s) => s.scope));

/**
 * True if `scope` is a known kebab-string in the catalog.
 */
export function isKnownScope(scope: string): boolean {
  return ALL_SCOPES.has(scope);
}

/**
 * The set of scopes an API-key creator with these role-permission keys
 * is allowed to grant. Enforced at key-create time (M7.1) — a Staff
 * Agent whose role denies `people.edit` can't mint a key with
 * `users:write`.
 *
 * `permissions` is the role's flat map (key → boolean). Missing keys
 * are treated as false, per src/lib/permissions.ts's stated convention.
 */
export function deriveMaxScopes(permissions: Record<string, boolean>): ApiScope[] {
  return API_SCOPES.filter((s) =>
    s.requiredPermissions.every((p) => permissions[p] === true)
  ).map((s) => s.scope);
}

/**
 * True if `keyScopes` is a subset of `allowedScopes`. Used at key
 * create time to reject an over-requested scope set with a clear error.
 */
export function scopesWithinLimit(
  keyScopes: ApiScope[],
  allowedScopes: ApiScope[]
): { ok: true } | { ok: false; excess: ApiScope[] } {
  const allowed = new Set(allowedScopes);
  const excess = keyScopes.filter((s) => !allowed.has(s));
  return excess.length === 0 ? { ok: true } : { ok: false, excess };
}

/**
 * True if `required` is present in `granted`. Used at every request
 * dispatch to check the endpoint's declared scope against the key's grant.
 */
export function hasScope(granted: ApiScope[], required: ApiScope): boolean {
  return granted.includes(required);
}

// Re-export PERMISSION_CATEGORIES so the tests can pin the scope→permission
// mapping without importing lib/permissions directly.
export { PERMISSION_CATEGORIES };
