# Z1.8 implementation plan

**Status:** Proposed. Awaiting owner review before migration code is written.

**Related:**
- [ADR-001](../adrs/adr-001-z1-8-auth-model-set-b.md) — ratified architecture (Set B)
- [`docs/design/z1-8-auth-model.md`](z1-8-auth-model.md) — original option matrix
- [`docs/design/z1-8-staging-fixtures.md`](z1-8-staging-fixtures.md) — staging tenant fixture spec
- Boundary doc [`§7.11`](../shared-platform-boundary.md), [`§7.12`](../shared-platform-boundary.md), [`§7.14`](../shared-platform-boundary.md)

---

## Scope recap

Z1.8 implements Set B (per ADR-001): three new Support-owned tables (`auth_credentials`, `team_member_lifecycle`, `end_user_lifecycle`), a new session cookie shape (`subjectId` + `subjectKind`), and code migration across five files (`src/lib/auth.ts`, `src/actions/auth.ts`, `src/actions/profile.ts`, `src/actions/super.ts`, `src/actions/signup.ts`).

Not in scope: legacy table drop (Z1.5). Set B is designed to coexist with legacy `users` throughout Z1.8 via dual-write — legacy stays authoritative until Z1.5 removes it.

---

## Decision C — split into Z1.8a and Z1.8b

**Recommendation: split.** Explicit justification below.

### The concern graph

Ten distinct sub-concerns touched by the five files:

1. Schema for the three new tables (+ backfill from legacy `users`).
2. Session cookie shape change (`{ userId }` → `{ subjectId, subjectKind }`) — foundational for everything else.
3. `login` flow reads password from `auth_credentials` and lifecycle status from lifecycle tables.
4. Password reset (`sendPasswordReset` + `resetPassword`) writes to `auth_credentials`.
5. Invite-accept (`acceptInvite`) writes to `auth_credentials` + lifecycle.
6. Registration (`registerClient` + `verifyRegistrationOtp`) writes to `auth_credentials` + lifecycle.
7. Profile CRUD (`profile.ts`) — password change + name/avatar updates.
8. Tenant provisioning (`super.ts` `createTenant`, `signup.ts` `verifyTenantSignup`) creates first SUPER_ADMIN with credentials + lifecycle.
9. Cross-tenant admin queries (`super.ts` `listTenantsWithHealth`).
10. Admin CRUD lifecycle-write migration (`admin.ts` `approveUser`, `rejectUser`, `resendInvite`, `revokeInvite`, `reinviteUser`, `bulkDeactivate`) — currently writes `users.status` + timestamps; moves to lifecycle tables.

### The cut

**Z1.8a — Foundation** (schema + session cookie + admin lifecycle writes + profile.ts):

Includes concerns 1, 2, 7, 9, 10.

- New Prisma migrations for the three tables + backfill.
- Session cookie shape change with grace-period decode (see decision A below).
- `admin.ts`'s six lifecycle-writing functions move to lifecycle tables (dual-write with legacy `users.status` for safety net).
- `profile.ts` updates (password change routes through `auth_credentials`; name/avatar updates unchanged since Z1.6 already touched name reads via wrapper).
- `listTenantsWithHealth` staging-tenant filter (per adjustment item 1 in your last message).

Z1.8a is deployable independently. It's additive (schema + dual-write); reverting is code-only.

**Z1.8b — Auth flows** (login + registration + password reset + invite accept + tenant provisioning):

Includes concerns 3, 4, 5, 6, 8.

- `login` reads password from `auth_credentials`, status from lifecycle table, identity from wrapper.
- Registration flows write credentials + lifecycle rows on user creation.
- Password reset writes to `auth_credentials`.
- Invite-accept writes to `auth_credentials` + lifecycle transition.
- `super.ts` `createTenant` + `signup.ts` `verifyTenantSignup` populate credentials + lifecycle for the initial SUPER_ADMIN.

Z1.8b depends on Z1.8a being deployed (needs the tables + session cookie shape). Reverting is code-only; legacy `users.passwordHash` stays authoritative until Z1.5.

### Why this cut, not others

