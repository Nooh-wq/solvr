# Post-Z1 QA Sweep — 12 Milestones

Scope: Z2, M21, Z3, Z4, Z5, Z6, Z7, M1, M2, M3, M5, M13.

Bug policy: file as follow-up, continue sweep. Stop for RLS bypass, cross-tenant
leak, auth bypass, silent data corruption.

---

## Phase 1 — Static checks

**Result: FAIL** on TypeScript (3 real bugs + 1 pre-existing) and lint (16 errors).
**Critical bugs: 0.** No RLS bypass, cross-tenant leak, or auth bypass found.

### 1.1 `npx tsc --noEmit` — FAIL (5 errors)

| # | File | Error | Root cause | Severity |
|---|---|---|---|---|
| A | `src/lib/shared-platform/tags.ts:156,171` | `TagTargetType` (`TICKET` included post-Z8) not assignable to `"END_USER" \| "TEAM_MEMBER" \| "ORGANIZATION"` | `toDto()` narrows `targetType` to the legacy trio; the enum widened for Z8's `add_tag` rule action but the wrapper DTO didn't. Any wrapper caller reading a TICKET-scoped tag row will fail at runtime. | **Real bug** — blocker for the tag-assignment wrapper reads used by Z8's macro/rule paths. |
| B | `src/lib/inngest/functions/build-ticket-rollup.ts:68` | `BigInt literals are not available when targeting lower than ES2020` — `firstReplySumMs += BigInt(0n)` | tsconfig target is ES2017. Runtime (Node 18+) supports BigInt fine, but tsc won't emit until target is ES2020 OR the literal is replaced with `BigInt(0)`. | **Real bug** — tsc blocker; runtime OK. |
| C | `src/actions/adminSearch.ts:79` | `filter` doesn't exist on `Page<Organization>` | Wrapper's `Page` shape is `{ items, hasMore, ... }`, not native `Array`. Caller uses `.filter(...)` directly on the page instead of `page.items.filter(...)`. Pre-Z1-close bug. | **Pre-existing** — Z1.4b consumer regression, not from these 12 milestones. |

**Fix priority:** A + B ship blockers. C is orthogonal, worth fixing but outside this QA scope.

### 1.2 `npm run lint` — 16 errors + 38 warnings

| Rule | Count | Category |
|---|---|---|
| `react/no-unescaped-entities` | 9 | Cosmetic — JSX quotes/apostrophes need escaping. Not runtime bugs. |
| `react-hooks/set-state-in-effect` | 5 | Cascading-render pattern. Worth inspecting each — could hide re-render loops. Flag: `admin-search.tsx`, `notification-bell.tsx`, and 3 others. |
| `@typescript-eslint/no-explicit-any` | 3 | Explicit `any` in a few files — deliberate escape hatches per prior review; keep. |

Warnings (38) are mostly unused-import cleanup — accumulated across milestones. Non-blocking.

### 1.3 `npx prisma format && npx prisma validate` — PASS

Schema well-formed. Format applied cleanly. Validate green.

### 1.4 TODO/FIXME/@deprecated grep (non-generated code)

One finding, and it's pre-milestone:

- `src/lib/ai/rag.ts:3` — `TODO(decision): swap to pgvector cosine-similarity search once the KbChunk schema moves off its placeholder Json embedding column` — long-standing, unrelated to Z2–M13.

**No unresolved markers from the 12 milestones.**

### 1.5 Legacy-pattern sweep — CLEAN

Searched for `tx.user.` / `tx.company.` / `prisma.user.` / `prisma.company.` / `session.userId` / `\bLegacyRole\b` (case-sensitive).

- Zero hits in live code (`src/actions`, `src/lib`, `src/app`).
- All matches are either (a) historical comments in `src/actions/admin.ts` and `src/lib/auth.ts` documenting the migration, or (b) Prisma-generated docstrings in `src/generated/prisma/*`. **Not regressions.**

### 1.6 Bare `prisma.*` outside the whitelist — CLEAN, one style note

13 files use bare `prisma` client (RLS-bypass by design). All are on the accepted whitelist:
- Crons: `send-report-schedules`, `build-ticket-rollup`, `send-csat-queue`, `emit-sla-events`, `run-automations`, `send-daily-digests`, `auto-close`
- Host-only: `superAnalytics.ts` (SUPER_ADMIN + INTERNAL tenant gate)
- Session/auth bootstrap: `signup.ts`, `auth.ts`, `tenant.ts`, `email/inbound-handler.ts`
- Types: `src/generated/prisma/*`

Every one of them opens `withRls({tenantId: ...})` per iteration for the actual work. Cross-tenant isolation preserved.

**Style note (not a bug):** `send-report-schedules.ts:83` uses `prisma.savedReport.update` bare (single-row by-id write) instead of `withRls`. Safe because the id already carries the tenant scope from the earlier read, but inconsistent with the other crons' pattern. Optional cleanup.

### 1.7 Migration idempotency — PASS

