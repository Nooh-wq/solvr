# ADR-001: Z1.8 auth model — Set B (Support-side auth + neutral session cookie)

**Status:** Accepted (2026-07-07)

**Deciders:** [pending git-user identity]

**Related:**
- Design doc: [`docs/design/z1-8-auth-model.md`](../design/z1-8-auth-model.md) — neutral option matrix for Q1/Q2/Q3
- Boundary doc: [`docs/shared-platform-boundary.md`](../shared-platform-boundary.md) §7.12 (Z1.8 scope, resolved), §7.14 (M-auth-migration open item)
- Milestone context: Z1.8 sits between Z1.6 (merged, admin CRUD dual-write) and Z1.9 (findOrCreateSender) → Z1.5 (drop legacy tables) → Z1.7 (avatarUrl)

---

## Context

Z1.5's job is to drop the legacy `users` and `companies` tables. Before that can land, three architectural questions have to be answered — where does each piece of "per-user state" go once the legacy table is gone?

1. **`passwordHash`** — bcrypt hash on legacy `users.passwordHash`. Written by every auth-adjacent flow (register, invite-accept, reset, change). Read by login.
2. **Session cookie identity field** — JWT currently carries `{ userId: legacy User.id, tenantId }`. Post-Z1.5 the `userId` field points at nothing.
3. **Lifecycle state** — `status` (INVITED/PENDING/ACTIVE/SUSPENDED/REJECTED/UNVERIFIED), `invitedAt`, `invitedById`, `approvedAt`, `approvedById`, `rejectedAt`, `rejectedById`, `lastActiveAt`, `passwordChangedAt`. All on legacy `users`. Support-side workflow state, not identity.

The design doc lays out three options per question, plus a coupling analysis that names Q1 and Q3 as tightly coupled (both are "per-user auth-adjacent state that has to live somewhere") and Q2 as loosely coupled. It proposes three internally-coherent sets: A (widen wrapper across the board), B (Support-side auth + neutral cookie), C (delegate to external IdP + role-encoded lifecycle).

## Decision

**Set B is accepted.** Concretely:

