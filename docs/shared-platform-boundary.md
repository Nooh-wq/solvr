# Shared Platform Boundary

**Status:** Live as of Z1.1 (Six-Object Model Refactor — Foundation).
**Related:** Shared Platform's [ADR-004: Single Public Schema Ownership by Convention].

## Confirmed setup as of 2026-07-07

Both repos are confirmed pointed at the same Supabase instance
(`db.iimmxaxdeucbhkevwotz.supabase.co`) — this was a setup gap from
Shared Platform's original scaffolding (its `.env` pointed at a local
PGlite instance while Support was on production Supabase), which was
closed as part of Z1.1b's pre-work. This fact is on record so it's
never in question again.

Verified against Supabase directly (not against a throwaway local test DB):
- All 10 shared tables + 3 shared enums are present.
- `tenant_isolation` RLS policy exists on all 10 shared tables.
- Support's `app_runtime` role can read/write the shared tables through
  its own `APP_DATABASE_URL` (i.e. the wrapper service will work at runtime).
- Cross-tenant RLS isolation was proven by a targeted round-trip test:
  tenant A inserted an Organization; tenant B queried and updated it;
  both returned zero rows. Rows cleaned up after the test.

The Shared Platform's Vitest tenant-isolation suite runs against a
throwaway embedded Postgres (see `src/core/__tests__/global-setup.ts`
in that repo) — that's a deliberate design choice for CI portability
and doesn't validate the Supabase deployment. The one-off proof above
covers that gap for this specific migration.

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