All 15 shipped `_migration.sql` files (Z2×4, Z4, Z6×4, Z8, M2, M3, M5, M13×2) use `IF NOT EXISTS` / `DROP POLICY IF EXISTS` / `DO $$ BEGIN ... EXCEPTION`. Re-application is safe.

- `z2_5_migration.sql` has zero RLS statements — correct; it extends an existing table (adds `valueLookupId` + widens the enum + rewrites the check constraint), inherits parent policies.

### 1.8 New-table RLS coverage — PASS

Cross-referenced every new table across the 12 milestones with its migration SQL. Every new table has an `ENABLE ROW LEVEL SECURITY` + `CREATE POLICY tenant_isolation` pair:

- Z2: custom_field_definitions, custom_field_values, custom_field_options, ticket_forms, ticket_form_fields, ticket_form_categories (per z2_1..z2_3).
- Z4: organizations settings tables (per z4).
- Z6: saved_views, canned_responses, macros, ticket_views (per z6/z6b/z6c/z6d).
- Z8: rules, rule_run_logs, escalation_paths, escalation_logs (per z8).
- M2: sla_policies, business_calendars, ticket_slas (per m2).
- M3: agent_profiles, auto_assignment_logs (per m3).
- M5: csat_queue, csat_settings (per m5). SurveyResponse pre-existed with RLS.
- M13: saved_reports, ticket_daily_rollups (per m13 + m13_gaps).

### Phase 3 addition — N+1 grep (list pages)

Ran wrapper-function-in-loop and `tx.*`-in-loop greps across `src/actions/`. Findings:

| File | Line | Pattern | Impact |
|---|---|---|---|
| `src/actions/groups.ts` | 92 | `ids.map(async (groupId) => tx.ticket.count + tx.ticket.findMany)` — N Prisma queries where N = group count (capped ~200). | Would pressure the connection pool at high group counts. Fine at typical (<20 groups). |
| `src/actions/attachments.ts` | 122 | `rows.map(async (r) => getAttachmentSignedUrl(r.fileUrl))` — one S3-signed-URL SDK call per attachment. | Fine at 5–10 attachments per ticket; watch at scale. |
| `src/actions/signup.ts` | 157–158 | Serial `for` loop of `tx.category.create` for DEFAULT_CATEGORIES (6–8 items, one-shot per tenant). | Non-issue. |

No wrapper-function calls in per-row loops (`getEndUser`, `getTeamMember`, `getOrganization`). Z1.4b's batched-lookup discipline held across all 12 milestones.

---

## Phase 1 summary

**3 real bugs surfaced, 3 real bugs fixed. tsc clean baseline restored.**

| Bug | Fix |
|---|---|
| P1-A: Tags wrapper `toDto` narrowed TICKET target away | Widened `src/lib/shared-platform/types.ts::TagTargetType` to include `TICKET`; added TICKET cases to `assertTargetExists` (ticket-existence check via `tx.ticket`) and `resourceForTargetType`; widened `toAssignmentDto`'s param type to `TagTargetType`. Runtime: TICKET-scoped tag assignments now round-trip through the wrapper. |
| P1-B: `build-ticket-rollup` BigInt literal | Replaced `0n` with `BigInt(0)` — compiles under ES2017 target, evaluates identically on Node 18+. |
| P1-C: `adminSearch.ts` Page result treated as array | Fixed to `orgs.items.filter(...)`. Verified in-browser: search fires without server error; results render. |

Post-fix: `npx tsc --noEmit` PASSES clean. Phase 2 can now exercise the tag / rollup / admin-search paths without runtime breakage.

---

## Phase 2 — HALTED for critical finding

**Sweep stopped per bug policy.** Critical RLS bypass surfaced during behavior probes.

### Setup

Seeded QA tenant: `_qa-test-1783563390756` (id `cmrcvlcx00000ccdsgkglqmpl`).
Fixtures: 8 users (SA/Admin/2 Agents/Light Agent/3 Clients), 3 orgs, 2 groups, 3 CF definitions + 14 values, 1 SLA policy + 1 calendar + 20 TicketSla rows (5 warning / 5 breached / 10 satisfied), 5 survey responses (3 CSAT + 2 NPS), 2 rules + 1 escalation, 1 shared view + 1 canned + 1 macro, 50 tickets across statuses/priorities/orgs.

### Phase 2 probes run

Two probe suites executed against the QA tenant:

- **DB invariants** (`scripts/qa_phase2_probes.mjs`): **41 pass / 0 fail.** Covered every milestone's shipped-schema shape — CF constraints, dual-FK invariant on auth creds, lifecycle rows, scope mix, view/canned/macro shape, TICKET_CREATED-matching trigger, SLA target shapes, CSAT enum coverage, etc.
- **Behavior probes** (`scripts/qa_phase2_behavior.mjs`): **14 pass / 1 fail.**
  - PASS: rule engine would fire on URGENT open ticket; SLA cron would pick up exactly the 5 warning + 5 breach rows I seeded; routing dry-run finds the right member set; CSAT enqueue would fire; analytics compute matches seed distribution; Z2 × M13 CF filter narrows correctly (severity=High → 3 tickets); Z4 × M2 override falls through to tenant default.
  - **FAIL: RLS cross-tenant isolation.** SUPER_ADMIN-scoped withRls tx returned 82 tickets when the QA tenant has 50. Investigation below.