- **The natural join is "does this change touch auth flows?"** Z1.8a is "everything that isn't login/register/reset/invite/provisioning." Z1.8b is the auth flows themselves. Each PR reviews cleanly as a coherent concern.
- **Z1.8a is lower risk** — no code path that decides whether someone can log in changes. Reviewers can focus on the schema + session cookie migration without also weighing auth-flow correctness.
- **Z1.8b is higher risk** but lands on a stable foundation. The reviewer for Z1.8b already knows the schema is correct (verified in Z1.8a).
- **Rejected alternative — three-way split** (Z1.8a schema-only, Z1.8b session cookie, Z1.8c auth flows): overkill. Session cookie migration is inseparable from admin.ts lifecycle writes because both use `session.subjectId` — splitting them means every server action that reads `session.id` changes in Z1.8a but only fires against the new cookie shape starting in Z1.8b, creating a "code changed but not exercised yet" gap.
- **Rejected alternative — single PR**: 10 sub-concerns, security-critical semantics, five files with substantial changes. Violates the reviewability discipline held throughout Z1.

---

## Decision D — schema-first migration ordering

**Recommendation: schema-first**, matching Z1.1b / Z1.4a pattern.

### Order of operations

1. **Prisma schema migration** creates three tables with indexes:
   - `auth_credentials` — `id`, `subjectEndUserId?`, `subjectTeamMemberId?`, `passwordHash`, `passwordChangedAt?`, `mfaSecret?`, `tenantId`, `createdAt`, `updatedAt`. Dual-FK CHECK: `num_nonnulls(subjectEndUserId, subjectTeamMemberId) = 1`. Indexed on `(tenantId, subjectEndUserId)` and `(tenantId, subjectTeamMemberId)`.
   - `team_member_lifecycle` — `subjectId` PK (matches `TeamMember.id`), `status`, `invitedAt?`, `invitedById?`, `approvedAt?`, `approvedById?`, `rejectedAt?`, `rejectedById?`, `lastActiveAt?`, `tenantId`, `createdAt`, `updatedAt`. Indexed on `(tenantId, status)`.
   - `end_user_lifecycle` — same shape as `team_member_lifecycle` but for `EndUser.id`. Same indexes.
2. **Backfill (SQL script, applied idempotently)**:
   - For every row in `users` where `role != CLIENT`: insert into `team_member_lifecycle` (subjectId = user.id, copy all lifecycle fields, tenantId = user.tenantId).
   - For every row in `users` where `role = CLIENT`: insert into `end_user_lifecycle`.
   - For every row in `users`: insert into `auth_credentials` (subjectEndUserId or subjectTeamMemberId per role, passwordHash = user.passwordHash, passwordChangedAt = user.passwordChangedAt, tenantId = user.tenantId).
3. **Verify backfill**: row counts match; every legacy user has exactly one credential row + one lifecycle row; no orphans in either direction.
4. **Deploy Z1.8a code**: dual-write both stores from every relevant server action.
5. **Deploy Z1.8b code**: reads flip from legacy to new stores.
6. **Legacy stays authoritative until Z1.5.** Dual-write invariant is the safety net through the full transition.

No reason to go code-first for any of the three tables. Same reasoning that held for every prior additive-schema pass in Z1.

---

## Decision A — session invalidation UX: grace period

**Recommendation: grace period (7 days).**

### Analysis

Hard cutover shape:
- JWT payload changes from `{ userId, tenantId, ... }` to `{ subjectId, subjectKind, tenantId, ... }`. At deploy, every existing session cookie fails to decode. All users log out simultaneously.
- Implementation surface: minimal (~5 lines — new payload shape, new decode function).
- User visibility: high. Every active user sees a forced logout within seconds of deploy. Generates a spike of "why did I get logged out?" support load. Concentrated risk.

Grace-period shape:
- JWT decode accepts both payload shapes for 7 days after deploy.
- Old-shape (`{ userId }`) decode path: look up the user via `getTeamMember(userId)` first, fall back to `getEndUser(userId)`. Preserved-ids from Z1.3 guarantee 1:1 resolution. Returns a `session` object with `subjectId = userId` + inferred `subjectKind`.
- New-shape (`{ subjectId, subjectKind }`) decode path: branches on `subjectKind`, queries wrapper directly.
- After 7 days: old-shape decode path removed. Users who haven't refreshed their session in 7 days log out on next request.
- Implementation surface: ~20 lines of extra decode logic. Well-scoped, easy to remove at the 7-day mark.

### Cost/benefit

Grace period adds a small, well-scoped surface to `getSessionUser` — 20 lines of extra decode logic that gets removed in a 5-line follow-up commit at day 7. In exchange, session load stays even, no visible logout event, no support-ticket spike. The complexity cost is genuinely small; hard cutover's operational cost is small-but-concentrated. Grace period wins on the tradeoff.

### One caveat

If any auth-adjacent security decision depends on "old-shape sessions are guaranteed to be gone by day N," grace period is wrong. Nothing in Z1.8's scope has that dependency — the two shapes carry identical security guarantees (both reference the same underlying subject, via preserved id). No security regression from allowing both to decode during the grace period.