8. **When modifying a Support-owned table while the mirror block is present, use `prisma db execute` with a hand-written SQL file — NEVER `prisma db push` or `prisma migrate dev/deploy`.** Rule 2 explains the "don't"; this is the "do." The workflow:

   - Add a file `prisma/<name>_migration.sql` in this repo. Make every statement idempotent (`ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, `DROP CONSTRAINT IF EXISTS ... ADD CONSTRAINT ...`) so re-running is safe.
   - Apply with `npx prisma db execute --file prisma/<name>_migration.sql --schema prisma/schema.prisma`.
   - Keep the SQL file checked in as the durable record of what ran against the DB — no scratch scripts deleted after use.
   - Also update `prisma/schema.prisma` to reflect the new shape, so `prisma generate` produces the right TypeScript types. The SQL file is the source of truth for DDL; schema.prisma is the source of truth for the Prisma Client.

   Why this shape at all: Prisma's `migrate diff` and `db push` both walk the whole schema, including the mirrored shared-platform models, and want to re-emit FK constraints Prisma thinks are missing but the shared platform's own migration already created. That either fails loudly (constraint already exists) or, worse, silently reshapes something inside the shared platform's ownership boundary. Direct `db execute` runs only the SQL you wrote — no diff engine involvement.

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

---

## 7. Open items tracked for later Z1 phases

Durable record so nothing gets forgotten between milestones.

### 7.1 Z1.4 must extend the dual-FK treatment to 6 more Support-owned tables

Z1.1b added nullable `senderEndUserId`/`senderTeamMemberId` to `messages`
and `actorEndUserId`/`actorTeamMemberId` to `audit_logs`, plus
`num_nonnulls(..) <= 1` CHECK constraints on each. Same treatment lands
during Z1.4a's schema-migration pass on the remaining tables that reference
a `User` today and could point at either an `EndUser` or a `TeamMember`
tomorrow. Each row below shipped in Z1.4a (`prisma/z1_4a_migration.sql`):

| Table | Current FK | Dual-FK columns added | CHECK constraint name |
|---|---|---|---|
| `tickets` | `clientId` | `clientEndUserId`, `clientTeamMemberId` | `tickets_client_exclusive` |
| `ticket_guests` | `invitedById` | `invitedByEndUserId`, `invitedByTeamMemberId` | `ticket_guests_inviter_exclusive` |
| `login_otps` | `userId` | `endUserId`, `teamMemberId` | `login_otps_subject_exclusive` |
| `notifications` | `userId` (recipient) | `recipientEndUserId`, `recipientTeamMemberId` | `notifications_recipient_exclusive` |
| `attachments` | `uploadedById` | `uploadedByEndUserId`, `uploadedByTeamMemberId` | `attachments_uploader_exclusive` |
| `chat_conversations` | `userId` | `endUserId`, `teamMemberId` | `chat_conversations_subject_exclusive` |

`tickets.assignedTeamMemberId` is a single (non-dual) new column — the
assignee is always staff by construction (product decision), so there's
no client-side variant. Same for `tickets.organizationId` — one column
denormalizing the client's org for analytics/routing. See §7.7 for the
`tickets.clientId` dual-FK decision.

Z1.4a also **tightens** the two Z1.1b CHECKs to match the §7.2 endpoint
shape early: `messages_sender_exclusive` becomes 3-way
(`senderEndUserId`, `senderTeamMemberId`, `guestId` — legacy `senderId`
dropped from the arg list) and `audit_logs_actor_exclusive` becomes
2-way (`actorEndUserId`, `actorTeamMemberId` — legacy `actorId`
dropped). This was mandatory for the Z1.4a dual-write pattern to work:
during the transition every insert carries BOTH legacy and one new
column, which the old 4-way / 3-way forms would reject. Z1.5's §7.2
scope shrinks to just `DROP COLUMN "senderId"` / `DROP COLUMN "actorId"`
— the CHECK expressions themselves are already at their endpoint form.

### 7.2 Z1.5 must tighten every CHECK constraint

When Z1.5 drops the legacy `User` and `Company` tables, every CHECK
constraint added in Z1.1b + Z1.4 needs to be tightened in the same
migration step — not left as a follow-up. Specifically:

- `messages.messages_sender_exclusive` — drop the legacy `senderId` column,
  drop the old CHECK, re-add as
  `CHECK (num_nonnulls("senderEndUserId","senderTeamMemberId","guestId") <= 1)`.
  Note the `guestId` inclusion: Z1.1b deliberately shipped the initial
  CHECK as 4-way (all four author paths — legacy + endUser + teamMember +
  guestId — mutually exclusive), so the Z1.5 tightening is a straight
  "drop the legacy column and drop it from the CHECK arg list" edit, not
  an expansion in scope. Keep it 3-way (endUser + teamMember + guestId),
  not 2-way. Rejecting a future double-write where a message would carry
  both `senderTeamMemberId` and `guestId` is the exact scenario this CHECK
  exists to catch.
- `audit_logs.audit_logs_actor_exclusive` — drop the legacy `actorId`
  column, drop the old CHECK, re-add as
  `CHECK (num_nonnulls("actorEndUserId","actorTeamMemberId") <= 1)`.
- Same pattern for each of the 5 tables in §7.1 above.

This must be a single Z1.5 migration; do not defer the tightening as a
"follow-up cleanup" — a `<= 1` bound over three columns with one of them
permanently null is subtly bug-shaped (a future writer forgetting the
legacy column doesn't exist gets no signal).

**Existing null-actor rows must not be broken by the tightening.** A
Z1.1b headcount against Supabase found 5 existing `audit_logs` rows
(out of 19 CREATE-action rows) with all three actor FKs null — a
pre-existing app path that emits system-attributed audit entries with
no specific actor. The current `audit_logs_actor_exclusive` CHECK's
`num_nonnulls(...) <= 1` bound allows this (0 non-nulls is `<= 1`). The
Z1.5-tightened form MUST also allow it: keep `<= 1`, do not switch to
`= 1`. If Z1.5 accidentally requires exactly-one actor, those 5 rows
(and any similar ones written between now and Z1.5) will fail the
constraint at ALTER-time and Z1.5 will not apply. The same reasoning
carries to any other table in §7.1 where system-emitted null-actor
rows may exist — verify with a count query before tightening each one.

### 7.3 Future ADR: Tenant ownership migration to Shared Platform

Still open, unchanged from the note in §1. Tenant is a genuine core
primitive that long-term belongs in the Shared Platform. Moving it
requires coordinated migration across two repos on a live database —
not a decision to make as a side-effect of any other milestone. Filed
as an open item; not blocked on anything today.

### 7.4 Required Shared Platform migration: partial unique index on groups.isDefault

**Owner:** Shared Platform (this is a shared-owned table, so this repo cannot add the index without breaching the boundary — see rule 2 and Z1.2's default-group discussion).

**Rationale:** the "at most one `Group` per tenant with `isDefault: true`" invariant that Z1.2 introduces is enforced today at the wrapper layer only (`createGroup` rejects a second default; `updateGroup` atomically demotes the previous default when promoting a new one). That closes the door for all normal write paths but leaves a small race window for two concurrent `createGroup({ isDefault: true })` calls in the same millisecond of tenant provisioning. The correct backstop is a DB-level partial unique index.

**Exact SQL to run in the next Shared Platform migration** (drop-in, idempotent):

```sql
CREATE UNIQUE INDEX IF NOT EXISTS "groups_one_default_per_tenant"
  ON "groups" ("tenantId")
  WHERE "isDefault" = true;
```

**Before running:** verify no tenant has multiple `isDefault: true` groups today. Postgres will reject the CREATE if any tenant already violates the invariant. Fix any violators via UPDATE before the migration runs (should be zero — no data path in either repo can produce this today).

**When this lands in Shared Platform:**
- Support's `createGroup` and `updateGroup` guards stay in place — they still surface friendlier errors before the DB-level rejection. No wrapper change needed.
- Delete the code comment in `src/lib/shared-platform/groups.ts` that references this §7.4 entry (once the DB backstop is real, the comment stops being informative).
- Optionally: remove this §7.4 entry from the boundary doc.

### 7.5 Boundary carve-out: Z1.3 backfill script may bypass the wrapper

**Origin:** Z1.3 (Backfill legacy User + Company into the new six-object model).

**What:** `scripts/z1_3_backfill.mjs` is the one script in this repo permitted to write to Shared-Platform-owned tables directly with raw SQL — i.e. it does not go through `src/lib/shared-platform/*`. It is the explicit and narrow exception to rule 4.

**Why the exception exists:**
- The wrapper is designed for one-write-at-a-time online callers under `withRls` transactions. Backfill is a bulk-insert one-shot admin script running against `DIRECT_URL` (superuser); routing 61 inserts through 61 nested transactions and Prisma type coercion would be pure ceremony.
- The script mirrors the wrapper's semantics exactly: `id` preservation via the Create*Input `id?` field the wrapper now accepts (see §7.6), and one `core_audit_logs` row per mutation with `actorType = SYSTEM` and `actorId = NULL` — identical to what a `systemContext()` call through the wrapper would emit.
- Only this one script has the exception. Any future backfill / data-migration script inherits the same carve-out, but no server-action / API / cron code does.

**Contract for anyone touching the script later:**
- Must continue to write a `core_audit_logs` row for every table mutation (matches wrapper behavior — no attribution gap).
- Must continue to preserve legacy `User.id` / `Company.id` when writing to `end_users` / `team_members` / `organizations`.
- Must remain idempotent (get-by-id, skip if exists) so re-runs don't duplicate work.
- Row counts written to shared tables must match the projection block the script emits, and the DoD block at the end must pass.

### 7.6 Scoping-miss note: `id?` on Create*Input added in Z1.3, not Z1.2

**What happened:** Z1.2 shipped `CreateOrganizationInput`, `CreateEndUserInput`, `CreateTeamMemberInput` without an optional `id` field. Every online consumer (Support-app server actions) wants Prisma to allocate a fresh `cuid()`, so leaving `id` off was reasonable for the scope Z1.2 was designed against — online use only.

**What Z1.3 surfaced:** the backfill needs legacy `User.id` and `Company.id` to survive the boundary. Preserving those ids turns Z1.4's FK rewrite (`Message.senderId → Message.senderEndUserId`, `AuditLog.actorId → AuditLog.actorEndUserId`, `Ticket.companyId → Ticket.organizationId`, etc.) into a one-statement column-level SQL update instead of a lookup-table-driven migration with drift risk.

**The fix:** add an optional `id?: string` to each of the three Create*Input types. The wrapper implementations pass it through with `...(input.id && { id: input.id })` — additive, non-breaking for existing callers (they never pass `id`, Prisma still allocates a cuid). Post-M7 (Shared Platform Public API) this maps cleanly to a client-supplied `id` field on the create endpoint, which real HTTP APIs support (e.g. as an idempotency mechanism).

**Framing:** scoping miss, not a design mistake. Z1.2 was scoped for online use and got that right; Z1.3 was on the roadmap when Z1.2 shipped, and the id-preservation need could have been anticipated. It wasn't. Documenting here so a future reader understands why `id?` exists on those inputs.

**No penalty owed to Z1.2:** because PR #23 was still in-flight (not merged) when this gap surfaced, the fix is an amendment to that PR rather than a follow-up. If you're reading this and Z1.2 has since merged, the fix landed atomically with Z1.3 (this PR).

### 7.7 Ticket dual-FK decision: staff-as-requester is a first-class case

**Origin:** Z1.4a projection surfaced 1 ticket (`SO-26210`, tenant `solvr`) where `Ticket.clientId` pointed at `admin@stralis.app` — a staff `User`, not a `CLIENT`. Legacy schema tolerated this because `clientId` was `User.id` regardless of role. Post-Z1.3, that staff user is a `TeamMember`, not an `EndUser`.

**What Z1.1's §7.1 originally claimed** (now corrected in the amended §7.1): "`Ticket.clientId` is always an EndUser, so `tickets` gets a clean rename in Z1.4 without needing the dual-FK bridge shape."

**Why that claim was wrong** — not a data quirk to route around, but a product-shape mistake:

- The Stralis roadmap includes an **Employee Service Suite** (internal IT/HR helpdesk mode) where staff filing tickets in their own tenant is a first-class case, not an edge case.
- Locking `clientId` to EndUser-only would structurally foreclose on that entire market segment. Any product move into internal helpdesk would require reverting the Z1.4 shape at a much higher cost — reads migrated, UIs assuming `Ticket.client` is always an EndUser, downstream analytics etc.
- The `SO-26210` row is the legitimate expression of that reality against the legacy schema. The data was right; the schema claim was wrong.

**The fix:** Ticket joins the dual-FK bridge shape used by the 5 other §7.1 tables. `Ticket.clientEndUserId` + `Ticket.clientTeamMemberId`, `num_nonnulls(...) <= 1` CHECK. Not a temporary compromise — the intended long-term shape.

**What this decision is NOT:**

- Not "we'll retire staff-as-client once the Employee Service Suite ships." The suite depends on it. The dual-FK stays.
- Not "we discovered we need to grandfather SO-26210 in." It's not one row; it's an entire product mode.
- Not "we bent the model because reads would have broken." Reads still migrate to the wrapper in Z1.4b regardless.

**Downstream Z1.5 implication:** the `tickets_client_exclusive` CHECK's Z1.5 tightening drops `clientId` from the arg list but keeps both `clientEndUserId` and `clientTeamMemberId` — same pattern as `messages_sender_exclusive`'s guest-inclusion (§7.2). Both flavors are permanent.

### 7.8 Admin/Team-page CRUD deferred to Z1.6 — MUST land before Z1.5

**What's deferred**: every `tx.user.*` CRUD call in `src/actions/admin.ts` that backs the Team page and admin flows. Specifically:

- `listTeam()` / `listPendingUsers()` — reads the tenant's `users` rows with legacy `Role` enum + status
- `inviteUser()` — creates a legacy `User` row with `role`, `status: INVITED`, matched via `matchCompanyByEmail`
- `updateUser()` — role change, status change, name/email edits (last-Super-Admin guard lives here)
- `approveUser()` / `rejectUser()` — flips `PENDING` → `ACTIVE`/`REJECTED`, emails notification
- `resendInvite()` / `revokeInvite()` / `reinviteUser()` — invite-flow lifecycle
- `bulkChangeRole()` / `bulkDeactivate()` / `deleteUser()` — admin-only bulk / destructive operations
- The Team page's server component and its `updateUser` / `deleteUser` action wiring

**Why deferred**: Z1.4b's scope is a mechanical "Prisma include → wrapper read" swap on ticket/message/audit_log/attachment/notification read paths. Admin CRUD is a different shape entirely — it requires porting invite flows, role-change guards, bulk operations, and Team-page UI onto `createTeamMember` / `updateTeamMember` / `listTeamMembers` / `listEndUsers`. That expands the PR beyond "swap reads to wrapper" into "port the entire admin surface," which triples the review surface and couples two independent decisions into one PR.

**Why Z1.6, not Z1.5**: Z1.5's job is dropping the legacy `users` + `companies` tables and tightening the CHECK constraints. Once those tables are gone, `listTeam()` / `inviteUser()` / all the flows above hard-crash — the Team page shows a stack trace. Z1.6 (this admin refactor) is the **hard blocker** for Z1.5: Z1.5 cannot start until Z1.6 has landed and been verified. If Z1.5 ships first, the Team page breaks in production.

**Named milestone**: this refactor is now **Z1.6 (Admin/Team page consumer refactor)** — documenting the name in this boundary doc so it can't be silently deferred further. Any future scope-shuffle proposal that would push admin CRUD past Z1.6 needs to update this section explicitly and identify a new blocker gate for Z1.5.

**Ordering guarantee** — SUPERSEDED by §7.11's revised sequence: `Z1.4a (✓) → Z1.4b (✓) → Z1.6 → Z1.8 → Z1.9 → Z1.5 → Z1.7`. Z1.6 is no longer the direct blocker for Z1.5; two intermediate milestones (Z1.8 auth-model rework, Z1.9 findOrCreateSender) sit between them. Rationale in §7.11.

### 7.9 Scoping-miss note: batch id lookups added in Z1.4b, not Z1.2

**What happened:** Z1.2 shipped `getEndUser(ctx, id)` / `getTeamMember(ctx, id)` / `getOrganization(ctx, id)` as single-id readers. That's all any online-use consumer needed at Z1.2 time. Batch lookups weren't in scope.

**What Z1.4b surfaced:** consumer-read migration needs to resolve N ids per list view (attachments per ticket, senders per message thread, actors per audit-log page). Doing N single-id wrapper calls would be N+1 by construction — one Prisma read for the list + N wrapper reads per row. The clean pattern is one SELECT for the list, then one batched wrapper call per identity kind.

**The fix:** add `getEndUsersByIds(ctx, ids)` / `getTeamMembersByIds(ctx, ids)` / `getOrganizationsByIds(ctx, ids)` to the wrapper. Each accepts a `readonly string[]`, returns `Map<string, DTO>` (missing ids simply absent from the Map — no throw). Empty input short-circuits with an empty Map, no DB roundtrip. Same tenant-scoped RLS session shape as the single-id functions.

**Framing:** same shape as §7.6 (`id?` on Create*Input added in Z1.3, not Z1.2). Z1.2 was scoped for online use and got that right; Z1.4b surfaced a legitimate additional need that the original scope didn't anticipate. Additive, non-breaking — no Z1.2 consumer changes behavior. Post-M7, these map cleanly to `GET /api/v1/end-users?ids=...` / `?ids=...` on the respective endpoints, which is how real HTTP APIs support this pattern (JSON:API sparse fieldsets, GraphQL DataLoader, plain `?ids=` — all converge on the same shape).

**No penalty owed to Z1.2:** already merged, but this is an additive extension — no consumer of the original three single-id functions is affected. No amendment to prior PRs needed.

### 7.10 Post-Z1.5 follow-up: avatarUrl needs a wrapper migration path

**What's deferred:** the wrapper's `EndUser` / `TeamMember` DTOs do not currently expose `avatarUrl`. Legacy `users.avatarUrl` was displayed on every message row, ticket-detail sidebar, agent leaderboard, and audit-log entry. Z1.4b's `UserLike` view-model returns `avatarUrl: null` uniformly — Support UI degrades gracefully to initials-only for the duration of Z1.4b → Z1.5 → the post-Z1.5 avatar migration.

**Why Z1.4b can't fix this:** avatarUrl lives on the Shared-Platform-owned table (`end_users` / `team_members` if we were to add it) or on a separate `UserPreference` join table. Adding a column to the Shared Platform's schema is a cross-repo migration (Shared Platform ships a schema change; Support pulls the mirror; both re-generate Prisma). That's the exact class of cross-repo work Z1.4b is trying NOT to bundle in — Z1.4b is a Support-only consumer read migration.

**Why not fix it now via a legacy avatarUrl fallback:** would put a legacy `tx.user.findMany({ ... }, select: { id, avatarUrl })` read alongside every wrapper call. That's exactly the "bypass wrapper" anti-pattern §7.5's carve-out was written to prevent from spreading. If we allow it here it stays live through Z1.5 (which drops the `users` table), meaning either Z1.5 gets blocked or the avatarUrl reads silently break at Z1.5.

**Fix path (named milestone):** **Z1.7 (avatarUrl wrapper migration)**. Two options that need a Shared Platform review at the start of that milestone — Z1.7's design pass picks between them:
- (a) Add `avatarUrl String?` directly to `end_users` / `team_members` in Shared Platform. Simple, ships fast, mildly polluting to the identity DTO surface with a UI concern.
- (b) Introduce a `user_preferences` (or `avatars`) table in Shared Platform keyed by `(tenantId, endUserId | teamMemberId)`. Wrapper adds `getAvatarUrlsByIds(ctx, ids[])`. More flexible if UI ever needs more per-person UI state (dark-mode preference, notification prefs, etc.) — matches how a real product tends to accumulate these fields.

**Chosen (Z1.7 landed): option (c) — Support-owned `SubjectAvatar` table.** Both (a) and (b) require a cross-repo change to the Shared Platform's schema. Support decided to defer that decision indefinitely and instead extend the Set B precedent (`AuthCredential`, `TeamMemberLifecycle`, `EndUserLifecycle` — Support owns UI/auth companion tables; wrapper stays identity-only) to avatars. Ships as `prisma/z1_7_migration.sql` + `src/lib/avatars.ts` + a `SubjectAvatar` model in `schema.prisma`, keyed by `subjectId` (unique across the two wrapper stores thanks to Z1.3's preserved-ids). If the Shared Platform later grows its own avatar/preferences surface (option a or b), `SubjectAvatar` backfills into it with one query keyed on `subjectId` — the boundary invariant stays intact.

**Ordering:** Z1.7 landed **last** in the Z1 chain — after Z1.5 (which dropped the legacy `users` table, making `users.avatarUrl` unreachable). Full sequence in §7.11.

### 7.11 Post-Z1.4b milestone sequence (authoritative)

The Z1.4b state-summary pass surfaced six code paths still on legacy `tx.user.*` / `tx.company.*` after admin CRUD migrates. Rather than one mega-milestone dropping every remaining reader at once (unreviewable, mixes auth-model rework with mechanical drops), the remaining work is split into three architecturally coherent milestones:

**Sequence:** `Z1.6 → Z1.8 → Z1.9 → Z1.5 → Z1.7`

| # | Milestone | Concern | Blocks |
|---|---|---|---|
| Z1.6 | Admin/Team CRUD → wrapper | Support-side identity management surface (invite, approve, deactivate, role change, bulk ops). Scope in §7.8 (revised). | Z1.8 (session lookups depend on the wrapper being wired to admin flows first) |
| Z1.8 | Session / auth / signup rework | Auth architecture. Session cookie shape, password hash storage, login/OTP/reset flows, signup uniqueness checks, cross-tenant tenant-health `groupBy`. Scope in §7.12. | Z1.9 (cleaner to migrate the inbound-email sender path after auth-model is settled) |
| Z1.9 | `findOrCreateSender` refactor | Inbound-email path that creates a legacy `User` for unknown senders. Small, focused, distinct code path. Scope in §7.13. | Z1.5 (last remaining legacy-user-creation site) |
| Z1.5 | Drop legacy tables + tighten CHECKs | Purely mechanical: `DROP TABLE users`, `DROP TABLE companies`, `DROP COLUMN` on legacy dual-FK columns, tighten CHECK constraints to §7.2's endpoint form, delete the transitional [src/lib/z1-dual-fk.ts](../src/lib/z1-dual-fk.ts) helper. | Z1.7 |
| Z1.7 | avatarUrl migration | Cross-repo work with Shared Platform (widen wrapper DTOs OR add `user_preferences` table). Scope in §7.10. | — |

**Why this sequencing (not one mega-PR):**

The six deferred legacy-touching code paths cluster into **three coherent architectural concerns**:

1. **Admin identity management** (admin.ts's Team CRUD) — Support-side workflow, invite/approve semantics, role guards. Cleanly wraps around the Shared Platform's `TeamMember`/`EndUser`/`Role` primitives once we do the mapping work. Owns **Z1.6**.
2. **Auth model** (auth.ts, profile.ts, super.ts, signup.ts) — session cookie shape, password-hash storage, cross-tenant admin tooling. Genuinely separate architectural concern that surfaced as a Z1 dependency but was never Z1's original intent. Requires design decisions about where post-Z1.5 auth data lives. Owns **Z1.8**.
3. **Inbound-email sender bootstrap** (findOrCreateSender in inbound-handler.ts) — creates a legacy `User` for unknown email senders. Different constraints from user-initiated signup (no live UI session, temp-password generation). Small enough to be its own milestone. Owns **Z1.9**.

Bundling all six into one PR would (a) break the per-PR reviewability property held across every prior Z1 phase, (b) conflate auth-model design with mechanical drops, (c) create session-cookie-change + table-drop coupling that invalidates every existing session at deploy time. Splitting them lets each concern get its own scoping pass, dry-run, and review.

**Why Z1.5 lands where it does (fourth, not last):**

Once Z1.6 + Z1.8 + Z1.9 have all migrated their writes to the wrapper, no code path creates or reads from `users`/`companies`. Z1.5 becomes a purely mechanical `DROP` — the smallest, most predictable phase in the Z1 chain, ironically. Z1.7 (avatarUrl) is fifth because it's cross-repo work with an external calendar signal (first user report), so it can float relative to the Z1.5 gate.

**Discipline reminder for Z1.8:** given Z1.8 bundles five files touching session-context code, its plan-review-implement-verify pass runs against a **staging tenant first**, not production tenant data. That's the extra safety concession for bundling auth reads/writes into a single milestone rather than splitting further. Cost of that extra safety: one dry-run pass; benefit: session-context refactor happens once, not three times.

### 7.12 Z1.8 scope: session / auth / signup rework

**Files in scope:**

- **[src/lib/auth.ts](../src/lib/auth.ts)** — session cookie decode, `getSessionUser`, `requireSession`. Migrates session-identity lookup from legacy `users` to wrapper.
- **[src/actions/auth.ts](../src/actions/auth.ts)** — `registerClient`, `login`, `verifyRegistrationOtp`, `sendPasswordReset`, `resetPassword`, `verifyLoginOtp`, `acceptInvite`, `changePassword`. All touch password-hash storage, session issuance, or OTP flows.
- **[src/actions/profile.ts](../src/actions/profile.ts)** — user's own-profile CRUD (name, avatar-upload path today, password change).
- **[src/actions/super.ts](../src/actions/super.ts)** — `listTenantsWithHealth` cross-tenant `tx.user.groupBy` + tenant provisioning `tx.user.create`.
- **[src/actions/signup.ts](../src/actions/signup.ts)** — `startTenantSignup` / `verifyTenantSignup`. Cross-tenant email-uniqueness checks + initial SUPER_ADMIN creation.

**Resolved decisions** (formerly "key design questions"):

Answered in [`docs/design/z1-8-auth-model.md`](design/z1-8-auth-model.md) and ratified as **[ADR-001](adrs/adr-001-z1-8-auth-model-set-b.md)** — chosen shape is Set B:

- **Q1 — `passwordHash`**: 1B — new Support-owned `auth_credentials` table with dual-FK to `end_users` / `team_members`.
- **Q2 — session cookie**: 2A — neutral `subjectId` + `subjectKind` field pair.
- **Q3 — lifecycle state**: 3B — new Support-owned lifecycle tables (`team_member_lifecycle`, `end_user_lifecycle`).

The three sit in one coherent architectural commitment: **wrapper stays identity-only; Support owns auth (credentials + lifecycle); session cookie is subject-neutral for HRMS/CRM extensibility.** Set A (widen wrapper for auth) and Set C (delegate to external IdP) were rejected in ADR-001's analysis — see the ADR for the coupling reasoning and HRMS/CRM implications.

**Deferred to §7.14 (M-auth-migration)**: the "is Support-side auth the permanent shape, or should Shared Platform grow an auth service?" question. Z1.8 ships Set B as an explicit intermediate state; §7.14 is the named milestone that revisits the question when its trigger fires.

**Extra safety (per Z1.8 rhythm):** Z1.8's dry-run runs against a **staging tenant**, not production tenant data. Staging fixture spec: [`docs/design/z1-8-staging-fixtures.md`](design/z1-8-staging-fixtures.md). Fresh throwaway per dry-run pass; idempotent seed script; tenant marker slug `_z18-staging-<timestamp>` for unmistakable distinguishability from production tenants.

### 7.13 Z1.9 scope: findOrCreateSender refactor

**File in scope:** [src/lib/email/inbound-handler.ts](../src/lib/email/inbound-handler.ts) `findOrCreateSender` function.

**Current behavior:** when an inbound email arrives from an unknown sender, this function creates a legacy `User` row with a random temp-password hash, `role: CLIENT`, `status: PENDING`. Post-Z1.5, this can't create a legacy `User` (the table's gone).

**Post-Z1.9 shape (to be finalized in Z1.9's own design pass):** create an `EndUser` via the wrapper's `createEndUser`, with `organizationId` auto-matched by email domain. Any password-hash / status concerns Z1.9 inherits from Z1.8's decisions (that's why Z1.9 lands after Z1.8, not alongside).

**Why not folded into Z1.8:** distinct code path (webhook trigger, no live UI session, temp-password generation). Different failure modes (email spam floods, unknown-tenant addresses, malformed sender headers). Small enough to review independently. Keeping it separate makes each PR's failure-mode analysis narrower.

### 7.14 Future ADR: M-auth-migration — Support-side auth vs Shared Platform auth service

**Filed after Z1.8's Set B decision** ([ADR-001](adrs/adr-001-z1-8-auth-model-set-b.md)) as the durable name for the deferred architectural question. Parallel in shape to §7.3 (tenant ownership migration) — a real named milestone that carries the "is this the permanent shape?" question until its trigger fires, rather than a footnote that gets forgotten.

**The question:** Set B ships Support-side `auth_credentials` + Support-side lifecycle tables. This is architecturally coherent for Z1.8 (near-zero cross-repo cost, HRMS/CRM friendly, high reversibility). But it commits Support to owning auth data indefinitely. Is that the right endpoint, or should Shared Platform eventually grow a proper auth service (SSO, credential management, session issuance) that all three apps (Support / HRMS / CRM) share?

**Neither answer is right today.** The question depends on:
- Whether HRMS's employee-auth story wants org-specific SSO (each customer's IdP), which points away from a shared auth service.
- Whether CRM even authenticates its contacts (many don't), which affects the sizing of any shared auth investment.
- Whether Shared Platform's team has bandwidth to design + own an auth service, which is a different investment than mirroring identity primitives.

**Triggers (any one starts the M-auth-migration design pass):**

1. **HRMS or CRM auth planning** — when either app reaches the "where does auth live?" question in its own roadmap. The answer will constrain Support's Z1.8 endpoint state.
2. **Shared Platform readiness** — when Shared Platform's team decides they want to grow an auth service, either because two of the three apps want it or because operational patterns (per-tenant SSO config, shared session invalidation, etc.) become worth centralizing.
3. **Support-side auth scaling** — if Support's `auth_credentials` table grows to the point where per-tenant partitioning, MFA support beyond a simple `mfaSecret` column, or SSO integration become substantial ongoing work. At that point centralizing may be cheaper than Support carrying it alone.

**How the three apps should evolve while M-auth-migration is pending:**

- **Support**: keeps `auth_credentials` + lifecycle tables. No proactive investment in generalizing them for other apps. Adds MFA / password policy features to its own tables as needed.
- **HRMS**: when it starts, it should ship its own auth model (whatever fits its SSO-first requirements) without trying to share Support's tables. If it converges on the same shape as Support's `auth_credentials`, that's evidence for M-auth-migration; if it diverges, that's evidence against.
- **CRM**: same as HRMS — its own auth model (or no auth at all if contacts don't authenticate).
- **Shared Platform**: no auth-service design work until at least one of the triggers above fires. Wrapper stays identity-only.

**What M-auth-migration does not commit to:** it doesn't pre-commit to "yes, we'll consolidate." The milestone is the design pass, not the outcome. Set B may turn out to be the permanent shape — that's a valid outcome. The point is having a named place where the question gets revisited on real evidence rather than architectural anxiety.

**Ordering:** unblocked, unscheduled. No dependency on Z1.5, Z1.7, or anything currently on the roadmap. Sits on the same shelf as §7.3.

### 7.15 Z1.8a session cookie grace-period removal

**Filed as a durable item during Z1.8a implementation** so the follow-up commit that removes the old-shape decode branch from `getSessionUser` can't be forgotten.

**Context.** Z1.8a's session cookie change (new-shape `{subjectId, subjectKind, tenantId}` replacing the pre-Z1.8 `{userId, tenantId}`) ships with a **7-day grace-period decode** in `src/lib/session.ts`'s `verifySessionToken` so existing sessions keep working after deploy — otherwise every active user would get logged out simultaneously. Analysis in [`docs/design/z1-8-implementation-plan.md`](design/z1-8-implementation-plan.md) Decision A.

**Removal target.** Day 7 after Z1.8a deploys. One-file follow-up commit removes:
- The `if (typeof payload.userId === "string") { ... }` old-shape branch in `verifySessionToken`.
- Its associated comment tagging the removal date.
- The imports that only the old-shape branch used, if any.

Expected size: ~15 lines removed.

**Day-7 contingency.** If day-7 log-scan shows non-trivial old-shape cookies still in circulation (rare — session TTL is 7 days, so any pre-Z1.8a cookie should have naturally expired by then), extend the grace period by another 7 days before removing the branch. Re-tag the comment with the new removal date. This is a real branch of the plan, not a hypothetical — capturing it here so the choice is deliberate and not implicit.

**How to check readiness on day 7.**

1. Grep server logs for any session verification that fell through the new-shape branch and matched the old-shape branch. If the logs don't already tag this (they don't as of Z1.8a-1), add a `logger.debug("z1_8a old-shape session decode", { tenantId })` line to the old-shape branch before deploy, so day-7 logs have a signal to grep.
2. If old-shape decodes are <1% of all session decodes over the last 24h: proceed with removal.
3. If old-shape decodes are >1%: extend contingency, re-file removal for day 14.

**Post-removal.** Delete this §7.15 entry from the boundary doc in the same follow-up commit. The item's job is done.

### 7.16 Purpose-claim casing inconsistency: `analytics_share` uses underscore

**Filed during B3 (core-auth tokens.ts port)** to make the inconsistency deliberate rather than an accident of history.

**What.** Every JWT this codebase mints carries a `purpose` claim. Nine of the ten values use kebab-case (`session`, `password-reset`, `email-change`, `data-export`, `invite`, `otp-verify`, `tenant-signup`, `csat`, plus the coming `impersonation`). One — `analytics_share` — uses snake_case. See `src/lib/session.ts:540` for the wire-format origin (M13 gap 2 read-only share tokens) and `src/core/auth/types.ts::TokenPurpose` for the union that mirrors it.

**Why preserved.** `analytics_share` links are signed with a 30-day TTL and land in customer inboxes as clickable URLs. Renaming the claim from `analytics_share` to `analytics-share` would silently invalidate every share link already delivered — the verifier's `purpose !== "analytics-share"` check would reject the old claim value. Normalising is a token-rotation exercise (issue-a-warning-then-swap-then-drop the old claim), not a types change.

**Not doing now.** No rotation exercise scheduled. Cosmetic inconsistency accepted.

**When to revisit.** If any future work touches share-link issuance for another reason (e.g., adding revocation state, scoping share tokens to a specific viewer email), fold the rename into that same rotation. Until then, `analytics_share` stays.

**Post-normalisation.** Delete this §7.16 entry. Its job is done.

### 7.17 Impersonation-verify grace period (B6.1)

**Filed during B6.1 (session.ts → core migration)** to make the impersonation-claim rotation window deliberate and time-bounded.

**What.** B6.1 replaces Support's internal `signImpersonationToken` (never set a `purpose` claim) with `signPurposeToken("impersonation", …)` from core (always sets the claim). The verifier in `getImpersonationPayload` is temporarily loosened via a Support-local `verifyImpersonationTokenGrace` wrapper that accepts **both** `purpose === undefined` (legacy tokens still in flight) **and** `purpose === "impersonation"` (post-B6.1 tokens). Alg allow-list (`["HS256"]`) and every other verify check remains strict.

**Why grace, not straight swap.** Impersonation TTL is 1 hour. A straight swap would immediately invalidate every legacy impersonation cookie at deploy time — a Super Admin mid-way through investigating a live P0 ticket would get silently kicked out. Grace-period pattern mirrors §7.15's Z1.8a session-cookie dual-shape decode: a pattern the codebase already understands.

**Removal target.** **Deploy timestamp + 24 hours** (24× the 1-hour token TTL, no in-flight legacy tokens possible). One-file follow-up commit tightens the wrapper to `purpose === "impersonation"` only, and — for symmetry with the B3 verifier surface — the follow-up can just delete `verifyImpersonationTokenGrace` and call `verifyPurposeToken(t, "impersonation")` from core directly.

Expected follow-up commit size: ~5 lines removed. Same size-and-shape as the §7.15 removal.

**Day-1 contingency.** If deploy is rolled back (any reason) inside the 24-hour window, reset the removal clock to the redeploy timestamp + 24 hours.

**Post-removal.** Delete this §7.17 entry from the boundary doc in the same follow-up commit.

### 7.18 Test-infrastructure helper: withAppPrisma (B4 follow-up)

**Filed during B4** ([adapter.ts](../src/core/auth/adapter.ts) tests) to make the flag durable rather than let it slip.

**What.** The live-Postgres round-trip tests in B4 (and the QA Phase 2/3 scripts) all duplicate the same setup pattern:

```ts
const url = process.env.APP_DIRECT_URL || process.env.APP_DATABASE_URL;
const p = new PrismaClient({ datasources: { db: { url } } });
try {
  // …test work…
} finally {
  await p.$disconnect();
}
```

Four files today: `scripts/qa_phase2_behavior.mjs`, `scripts/qa_phase2_probes.mjs`, `scripts/qa_phase3_integration.mjs`, `src/core/auth/adapter.test.ts`. Each will grow more callsites as the core/ migration proceeds.

**Not doing now.** Extracting to `src/test-utils/withAppPrisma.ts` is straightforward but sits outside every current chunk's scope (Z-post/core-auth). Doing it inline in one of those chunks would muddle the diff.

**When to revisit.** After M7's cross-repo integration testing needs stabilise — the helper's shape should be informed by whether Support's platform side wants to consume it (via workspace-relative import) or write its own. Speculative extraction now would likely need to be redone.

**Post-extraction.** Delete this §7.18 entry.
