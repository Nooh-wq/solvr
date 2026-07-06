# Shared Platform Boundary

**Status:** Live as of Z1.1 (Six-Object Model Refactor — Foundation).
**Related:** Shared Platform's [ADR-004: Single Public Schema Ownership by Convention].

The Support app (this repo) and the Stralis Shared Platform (`../Stralis Shared Platform`) are **two separate Next.js codebases that share one physical Postgres database**. Neither imports server code from the other. Schema ownership is enforced by convention + code review, not by the database.

This document is the authoritative reference for that convention. Read it whenever you're about to:
- Add a new Prisma model
- Run a Prisma migration (`migrate dev`, `db push`, or a raw SQL migration)
- Query or mutate one of the shared core tables (Organization, EndUser, TeamMember, Group, Role, Tag, and their joins)
- Change how the Support app talks to identity/org/roles data

---

## 1. Who owns what

### Owned by the **Shared Platform** (`../Stralis Shared Platform`)

Nine tables + three enums for identity, org, roles, tags, and a generic audit log:

| Table | Purpose |
|---|---|
| `organizations` | Replaces the legacy `companies` table. Domain-based auto-match. |
| `end_users` | Replaces the `role=CLIENT` slice of the legacy `users` table. |
| `end_user_organizations` | Multi-org memberships beyond `EndUser.organizationId`. |
| `team_members` | Replaces the AGENT/ADMIN/SUPER_ADMIN slice of the legacy `users` table. |
| `groups` | Team groupings for access scoping. Every tenant seeds a default "Support" group. |
| `team_member_groups` | Membership join for TeamMember ↔ Group. |
| `roles` | Custom roles per tenant. Replaces the `LegacyRole` enum. |
| `tags` | Tenant-scoped tags. |
| `tag_assignments` | Polymorphic join — targets End User / Team Member / Organization. |
| `core_audit_logs` | Generic mutation log for any core-object change. |

Enums: `TicketAccessScope`, `TagTargetType`, `AuditActorType`.

The Shared Platform's `prisma/schema.prisma` is the **single source of truth**. Their repo runs the migrations that create/alter/drop these tables. This repo never does.

### Owned by the **Support app** (this repo)

Everything else in this repo's `prisma/schema.prisma`:

- `tenants`, `tenant_branding`, `chatbot_configs`, `categories` — tenant meta.
- `users`, `companies` — **legacy**, on borrowed time (dies in Z1.5 once the backfill + wrapper switch is done).
- `tickets`, `messages`, `attachments`, `ticket_guests`, `login_otps`, `audit_logs`, `notifications`, `survey_responses` — support-specific.
- `kb_articles`, `kb_chunks`, `chat_conversations`, `chat_messages` — AI + KB.

This repo owns their migrations.

### The Tenant open item

`Tenant` **stays owned by this repo for now.** Confirmed by inspection of the Shared Platform's `schema.prisma` (line 12 comment). Every tenant-scoped table across both repos references `tenants(id)` — the Shared Platform stores `tenantId` as a plain scalar column and enforces the FK to `tenants(id)` at the DB level via a raw-SQL constraint in its own migration.

**Future ADR needed:** *Tenant ownership migration to Shared Platform.* Tenant is genuinely a core primitive (same reasoning as Organization), and long-term it belongs in the Shared Platform. But moving it means:
- Coordinating a migration across two repos on a live production DB
- Reworking every FK on both sides
- Deciding what happens to `TenantBranding`, `ChatbotConfig` — do those move too, or stay in Support?

This is too consequential to bundle as a side effect of any other milestone. It gets its own explicit ADR and its own dedicated milestone. Filed as an open item; not blocked on anything today.

---

## 2. How this repo talks to the shared tables (pre-M7)

### The mirror

To let this repo query/mutate the shared tables through Prisma, the 9 tables + 3 enums are **mirrored** into this repo's `prisma/schema.prisma` under the header:

```
// ===========================================================================
// STRALIS SHARED PLATFORM — REFERENCE MODELS (Z1: Six-Object Model Refactor)
// ===========================================================================
```

The mirrored models are byte-for-byte identical to the Shared Platform's declarations. This gives us TypeScript types + a working Prisma Client for those tables without needing an HTTP API.

### The wrapper (Z1.2)

Consumers **do not call `prisma.organization.*` or `prisma.teamMember.*` directly.** They call typed wrapper functions in `src/lib/shared-platform/`:

```
src/lib/shared-platform/
├── organizations.ts    // getOrganization, listOrganizations, matchOrganizationByEmail, ...
├── team-members.ts     // getTeamMember, listTeamMembers, ...
├── end-users.ts        // getEndUser, matchEndUserByEmail, ...
├── groups.ts           // ...
├── roles.ts            // ...
├── tags.ts             // ...
├── audit.ts            // writeCoreAuditLog
├── types.ts            // re-exports of Prisma types for consumers
└── README.md
```

Each function:
- Opens a `withRls()` transaction with the correct role/tenant context.
- Writes a `CoreAuditLog` row on every mutation.
- Returns strongly-typed data.

The function surface deliberately mirrors what the Shared Platform's **Public API (M7)** will expose.