### Implementation of grace period

- New payload shape ships in Z1.8a alongside the session-decode migration.
- Every login/OTP-verify/invite-accept path that issues a new JWT issues new-shape.
- Old-shape decode path is a fallback branch in `getSessionUser`, tagged with a comment naming the removal date (deploy date + 7 days).
- A separate small follow-up commit removes the fallback branch on day 8. Filed as a pending item in the boundary doc so it can't be forgotten.

---

## Decision B — rollback plan

**"Reversible in principle" from ADR-001 turned into "reversible in practice at 2am."** Failure modes and specific recovery steps for each of the five dry-run steps:

### Step 1: Seed staging tenant

**Failure modes:**
- Seed script bug (missing field, wrong shape).
- Wrapper `createEndUser`/`createTeamMember` fails (RLS misconfig, unique constraint).
- DB error mid-seed (partial state).

**Recovery:**
- Run `--teardown <partial-tenant-id>`. Cascades all rows including the audit-log marker.
- Fix bug, re-run `--seed`. Fresh tenant with new timestamped slug.
- Zero production impact — staging tenant is isolated by design.

### Step 2: Migration runs against staging (dry-run apply mode)

**Failure modes:**
- Some users have credentials rows, others don't (partial backfill).
- Some lifecycle rows written with wrong `subjectId` shape.
- New session cookies issued during test can't be decoded.

**Recovery:**
- Staging is throwaway. `--teardown` cleans everything.
- Fix migration logic, re-seed, re-run. No production impact.

### Step 3: Post-migration verification against staging

**Failure modes:**
- Row counts don't match projection (e.g., 7 users but only 6 credentials rows).
- Login flow for user #1 (SUPER_ADMIN with known password) fails.
- Expired OTP for user #7 rejects with wrong error message.

**Recovery:**
- Same as step 2 — staging is throwaway. Log the failure, tear down, fix, re-run.

### Step 4: Localhost verification against real `stralis` tenant

**This is where "reversible at 2am" starts mattering.**

**Failure modes:**
- Partial migration: some `stralis` users have new tables populated, others don't.
- Session cookies issued during test don't decode.
- Login flow for a real user fails.
- Team page renders wrong data because lifecycle-table join isn't wired right.

**Recovery — dual-write invariant is the safety net:**

1. **If schema is stable + backfill complete but code has bugs**: revert the deploy (`git revert` the Z1.8a or Z1.8b commit, redeploy). Legacy `users.passwordHash` + `users.status` still authoritative — reverted code reads legacy, everything continues to work. New tables exist but nobody reads them. Debug at leisure.
2. **If schema migration itself failed mid-flight**: the backfill script is idempotent (uses `ON CONFLICT DO NOTHING`), so re-running finishes the migration. Verify with the drift-check script (adapted from `scripts/z1_6_drift_check.mjs`) that every legacy user has a matching credentials + lifecycle row. If drift persists, the drift-check script reports specific missing rows — patch them manually, then verify clean.
3. **If session cookies are broken for existing users**: grace-period decode should keep old cookies working. If both shapes fail to decode, the decode bug is in the new-shape path — revert Z1.8a's `getSessionUser` change, redeploy, users' old cookies decode cleanly via the un-migrated legacy path.

**Concrete revert sequence at 2am:**

```
# 1. Identify which PR is failing (Z1.8a or Z1.8b).
# 2. Revert the deploy — git revert + push, or trigger a rollback on Vercel.
git revert <z1.8a-or-z1.8b-commit>
git push origin master
# 3. Verify legacy paths are handling requests correctly.
#    (Check server logs for successful auth; check drift-check reports clean.)
# 4. New tables (auth_credentials, lifecycle) can stay populated — they're
#    harmless when nobody reads them. Don't try to clean them at 2am.
# 5. Debug the failure in daylight. Re-deploy when fixed.
```

### Step 5: Production migration (both real tenants)

**Failure modes:**
- Same as step 4, but affecting `Acme Corp` in addition to `stralis`.

**Recovery:**
- Same three-tier recovery as step 4. Dual-write invariant + code revert is the pattern.
- One additional concern: if the migration is applied to `Acme Corp` and the rollback happens after Acme's admin has logged in with new-shape session cookies, those cookies will decode via grace-period fallback (old-shape path becomes new-shape at decode time). No re-login required.

### What rollback deliberately does not require

- Reverse-migrating data from new tables back to legacy `users`. Not needed — legacy is still authoritative through Z1.5.
- Dropping the new tables. Harmless empty state; can stay.
- Rolling back the schema migration. Additive — safe to keep.

