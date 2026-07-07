# Z1.8 auth model — design doc

**Status:** Proposed. Awaiting decisions on three questions before Z1.8 implementation begins.

**Related:** `docs/shared-platform-boundary.md` §7.11 (milestone sequence), §7.12 (Z1.8 scope), §7.13 (Z1.9 scope). §7.10 (Z1.7 avatarUrl) sits after this milestone.

**Framing:** Z1.8 is genuinely different in risk profile from anything Z1 has shipped so far — five files, security-critical semantic changes to session cookies, login, OTP, password reset, invite-accept, signup, and cross-tenant super-admin queries all bundled. This doc exists so the design questions get answered explicitly and archived as ADRs before any migration code is written. Once decisions land, the boundary doc §7.12 gets updated to reflect the chosen shape.

**Not in scope:** the implementation plan itself. This doc answers "which architecture do we adopt"; the follow-up (once decisions land) answers "how do we cut over to it and what does staging look like."

---

## Question 1: Where does `passwordHash` live post-Z1.5?

### Current state
`users.passwordHash` — bcrypt hash on the legacy Support-owned `users` table. Written by `registerClient` (signup), `acceptInvite`, `resetPassword`, `changePassword`. Read by `login` (bcrypt compare).

### Options

#### Option 1A — Widen wrapper: add `passwordHash` to Shared Platform `EndUser` + `TeamMember` DTOs

