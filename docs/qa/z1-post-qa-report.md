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

## Phase 2 — In progress

TBD.

---

## Phase 3 — Not started