The invariant that makes this rollback plan work: **legacy `users` remains the read-authoritative source through Z1.5, regardless of what Z1.8 has done to the new tables.** Every rollback is "code revert + verify legacy paths handle traffic."

---

## E — the two Step 3 inputs

### Input 1: session invalidation strategy

Captured in decision A above (grace period, 7 days). Decision is here, in a durable place. Won't get silently defaulted at implementation time.

### Input 2: listTenantsWithHealth staging-tenant filter

Per your directive: filter in the dashboard, not "teardown before viewing." Concrete task:

- `super.ts` `listTenantsWithHealth` gets a `WHERE tenant.slug NOT LIKE '_z18-staging-%'` filter added to the tenant query.
- Filter is permanent (not conditional on env). Staging tenants are never useful in the SUPER_ADMIN health dashboard — they'd just clutter it.
- Scoped as a Z1.8a task, land alongside the schema migration + session cookie shape change.
- One-line change; low review surface. Included in Z1.8a's diff for completeness.

Same principle as CHECK constraints and last-Super-Admin guards throughout Z1: safety in code, not in operational discipline.

---

## Z1.8a file-by-file breakdown

### Prisma schema + migration SQL

- New models: `AuthCredential`, `TeamMemberLifecycle`, `EndUserLifecycle`.
- Corresponding `prisma/z1_8a_migration.sql` file: CREATE TABLE + CHECK constraints + indexes + backfill from legacy `users`. Applied via `npx prisma db execute` per boundary doc §3 rule 8 (same pattern as z1_1b_migration.sql and z1_4a_migration.sql).
- Backfill projected row counts (based on current DB state): 19 credentials rows, 8 end_user_lifecycle rows, 11 team_member_lifecycle rows.

### `src/lib/auth.ts` (session decode)

- New payload shape emitted by JWT issuance: `{ subjectId, subjectKind, tenantId, isImpersonating?, impersonatorSubjectId? }`.
- `getSessionUser` gains a two-branch decode:
  - New-shape branch: use `subjectKind` to pick `getEndUser` or `getTeamMember` via wrapper.
  - Old-shape branch (grace period): resolve `userId` → subject kind via wrapper dual-lookup (preserved id from Z1.3). Returns synthesized `session` with `subjectId = userId` + inferred `subjectKind`.
- `session.id` renamed to `session.subjectId` on the returned object shape.
- Every consumer (~40+ call sites) updates. Mostly a mechanical rename.

### `src/actions/admin.ts` (lifecycle writes migrate)

- Six functions dual-write to lifecycle tables:
  - `approveUser`: `team_member_lifecycle` (or `end_user_lifecycle` per role) status → ACTIVE + `approvedAt`, `approvedById`.
  - `rejectUser`: status → REJECTED + `rejectedAt`, `rejectedById`.
  - `resendInvite`: update `invitedAt` timestamp on lifecycle row.
  - `revokeInvite`: delete legacy user + wrapper counterpart + lifecycle row.
  - `reinviteUser`: status → INVITED + `invitedAt`.
  - `bulkDeactivate`: status → SUSPENDED per user.
- Legacy `users.status` writes stay in place (dual-write invariant).
- Reads still come from legacy `users` via the Z1.6 merged-read pattern — Z1.8b flips reads to lifecycle table.

### `src/actions/profile.ts`

- `changePassword`: writes to `auth_credentials` (dual-write with legacy `users.passwordHash`).
- Name/avatar updates unchanged (Z1.6 already handled).

### `src/actions/super.ts`

- `listTenantsWithHealth`: adds `WHERE slug NOT LIKE '_z18-staging-%'` filter.
- `createTenant`: legacy `users.create` unchanged in Z1.8a; wrapper create already happens via Z1.6's `createWrapperCounterpart`. Z1.8b adds credentials + lifecycle writes.

### Staging tenant seed script

- `scripts/z1_8_staging_tenant.mjs` per fixtures spec.
- Ships in Z1.8a because dry-run driver depends on it.

---

## Z1.8b file-by-file breakdown

### `src/actions/auth.ts`

- `login`: reads password from `auth_credentials`, status from lifecycle table (not legacy `users`).
- `registerClient`: writes credentials + lifecycle on user creation. Legacy `users` still populated (dual-write).
- `verifyRegistrationOtp`: status transitions (UNVERIFIED → PENDING/ACTIVE) write to lifecycle table.
- `sendPasswordReset`: reads `email` from wrapper via `matchEndUserByEmail` / `matchTeamMemberByEmail`.
- `resetPassword`: writes to `auth_credentials`.
- `acceptInvite`: writes password to `auth_credentials`, lifecycle status → ACTIVE.
- `verifyLoginOtp`: reads OTP from `login_otps` (unchanged; already dual-FK migrated in Z1.4a). Emits session with new-shape cookie.
- `changePassword`: same as `profile.ts`'s equivalent.