- **Structure**: Shared Platform's `end_users` and `team_members` tables both gain a `passwordHash String?` column. Wrapper DTOs expose it. Support-side auth code (`login`, password writes) routes through wrapper `updateEndUser` / `updateTeamMember` / `getEndUser` / `getTeamMember`.
- **Cross-repo impact**: **Yes.** Shared Platform ships a schema migration adding two columns. Support pulls the mirror, regenerates Prisma. Coordinated release across two repos.
- **Support-side impact**: Small. Every legacy `tx.user.update({ data: { passwordHash } })` becomes an `updateTeamMember` / `updateEndUser` call. ~6 call sites across `auth.ts` and `profile.ts`.
- **Post-Z1.5 endpoint shape**: Identity + auth credentials both live on Shared Platform's tables. One source of truth per person for "who you are + how you prove it."
- **Reversibility**: Adding a column is cheap; removing it once dependent code exists in two repos is expensive.
- **HRMS/CRM implications**: **Harder.** HRMS employees typically authenticate via SSO/SAML through their org's identity provider — a `passwordHash` column on the shared identity table forces HRMS to either populate it (weird) or ignore it (dead field). CRM contacts often aren't authenticatable subjects at all (they're prospects/leads with no credentials).

#### Option 1B — Support-side `auth_credentials` table

- **Structure**: Support owns a new small table `auth_credentials` with FK to `end_users.id` OR `team_members.id` (via a dual-FK pair matching Z1.4a's pattern). Fields: `subjectEndUserId?`, `subjectTeamMemberId?`, `passwordHash`, `passwordChangedAt`, `mfaSecret?` (future), `createdAt`, `updatedAt`. Wrapper is not touched.
- **Cross-repo impact**: **None.** Support owns the table end to end.
- **Support-side impact**: Medium. New Prisma migration for the table. `auth.ts`'s password reads/writes route through a new `src/lib/auth-credentials.ts` helper. ~6 call sites updated.
- **Post-Z1.5 endpoint shape**: Clean separation. Wrapper owns identity ("who you are"). Support owns credentials ("how you prove it"). Different lifecycles, different owners, different tables.
- **Reversibility**: New table is easy to keep or drop later. Dropping means migrating the hashes back somewhere; adding is a fresh table.
- **HRMS/CRM implications**: **Easier / neutral.** Each app owns its own auth model. HRMS can use SSO without touching the shared identity table. CRM can skip credentials entirely. Neither app inherits Support's password shape as a constraint.

#### Option 1C — Delegate to Supabase Auth (or similar external IdP)

- **Structure**: `passwordHash` disappears from Support and Shared Platform entirely. `login` calls `supabase.auth.signInWithPassword`. Session cookies become Supabase-issued JWTs. Wrapper identity records (`EndUser` / `TeamMember`) still exist but decouple from auth — the wrapper subject id maps 1:1 to a Supabase auth user id.
- **Cross-repo impact**: **None to the Shared Platform.** But adds a hard dependency on Supabase Auth (or replacement).
- **Support-side impact**: Substantial. Session cookie shape changes. Every auth flow (login, reset, invite-accept, registerClient, verifyRegistrationOtp) rewrites to Supabase Auth SDK. Password migration for existing users requires forced password reset on next login. ~15+ call sites; new integration surface.
- **Post-Z1.5 endpoint shape**: No password lives anywhere Support/Shared Platform owns. Supabase Auth is the credential store.
- **Reversibility**: Hard. Migrating off Supabase Auth later means either re-hashing everyone's password (impossible without re-collecting) or forcing a system-wide reset.
- **HRMS/CRM implications**: **Easier if all apps adopt Supabase Auth; harder if they diverge.** Shared identity provider means shared SSO story across HRMS/CRM/Support. But if HRMS wants a different IdP (org-specific SSO), Supabase Auth becomes a dependency Support pays for that HRMS doesn't benefit from.

### My recommendation for Q1: **Option 1B**

Matches the "per-app auth model" reality that HRMS and CRM will actually have. Password-based auth is a Support-side concern; shared identity should stay identity-only. Preserves optionality — nothing prevents a later "M-supabase-auth" milestone if we decide to consolidate, but that decision doesn't need to happen in Z1.8.

---

## Question 2: What shape does the session cookie carry?

### Current state
JWT with payload `{ userId, tenantId, isImpersonating, impersonatorUserId, ... }`. `userId` is legacy `User.id`. Session decode reads `tx.user.findUnique({ where: { id: payload.userId } })` and asserts status = ACTIVE.

### Options

#### Option 2A — Neutral `subjectId` + `subjectKind`

- **Structure**: JWT payload becomes `{ subjectId: string, subjectKind: "END_USER" | "TEAM_MEMBER", tenantId, ... }`. Session decode branches on `subjectKind` to query wrapper (`getEndUser` or `getTeamMember`). Every server action's `session.id` becomes `session.subjectId`.
- **Cross-repo impact**: None.
- **Support-side impact**: Every `session.id` / `session.userId` reference in the codebase renames. ~40+ call sites across server actions and lib. All existing sessions invalidated at deploy (users log out once).
- **Post-Z1.5 endpoint shape**: Cookie is legacy-name-free. Neutral, forward-looking.
- **Reversibility**: One-time deploy cost (session invalidation). Rename is otherwise reversible with the same cost paid again.
- **HRMS/CRM implications**: **Easier.** The `subjectKind` pattern generalizes cleanly — HRMS adds `"EMPLOYEE"` variant, CRM adds `"CONTACT"` variant, session decode branches accordingly. Same JWT shape across three apps, cleanly extensible.

#### Option 2B — Dual field: `endUserId` / `teamMemberId`, exactly one populated

- **Structure**: JWT payload becomes `{ endUserId?: string, teamMemberId?: string, tenantId, ... }`. Exactly one of the two is set per session (matches Z1.4a's dual-FK column pattern on all 8 tables). Session decode picks the branch and queries the appropriate wrapper function.
- **Cross-repo impact**: None.
- **Support-side impact**: Same rename volume as 2A. All existing sessions invalidated at deploy.
- **Post-Z1.5 endpoint shape**: Cookie is explicit about which store to query.
- **Reversibility**: Same one-time deploy cost. Rename otherwise reversible.
- **HRMS/CRM implications**: **Neutral.** HRMS needs new fields (`employeeId?`), CRM needs new fields (`contactId?`), not directly reusable — each app has its own dual/N-fold field-set. Pattern is transferable but the JWT shape doesn't share.

#### Option 2C — Keep `userId` field name; alias-map at decode time (transitional shim)

- **Structure**: JWT payload keeps `{ userId, tenantId, ... }`. Session decode does dual lookup: try `getTeamMember(userId)` first, fall back to `getEndUser(userId)`. Preserved-ids from Z1.3 guarantee this works.
- **Cross-repo impact**: None.
- **Support-side impact**: Zero rename cost. No session invalidation at deploy. But `userId` naming persists in code as a legacy artifact.
- **Post-Z1.5 endpoint shape**: Cookie carries a field named `userId` referring to something that isn't a legacy User anymore. Cognitive load for future readers.
- **Reversibility**: Trivially reversible — future rename pass can pick 2A or 2B any time.
- **HRMS/CRM implications**: **Harder.** Perpetuates a naming convention that doesn't generalize; HRMS/CRM inherit a design decision made when there was only one subject type.

### My recommendation for Q2: **Option 2A**

`subjectId` + `subjectKind` is the cleanest generalization for a multi-app future. The one-time session invalidation cost is small and easy to communicate. Legacy naming is technical debt we should pay off during a refactor of exactly this shape, not carry forward.

---

## Question 3: Where does lifecycle state live?

Lifecycle state means all of: `status` (INVITED/PENDING/ACTIVE/SUSPENDED/REJECTED/UNVERIFIED), `invitedAt`, `invitedById`, `approvedAt`, `approvedById`, `rejectedAt`, `rejectedById`, `lastActiveAt`, `passwordChangedAt`. Currently all on legacy `users`. All need somewhere to live before Z1.5 can drop the table.

### Options

#### Option 3A — Widen wrapper: add lifecycle columns to Shared Platform `EndUser` + `TeamMember`

- **Structure**: Shared Platform schema adds `status` enum + timestamp columns to both `end_users` and `team_members`. Wrapper DTOs expose them. Admin.ts's approveUser/rejectUser/etc. route through `updateTeamMember` / `updateEndUser`.
- **Cross-repo impact**: **Yes.** Substantial Shared Platform schema change (new enum + 5-6 timestamp columns × 2 tables). Coordinated release.
- **Support-side impact**: Small once the cross-repo migration lands. ~10 admin.ts call sites route through wrapper.
- **Post-Z1.5 endpoint shape**: Full lifecycle owned by Shared Platform.
- **Reversibility**: Cross-repo columns hard to remove once shipped.
- **HRMS/CRM implications**: **Harder for both.** HRMS employee lifecycle is genuinely different (onboarding, probation, active, leave, termination, alumni — 6+ distinct states with app-specific transitions). CRM contacts have no lifecycle at all — they're just data. Forcing Support's status enum onto the shared identity table either (a) makes HRMS fight the shape, or (b) requires the enum to grow to cover all three apps' lifecycles, at which point it stops being a coherent enum.

#### Option 3B — Support-side lifecycle tables: `team_member_lifecycle` + `end_user_lifecycle`

- **Structure**: Support owns two new tables, keyed on preserved id. Fields: `subjectId` (FK), `status` enum, all lifecycle timestamps + FK columns. Admin.ts reads join these to wrapper identity; writes hit these directly.
- **Cross-repo impact**: **None.** Support owns everything.
- **Support-side impact**: New Prisma migrations + new `src/lib/lifecycle.ts` helper. Admin.ts reads join lifecycle by id; writes hit lifecycle directly. Larger than 3A but cleanly scoped.
- **Post-Z1.5 endpoint shape**: Identity on Shared Platform; lifecycle (Support's specific model) on Support tables.
- **Reversibility**: New Support tables are easy to keep, migrate, or drop later.
- **HRMS/CRM implications**: **Easier.** Each app owns its own lifecycle model. HRMS's `employee_lifecycle` table diverges from Support's without conflict; CRM skips the concept entirely if it wants.

#### Option 3C — Encode status as wrapper Role assignment + Support-side auxiliary metadata

- **Structure**: Wrapper's Role primitive already exists (Z1.2). Convert `status` from an enum column to a Role: INVITED users get a "Pending Activation" role, PENDING users get "Pending Approval", ACTIVE users get their normal role (Agent/Admin/etc.), SUSPENDED users get "Suspended", REJECTED users get "Rejected". Auxiliary timestamps (`invitedAt`, `approvedAt`, etc.) live on a small Support-side table.
- **Cross-repo impact**: **Minimal.** Uses existing wrapper Role primitive; no Shared Platform schema change beyond seeding lifecycle roles.
- **Support-side impact**: Substantial semantic refactor. `getAvailableActions` becomes role-driven, not status-driven. Every "status" reference becomes a role name lookup.
- **Post-Z1.5 endpoint shape**: Lifecycle-as-role in wrapper; auxiliary metadata on Support.
- **Reversibility**: Semantic refactor is real work to undo.
- **HRMS/CRM implications**: **Neutral.** Roles are a first-class wrapper primitive, but coercing lifecycle into role assignments assumes an app-specific semantic (Support's 6 states) mapped onto a general primitive. HRMS may or may not want the same conflation; CRM almost certainly doesn't.

### My recommendation for Q3: **Option 3B**

Support-side lifecycle tables match the "per-app lifecycle model" reality. Preserves the current status enum semantics (which the Team & Roles v2 matrix in PR #21 depends on) without forcing them onto Shared Platform. Cross-repo impact zero. HRMS/CRM friendliness: strong.

---

## Coupling analysis — how the three answers relate

The three questions aren't fully independent. Here's the coupling I see:

### Tight coupling: Q1 and Q3

Both are "per-user auth-adjacent state that has to live somewhere." If you pick 1A (widen wrapper for password), the natural extension is 3A (widen wrapper for lifecycle) — same team, same schema-change process, same cross-repo cost, same HRMS/CRM concerns. If you pick 1B (Support-side credentials), 3B (Support-side lifecycle) sits naturally alongside — same rationale, same repo, same table-neighborhood.

**Splitting Q1 and Q3 creates awkward architecture.** E.g., picking 1B (Support-side credentials) + 3A (widen wrapper for lifecycle) means:
- Password lives on `auth_credentials` (Support)
- Status lives on `end_users.status` (Shared Platform)
- `login`'s "check password AND check status" flow has to hit both stores.
- HRMS/CRM get a mixed signal about where per-user state lives on shared vs owned tables.

So Q1 and Q3 should be answered together, in the same direction. My recommended combination — **1B + 3B** — sits in a coherent architecture: Support owns auth (credentials + lifecycle) alongside admin CRUD; Shared Platform owns identity (id, name, email, role, org, groups, tags).

### Loose coupling: Q2

Q2 (session cookie shape) is more independent. You can pick 2A / 2B / 2C regardless of Q1/Q3 answers — session decode just adjusts the lookup path.

That said, 2A (`subjectId` + `subjectKind`) pairs most naturally with 1B + 3B: session decode reads `subjectId` from the JWT, hits the wrapper for identity, then hits Support-side lifecycle + credentials tables for status/password checks. Clean flow.

### Summary table

| | Q1 (passwordHash) | Q2 (session cookie) | Q3 (lifecycle) |
|---|---|---|---|
| **Coherent set A** | 1A widen wrapper | 2A subjectId | 3A widen wrapper |
| **Coherent set B** | 1B Support-side | 2A subjectId | 3B Support-side |
| **Coherent set C** | 1C Supabase Auth | 2C-transitional | 3C role-encoded |

The three "coherent sets" above are internally consistent. My strong recommendation is **set B (1B + 2A + 3B)**:
- Cross-repo cost: near-zero (2A rename is Support-only).
- HRMS/CRM friendliness: high — none of the three apps inherits a Support-specific auth or lifecycle model.
- Reversibility: high — everything Support-side is easy to change later.
- Consistency: password + lifecycle sit together in the "Support-owned auth surface"; wrapper stays identity-only; session cookie is neutral.

Set A (widen wrapper across the board) is coherent but locks Shared Platform into Support's auth model, making HRMS/CRM harder. Set C (Supabase Auth + role-encoded lifecycle) is a bigger bet with more up-front work and less flexibility later.

---

## Staging tenant strategy

### Recommendation: fresh throwaway tenant per Z1.8 dry-run pass

Small script (`scripts/z1_8_staging_tenant.mjs`) that:
1. Creates a fresh tenant with a marker slug like `_z18-staging-<unix-timestamp>`. Marker prefix (`_z18-`) so the row is unmistakably distinguishable from production tenants in any admin/audit query.
2. Seeds it with the minimum shape Z1.8 exercises: 1 SUPER_ADMIN legacy User + wrapper TeamMember, 1 CLIENT legacy User + wrapper EndUser, 1 PENDING legacy User + wrapper EndUser (to exercise approve/reject).
3. Runs Z1.8's migration against ONLY the staging tenant's row set (Z1.8's dry-run driver takes an optional `--tenant-id` filter).
4. Verifies outcomes: staging tenant's users have password/lifecycle rows in the new tables; session cookies decode correctly; existing sessions on the production tenant untouched.
5. On success: deletes the staging tenant (`onDelete: Cascade` handles child rows). On failure: leaves the tenant in place for post-mortem.

### Why fresh throwaway, not Acme Corp

`solvr` (INTERNAL host) and `Acme Corp` (CLIENT) are both real-labeled tenants — one is the host for stralis's own team, the other has a customer name. Even if Acme Corp's user count is small, mixing "test the auth migration" with "one of our two real tenants" muddies the failure signal:
- If something breaks on Acme Corp during Z1.8 apply, was it a Z1.8 bug or unrelated tenant-specific state?
- If Acme Corp's SUPER_ADMIN gets locked out during the migration, we've caused a real customer incident, not a staging-only inconvenience.
- Post-migration verification against a fresh tenant is a clean row-count-vs-projection check; against Acme Corp it requires disentangling pre-existing state.

Fresh throwaway is cheap on Supabase (row inserts + cascades), test-surface-clean, and doesn't touch real customer data or session cookies until we've verified the migration works.

### One caveat

The staging tenant needs a SUPER_ADMIN with a known password for the localhost verify pass to exercise login end-to-end. The seed script prints the credentials on stdout for the operator to use during verification, then deletes the tenant on success.

---

## What happens after this doc

1. Owner reviews this doc.
2. Owner picks one option per question (or confirms recommended set B).
3. Each decision gets recorded as an ADR under `docs/adrs/` — three ADRs total, one per question. ADRs cite this doc as the neutral option matrix + the specific pick as the ratified decision.
4. `docs/shared-platform-boundary.md` §7.12 gets updated to reflect the chosen shape, and the "key design questions" list is replaced with a "resolved decisions" list pointing at the ADRs.
5. Z1.8 implementation plan gets scoped against the ratified decisions. If the design pass reveals cleanly separable sub-concerns (per boundary §7.11's split-Z1.8a/Z1.8b option), scope accordingly.
6. Only then does migration code start being written. Staging tenant script comes first; production tenant migration after verified staging apply.
