# Z5 — outstanding shared-platform changes

Z5 (Access Scoping, Custom Roles & Light Agent) is a cross-repo milestone.
The Support-side portion is landing in this PR; the following changes must
happen in the sibling `../Stralis Shared Platform` repo before Z5 can be
called Done Per Spec. Neither is blocking for the Support-side pieces to
work — the app-layer scope filter operates on the three enum values that
already exist, and Light Agent is UI-guardrailed against `roleName ===
"Light Agent"` which just returns false today until the wrapper seeds
that preset.

Read this alongside `docs/shared-platform-boundary.md` — every change
below belongs to the wrapper's own migration + code review, not this
repo's.

## 1. Extend `TicketAccessScope` enum with `ORG`

Current enum (`prisma/schema.prisma` in the shared repo):

```prisma
enum TicketAccessScope {
  ALL
  GROUPS
  ASSIGNED_ONLY
}
```

Spec §1 wants four values: `ALL | GROUPS | ORG | ASSIGNED`. `ASSIGNED_ONLY`
already matches (name mismatch — the spec's short-form is stylistic). The
missing value is `ORG` — restricting an agent to tickets from a specific
org, used by MSPs whose agents are assigned to one client organization.

**Migration shape** (wrapper repo):

```sql
alter type "TicketAccessScope" add value 'ORG' after 'GROUPS';
```

**Support-side follow-up** once merged: extend
`ticketScopeWhereFor()` in `src/actions/tickets.ts` with an ORG branch
that filters on `Ticket.organizationId` and add the fourth radio to
`scope-editor.tsx`. Both are tiny additive changes.

## 2. Seed additional standard roles

Current `STANDARD_ROLE_NAMES` (wrapper `src/lib/shared-platform/roles.ts`):

```ts
const STANDARD_ROLE_NAMES = ["Super Admin", "Admin", "Agent"] as const;
```

Spec §5.1 wants six presets: End User, Light Agent, Staff Agent, Team Lead,
Admin, Super Admin. `End User` is a Support-side identity concept (not a
Role row today — see `wrapperRoleNameToUserRole()` in `src/lib/auth.ts`
which returns `"CLIENT"` for end users without consulting a Role name),
so it does **not** need to be seeded as a Role. The other five do:

```ts
const STANDARD_ROLE_NAMES = [
  "Super Admin",
  "Admin",
  "Team Lead",
  "Staff Agent",
  "Light Agent",
  "Agent",   // Kept for backward compatibility — existing tenants have
             // members on this role. Consider aliasing to "Staff Agent"
             // in a later pass rather than a rename migration.
] as const;
```

**Default permission blobs**: the Support side owns the permission catalog
(`src/lib/permissions.ts` — 8 categories). Seed sensible defaults per
preset when creating the Role row. The Light Agent preset in particular
must have `tickets.reply_public: false` and `tickets.reply_internal:
true` — the Support-side guardrail in `postAgentReply()` keys off
`roleName === "Light Agent"` regardless, so this is defense in depth
rather than the only enforcement point.

## 3. (Nice to have) wrapper-side team-member-scope update audit event

`updateTeamMember({ ticketAccessScope })` already writes a
`writeCoreAuditLogInTx` UPDATE entry against the TeamMember row. That's
enough for now — no work needed unless we want a first-class
`TICKET_ACCESS_SCOPE_CHANGE` action string, which we don't for M2.

---

## What NOT to do in the wrapper

- Do not add scope enforcement at the wrapper's data-access layer.
  Scope is a Support-side concept (it only makes sense for tickets, and
  the wrapper does not know about tickets — rule 2 in the boundary doc,
  "no Support-owned tables in wrapper code"). Wrapper stores the value;
  Support enforces it.
- Do not delete or rename existing standard roles ("Super Admin",
  "Admin", "Agent") — the Support session-resolve path
  (`wrapperRoleNameToUserRole()`) hard-codes those three strings.