### `src/actions/super.ts`

- `createTenant`: adds `auth_credentials` + `team_member_lifecycle` writes for the initial SUPER_ADMIN.

### `src/actions/signup.ts`

- `verifyTenantSignup`: same shape as `createTenant`. Writes credentials + lifecycle for the initial SUPER_ADMIN.

### Session invalidation grace-period cleanup

- Post-Z1.8b deploy + 7 days: small follow-up commit removes the old-shape decode branch from `getSessionUser`. Tracked as a boundary-doc open item.

---

## Dry-run driver contract

- `scripts/z1_8_migrate.mjs` — the migration driver, distinct from the staging seed script.
- Modes:
  - `--tenant-id <id>` — apply migration only to the named tenant's rows. Used against staging tenant during dry-run.
  - `--all-tenants` — apply migration to every tenant. Used for production migration.
  - `--verify <tenant-id>` — read-only check that credentials + lifecycle rows exist for every user in the tenant.
- Idempotent: `ON CONFLICT DO NOTHING` on inserts. Safe to re-run.
- Guardrails: `--all-tenants` requires an interactive confirmation prompt (won't run from CI/automated context without explicit flag).

---

## Concrete PR-by-PR ordering

### PR #29 — Z1.8a Foundation

1. Prisma schema migration + backfill SQL.
2. Staging tenant seed script (`scripts/z1_8_staging_tenant.mjs`).
3. Session cookie shape change with grace-period decode in `getSessionUser`.
4. Every `session.id` → `session.subjectId` rename across the codebase (~40+ sites).
5. `admin.ts` lifecycle writes dual-write to lifecycle tables.
6. `profile.ts` `changePassword` dual-writes to `auth_credentials`.
7. `super.ts` `listTenantsWithHealth` staging-tenant filter.
8. Dry-run against staging (all steps 1-3 from fixtures spec).
9. Localhost verification against `stralis`.
10. Deploy to production tenants.

Verify DoD: drift-check reports clean; every legacy user has matching credentials + lifecycle rows; session decode works for old-shape and new-shape cookies; team page + admin flows work unchanged.

### PR #30 — Z1.8b Auth flows

1. `auth.ts` login/register/reset/invite-accept flows read from + write to new tables.
2. `super.ts` `createTenant` + `signup.ts` `verifyTenantSignup` write to new tables on first SUPER_ADMIN creation.
3. Dry-run against staging.
4. Localhost verification against `stralis` (log in as real user, register a test user, run through full auth flow end-to-end).
5. Deploy to production tenants.

Verify DoD: login/register/reset flows work end-to-end reading from new tables; legacy `users.passwordHash` + `users.status` remain populated (safety net); no session decode regressions.

### Follow-up commit — grace-period removal

7 days after Z1.8a lands: small commit removes old-shape decode branch. One-file change, easy review.

---

## Deferred to Z1.5 (not Z1.8)

- Dropping legacy `users.passwordHash` column.
- Dropping legacy `users.status` + lifecycle timestamp columns.
- Dropping legacy `users` table entirely.
- Removing the dual-write logic from admin.ts, profile.ts, auth.ts, super.ts, signup.ts.

Z1.8 leaves all dual-write in place. Z1.5 is the "delete the transitional bridge code" milestone.

---

## Open items deliberately not answered in this plan

- **Real backfill projection numbers vs. actuals during dry-run**: filled in when the migration runs against staging. Same discipline as Z1.3 and Z1.4a.
- **Grace-period exact removal date**: TBD when Z1.8a deploys. Committed to be tracked in a boundary-doc pending item.
- **HRMS/CRM auth planning inputs**: deferred to M-auth-migration (boundary §7.14). Doesn't gate Z1.8.
- **Rollback data-cleanup**: if we ever want to drop the new tables during a rollback (rather than leaving them populated but unread), that's a separate follow-up. Not needed for the "at 2am" recovery path.

---

## Ready for review

Waiting on owner sign-off on:
- The Z1.8a / Z1.8b split (decision C)
- The grace-period approach for session invalidation (decision A)
- The rollback plan structure (decision B) — specifically the "code revert + verify legacy handles traffic" default recovery
- Schema-first migration ordering (decision D — mechanical carryover from Z1 pattern)

Once approved, Z1.8a implementation starts: schema migration first, then staging seed script, then code migration.