### The M7 swap

Once the Shared Platform's Public API ships, the wrapper's internals change from:

```ts
// Pre-M7
return prisma.organization.findMany({ where: { tenantId } });
```

to:

```ts
// Post-M7
return sharedFetch(`/api/v1/organizations?tenantId=${tenantId}`);
```

**Consumer code doesn't change.** Server actions, backfill jobs, and UI keep calling `listOrganizations(tenantId)` — only the wrapper implementation is different.

At that point:
- The mirror block in this repo's `schema.prisma` can be removed.
- This repo's Prisma Client no longer knows about the shared models.
- Cross-DB coordination stops mattering — this repo goes through HTTP.

---

## 3. Rules (enforce in code review)

These are the rules that keep the boundary intact. Violating any of them silently is the kind of thing that surfaces as a production incident three months later.

1. **NEVER edit a mirrored model in this repo.** If the Shared Platform ships schema changes to core, run `npm run pull-core` (currently a manual copy from `../Stralis Shared Platform/prisma/schema.prisma`; automate later) and commit the diff separately.

2. **NEVER run `prisma migrate dev`, `prisma migrate deploy`, or `prisma db push` in this repo while the mirrored models are present** UNLESS every mirrored model matches the DB's current state exactly. If they match, `db push` is a no-op (safe); if they don't, `db push` will attempt to modify the shared DB (dangerous). When in doubt, don't run it.

3. **NEVER introduce a Prisma relation FROM a Support-owned model TO a shared model.** For example, don't add `endUser EndUser @relation(...)` on `Ticket`. Cross-boundary FKs stay as raw scalar columns (`endUserId String?`) and get resolved via the wrapper. Prisma's cascade behavior can't span the boundary reliably.

4. **NEVER query the mirrored models directly from a server action, page, or Inngest job.** Always go through the wrapper (`src/lib/shared-platform/`). The wrapper is the single point where we swap to HTTP at M7.

5. **NEVER write to `core_audit_logs` from Support-app code except via `writeCoreAuditLog()` in the wrapper.** This keeps the shape consistent for the Shared Platform's own audit reads.

6. **NEVER mix Support's own `audit_logs` and the shared `core_audit_logs`.** Support's `audit_logs` is ticket-shaped (has `ticketId`, `fromValue/toValue` as plain strings) and stays. The core log is object-shaped (`resourceType`, `resourceId`, JSON values). They serve different purposes; don't collapse them.

7. **NEVER assume Tenant is in the Shared Platform.** It's not. Continue writing `tenantId` as a plain scalar on all shared-model rows, but treat `Tenant` itself as Support-owned.

If breaking any of these rules seems necessary to ship a feature, **stop and escalate** — either the boundary itself is wrong (unlikely) or the feature is designed against it (fixable in design).

---

## 4. Refreshing the mirror when the Shared Platform changes

**Manual process for now:**

1. Open `../Stralis Shared Platform/prisma/schema.prisma`.
2. Copy the models + enums between (and including) the section headers marking the Z1 objects.
3. Paste over the mirror block in this repo's `prisma/schema.prisma` (between the `STRALIS SHARED PLATFORM — REFERENCE MODELS` opening + closing banners).
4. Run `npx prisma generate` (stop the dev server first if running).
5. Run `npx tsc --noEmit` — fix any wrapper functions or consumers whose types drifted.
6. Commit as a single "refresh shared platform mirror" change, separate from any feature work.

**Automation TODO:** an `npm run pull-core` script that diffs the two schema files and prints exactly which models diverged. Nice-to-have; not blocking.

---

## 5. RLS across the boundary

Row-Level Security policies live in the **Shared Platform's** migrations for the shared tables and in this repo's `prisma/rls_policies.sql` for Support tables. Both repos connect as the `app_runtime` Postgres role (no `BYPASSRLS`), and both use the same session-var convention (`app.tenant_id`, `app.user_id`, `app.role`, `app.guest_ticket_id`).

Postgres doesn't care which repo made a query — the RLS policies check the session vars, not the caller. So the wrapper's `withRls()` calls in this repo hit the same tenant-isolation policies the Shared Platform's own code does. Cross-tenant leakage is prevented at the DB layer regardless of which repo is asking.

---

## 6. Coordination checklist for schema-touching changes

When the Shared Platform ships a change to a core table:

- [ ] Their PR merges and their migration deploys to production.
- [ ] Refresh the mirror in this repo (§4) in a separate PR.
- [ ] Update the wrapper in `src/lib/shared-platform/` if the API surface changed.
- [ ] Update consumers if the wrapper signature changed.
- [ ] Deploy this repo.

When this repo ships a change to its own tables (tickets, messages, etc.):

- [ ] Update this repo's `schema.prisma` and any RLS policies.
- [ ] `prisma db push` (this repo's established pattern; migrations have drift).
- [ ] No coordination with the Shared Platform needed, as long as the change doesn't reference a core table's schema.

When either side wants to add a Foreign Key across the boundary:

- [ ] Discuss in an ADR before implementing. Cross-boundary FKs are fragile enough that they deserve explicit design review.