- **Q1 → 1B**: A new Support-owned `auth_credentials` table with a dual-FK pair to `end_users` / `team_members` (matching Z1.4a's dual-FK column pattern). Fields: `subjectEndUserId?`, `subjectTeamMemberId?`, `passwordHash`, `passwordChangedAt`, `mfaSecret?` (future), `createdAt`, `updatedAt`. Wrapper DTOs are not widened. `login` reads from this table via a bcrypt compare; every password write routes through it.
- **Q2 → 2A**: Session cookie JWT payload becomes `{ subjectId: string, subjectKind: "END_USER" | "TEAM_MEMBER", tenantId, ... }`. Session decode branches on `subjectKind` to query the wrapper (`getEndUser` or `getTeamMember`). Every server action's `session.id` is renamed to `session.subjectId`. All existing sessions invalidate at Z1.8 deploy — users log out once and log back in.
- **Q3 → 3B**: Two new Support-owned tables: `team_member_lifecycle` and `end_user_lifecycle`. Each keyed on preserved id (from Z1.3 backfill), each carries the `status` enum + all lifecycle timestamps + FK columns (`invitedById`, `approvedById`, `rejectedById`). Admin.ts's approveUser/rejectUser/etc. route through these tables instead of legacy `users.status`.

### Why Set B (coupling analysis, restated)

**Q1 and Q3 are tightly coupled.** Both are "per-user, per-tenant, auth-adjacent state." Answering them in the same direction is architecturally coherent; splitting them creates awkward "password lives on Support-owned table, status lives on Shared Platform" flows where every `login` call reads from two stores under different ownership.

**Q2 is loosely coupled.** Session cookie shape can be picked independently of Q1/Q3. But **2A pairs most naturally with 1B + 3B**: session decode reads `subjectId` from the JWT, hits the wrapper for identity, hits Support-side lifecycle table for status check, hits Support-side auth_credentials for password verification if it's a login attempt. Clean flow, one owner per store.

**Set B specifically:**
- **Wrapper stays identity-only** — matches Shared Platform's actual remit (identity primitives shared across apps), doesn't pollute wrapper DTOs with Support-specific concerns (status enum, password hash format, MFA secret shape).
- **Support owns its auth surface** — password hashing, lifecycle transitions, invite-accept flows, MFA (future) all sit in the same repo where the admin CRUD that operates on them lives.
- **Session cookie is subject-neutral** — `subjectKind` cleanly extends to HRMS's `"EMPLOYEE"` and CRM's `"CONTACT"` if those apps ever share Support's session layer (unlikely, but the extensibility is free).

### What Set B defers

Set B is honest about being an intermediate architectural state. It does **not** answer:

- **Should Shared Platform grow a proper auth service** (SSO, credential management, session issuance) that all three apps (Support / HRMS / CRM) share? Deferred to §7.14 M-auth-migration.
- **Should Support consolidate onto Supabase Auth (or another external IdP)?** Rejected as premature scope for Z1.8 (Set C); may be revisited in M-auth-migration if a trigger fires.
- **Should Support add MFA / password-policy / SSO features?** These fit cleanly into `auth_credentials` when their business need arrives, without forcing Z1.8 to design them upfront.
- **Should the lifecycle model evolve** to more or fewer states, or a different transition matrix? Deferred to product need. Set B preserves the current 6-state enum from Team & Roles v2 (PR #21) as-is.

### What triggers M-auth-migration

Any one of:

1. **HRMS or CRM auth planning** reaches the "where does auth live?" question in its own roadmap. Their answer will constrain Support's Z1.8 endpoint state.
2. **Shared Platform readiness** — Shared Platform's team decides to grow an auth service, either because ≥ 2 of the 3 apps want it or because operational patterns (per-tenant SSO config, shared session invalidation) become worth centralizing.
3. **Support-side auth scaling pressure** — if `auth_credentials` grows to the point where per-tenant partitioning, MFA feature depth, or SSO integration become substantial ongoing work, centralizing may cost less than Support carrying it alone.

### How the three apps should evolve while M-auth-migration is pending

- **Support**: keeps `auth_credentials` + lifecycle tables. Adds features to its own tables as needed (MFA, password policy, etc.). No proactive investment in generalizing them for other apps.
- **HRMS**: when it starts, ships its own auth model without trying to share Support's tables. Convergence with Support's shape is evidence for M-auth-migration; divergence is evidence against.
- **CRM**: same as HRMS — its own auth model (or no auth at all if contacts don't authenticate).
- **Shared Platform**: no auth-service design work until a trigger fires. Wrapper stays identity-only.

## Consequences

### What Set B enables

- **Z1.5 can land cleanly** once Z1.8 and Z1.9 ship. The lifecycle + credentials data all lives outside legacy `users`; the table drops without breaking anything.
- **HRMS/CRM optionality preserved** — neither app inherits a Support-specific auth shape.
- **Cross-repo cost near-zero** — Set B doesn't require any Shared Platform schema change.
- **Reversibility high** — new Support-side tables are easy to drop or migrate later if M-auth-migration decides to consolidate.

### What Set B costs

- **All existing sessions invalidate at Z1.8 deploy** (2A rename). Users log out once. Small one-time UX cost; well-precedented.
- **Two new Support-side tables to maintain** (`auth_credentials`, plus two lifecycle tables — one per wrapper kind). Small but real.
- **`login` and session-decode do more reads per request** — wrapper for identity + Support for lifecycle + Support for credentials on login. Bounded (3 queries max per request), indexed, well within performance budget. Not the P0 concern.
- **The "is Shared Platform auth eventually right?" question stays open** — Set B doesn't answer it, just defers it via §7.14. Some architects prefer answering hard questions upfront; Set B is an honest intermediate state that trusts real-world signal to drive the answer.

### What Set B rules out

- Widening wrapper DTOs with `passwordHash` / `status` / lifecycle timestamps. If M-auth-migration later decides Shared Platform should own auth, that's a fresh migration, not an extension of Z1.8.
- Delegating auth to Supabase (or another external IdP) as part of Z1.8. If that becomes right later, it's its own milestone.

## Post-decision workflow

1. `docs/shared-platform-boundary.md` §7.12 updated to point at this ADR (done in same commit).
2. §7.14 (M-auth-migration) added to the boundary doc as a durable named open item (done in same commit).
3. Staging tenant fixture spec: [`docs/design/z1-8-staging-fixtures.md`](../design/z1-8-staging-fixtures.md) (drafted in same commit).
4. Z1.8 implementation plan scoped against these decisions. The split-into-Z1.8a/Z1.8b option (per boundary §7.11) stays on the table until the implementation plan reveals whether the concern graph is cleanly separable.
5. Migration code doesn't start until the implementation plan is reviewed. Staging tenant seed script comes first; production migration after verified staging apply.