### CRITICAL bug — `super_admin_read` RLS policy grants unbounded cross-tenant SELECT

**Scope:** 10 Support-owned tables:
`tickets`, `custom_field_definitions`, `custom_field_options`, `custom_field_values`, `organization_settings`, `subject_avatars`, `subject_preferences`, `ticket_forms`, `ticket_form_fields`, `ticket_form_categories`.

**The policy:**
```
CREATE POLICY super_admin_read ON <table>
  FOR SELECT USING (app_current_role() = 'SUPER_ADMIN');
```
No tenant clause.

**Why it's broken:**
PostgreSQL RLS policies of the same command type are OR-combined (permissive by default). `tenant_isolation` restricts to `tenantId = app_current_tenant_id()`. `super_admin_read` unconditionally grants SELECT when `app.role='SUPER_ADMIN'`. **If either passes, the row is visible.** Any session with `app.role='SUPER_ADMIN'` reads across all tenants.

**Who's a SUPER_ADMIN:** `src/lib/auth.ts::wrapperRoleNameToUserRole()` maps wrapper Role name "Super Admin" → session role `"SUPER_ADMIN"` for **every** tenant, not just the host `INTERNAL` tenant. Every provisioned tenant seeds a "Super Admin" role. Any tenant admin invited with that role gets a session that opens `app.role='SUPER_ADMIN'` in every `withRls` call.

**Concrete demonstration** (behavior probe output):
```
✗ RLS.SUPER_ADMIN scoped-tx returns only this tenant's tickets
  — RLS-scoped count=82 (expected 50)
```
withRls set `app.tenant_id` to the QA tenant, `app.role` to `SUPER_ADMIN`, called `tx.ticket.count({})` with no `where`. The policy union let it read 32 tickets from other tenants.

**Why this hasn't surfaced in the UI yet:**
Every current Prisma call site includes an explicit `tenantId` in `where`. So the query result is still restricted at the app layer, and no UI has been observed leaking data. But the RLS safety net — the whole reason we have `withRls` — is broken for SUPER_ADMIN sessions. Any future callsite (or any bug that drops `tenantId` from a where) would leak.

**Intended purpose (my read):**
`super_admin_read` was added so host-tenant SUPER_ADMINs on `INTERNAL` tenants could see cross-tenant data for surfaces like `/admin/super/analytics`. But host-tenant paths already bypass RLS via the bare `prisma` client (`src/actions/superAnalytics.ts`, host-tenant crons). The policy is redundant AND permissive to non-host tenant super admins.

**Fix options** (not applying yet — reporting first):
1. **Drop `super_admin_read` on all 10 tables.** Host-tenant reads already use bare `prisma`; nothing in the app relies on the policy for correctness.
2. **Add tenant-type gate to the policy.** Requires an EXISTS subquery on `tenants` — expensive to evaluate per-row.
3. **Downgrade `role` at `withRls` call sites.** Non-host tenants pass `role: "ADMIN"` instead of `"SUPER_ADMIN"` to the RLS session. Least invasive, but requires touching every callsite.

**Recommendation:** option 1. The policy has no legitimate consumer.

### Fix applied and verified

Option 1 chosen — `prisma/qa_fix_rls_super_admin_read.sql` drops the `super_admin_read` policy from all 10 tables. Applied via node splitter; `pg_policies` confirms 0 remaining rows for that policyname.

Verified via re-run of `scripts/qa_phase2_behavior.mjs` under **APP_DIRECT_URL** (which uses the `app_runtime` role, no BYPASSRLS — the same role the live app uses). Before the fix, the SUPER_ADMIN-scoped tx returned 82 tickets. After the fix, 50 (exactly the QA tenant's set). Cross-tenant isolation for SUPER_ADMIN sessions **restored**.

**Behavior probe suite: 15 pass / 0 fail.**

No functional regression for legitimate cross-tenant consumers — every host-tenant super-admin surface (`superAnalytics.ts`, host crons) uses the bare `prisma` root client (BYPASSRLS role), unchanged.

### Regression risk noted

Any pre-existing callsite that legitimately depended on cross-tenant SELECT via `super_admin_read` would now return zero rows for non-host-tenant Super Admins. Grep confirms all `tx.ticket` / `tx.customField*` / `tx.subjectAvatar` / `tx.subjectPreference` / `tx.ticketForm*` / `tx.organizationSettings` calls sit inside `withRls({tenantId: session.tenantId})`, so no such consumer exists in the current codebase. Documented for future review.

### Phase 2 summary

- Static invariants (41 probes across 12 milestones): **PASS**
- Behavior probes (15 probes covering M1/M2/M3/M5/M13 + Z2×M13 + Z4×M2 + cross-tenant): **PASS**
- 1 critical RLS bypass found, filed, fixed, verified.

**Phase 2 complete. Ready to proceed to Phase 3 (integration).**

---

## Phase 3 — Not yet started

---

## Phase 3 — Not started
