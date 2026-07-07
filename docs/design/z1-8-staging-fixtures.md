# Z1.8 staging tenant fixtures spec

**Status:** Spec'd. Awaiting Z1.8 implementation phase to author `scripts/z1_8_staging_tenant.mjs`.

**Related:**
- [ADR-001](../adrs/adr-001-z1-8-auth-model-set-b.md) — the ratified auth model
- [`docs/design/z1-8-auth-model.md`](z1-8-auth-model.md) — original design doc with staging recommendation
- Boundary doc §7.12 — Z1.8 scope

## Purpose

The Z1.8 dry-run has to actually exercise every code path Z1.8 changes. A minimal "two-user" fixture won't do it — the migration touches invite flow, pending-approval flow, OTP verify, reactivation, session lifecycle, and password credential migration. The staging tenant needs seeded state that hits each of those code paths so the dry-run can produce meaningful pass/fail signal.

Fresh throwaway per dry-run pass (marker slug `_z18-staging-<unix-timestamp>`). Idempotent seed script — safe to re-run and produce the same fixtures every time, so we can dry-run repeatedly during Z1.8 implementation without re-authoring the fixtures each time.

## Fixture set

Seven users total, plus supporting rows. All within one staging tenant.

### Users

| # | Legacy `users.role` | Legacy `users.status` | Wrapper counterpart | Purpose (which Z1.8 code path it exercises) |
|---|---|---|---|---|
| 1 | SUPER_ADMIN | ACTIVE | TeamMember | Session-decode migration; identity read; credential migration (has known password) |
| 2 | ADMIN | ACTIVE | TeamMember | Session-decode; last-Super-Admin guard sanity check (SA count = 1 exactly) |
| 3 | AGENT | ACTIVE | TeamMember | Session-decode; typical staff row |
| 4 | CLIENT | ACTIVE | EndUser | Session-decode for CLIENT branch; typical customer row |
| 5 | CLIENT | PENDING | EndUser | Approve/reject flow (registered via portal, awaiting admin decision) |
| 6 | AGENT | SUSPENDED | TeamMember | Reactivation flow (deactivate/reactivate matrix guard) |
| 7 | AGENT | INVITED | TeamMember | Invite-accept flow (admin-invited, not yet accepted) |

Each user's `id` is a fresh `cuid()` at seed time; dual-write invariant applies (wrapper row created with preserved id alongside legacy row).

### Supporting rows

| Row | Owner | Purpose |
|---|---|---|
| **Active login OTP** for user #4 (CLIENT, ACTIVE) | `login_otps` | Exercises `verifyLoginOtp` happy path — code hash + non-expired + non-consumed |
| **Expired invite** for user #7 (AGENT, INVITED) | `login_otps` | Exercises the "invite expired" edge case — `expiresAt` set to `NOW() - 1 day` |
| **Standard 3 roles** for the tenant | `roles` | Seeded by `seedStandardRoles(ctx)` — "Super Admin" / "Admin" / "Agent" |
| **Default Support group** for the tenant | `groups` | Seeded by `getOrCreateDefaultGroup(ctx)` — every TeamMember auto-joined |
| **TenantBranding + ChatbotConfig defaults** | `tenant_branding`, `chatbot_configs` | Match the shape `super.ts`'s `createTenant` seeds |

### Credentials

| User | Password | Purpose |
|---|---|---|
| #1 (SUPER_ADMIN) | Printed to stdout at seed time; format: `staging-sa-<random-8-chars>` | Login end-to-end verify for a staff subject |
| #4 (CLIENT, ACTIVE) | Printed to stdout at seed time; format: `staging-client-<random-8-chars>` | Login end-to-end verify for an EndUser subject |
| #2, #3, #6 (staff) | Random unusable hash — not printed | Not exercised for login; only for identity/lifecycle reads |
| #5 (PENDING) | Random unusable hash | Not exercised for login (PENDING can't log in) |
| #7 (INVITED) | Random unusable hash | Not exercised for login (INVITED can't log in) |

Passwords printed to stdout on seed success are session-scoped to the operator running Z1.8's dry-run. The seed script does not persist them anywhere else. On tenant teardown they cease to matter (the tenant is deleted, cascading all rows).

## Script contract

**File:** `scripts/z1_8_staging_tenant.mjs` (to be authored during Z1.8 implementation, not now).

**Modes:**

- `--seed` — create a fresh staging tenant + fixtures, print operator credentials, print the tenant id and slug for use in subsequent dry-run commands
- `--verify <tenant-id>` — read the current state of the named tenant, produce a projection-style diff (identity rows / lifecycle rows / credential rows exist per fixture spec)
- `--teardown <tenant-id>` — delete the tenant (cascades all owned rows via Prisma's `onDelete: Cascade`). Verifies afterward that no rows referencing the tenant remain.

**Idempotency:**

- `--seed` on a tenant that already exists (same slug) is a no-op after printing existing state. Slug includes timestamp so this is a natural no-op — successive `--seed` calls create new tenants.
- `--verify` is read-only.
- `--teardown` on a tenant that doesn't exist is a warning (not an error).

**Guardrails:**

- Every write query filters `WHERE slug LIKE '_z18-staging-%'` on tenant reads. Even a bug that accidentally passes a real tenant's id can't affect it — the filter rejects the tenant lookup.
- The teardown mode refuses to delete a tenant whose slug does NOT start with `_z18-staging-`. Belt-and-braces guard against accidentally targeting a real tenant.
- Seed and teardown both write a marker row to `core_audit_logs` (actorType SYSTEM) so the tenant's lifecycle is auditable.

## What "dry-run" means in the Z1.8 flow

Z1.8's migration exercises (in this order):

1. **Fresh staging tenant seeded** via `--seed`. All 7 users, 2 OTPs, all supporting rows in place. Baseline verified.
2. **Z1.8's migration runs against this tenant only** — dry-run driver takes a `--tenant-id <staging-id>` filter to scope every write.
3. **Post-migration verification**: run `--verify` on the staging tenant. Expected outcomes:
   - Every user's `passwordHash` moved out of legacy `users` and into `auth_credentials` (unusable-hash users get an `auth_credentials` row with the random hash intact).
   - Every user's lifecycle state moved out of legacy `users` and into `team_member_lifecycle` / `end_user_lifecycle`.
   - Session cookies issued via `login` for user #1 and user #4 decode correctly under the new `subjectId`/`subjectKind` shape.
   - Active OTP for user #4 still verifies successfully.
   - Expired OTP for user #7 rejects with an "expired" error (not a "user not found" error).
   - Attempt to log in as user #5 (PENDING) returns the "still awaiting admin approval" error, not a credential-mismatch error.
   - Attempt to log in as user #6 (SUSPENDED) returns the "deactivated" error.
4. **Localhost verification against real tenant** — only after step 3 is green. `stralis` INTERNAL tenant is used for the localhost pass, mirroring how Z1.6 verified against `stralis`.
5. **Production migration** — runs against all real tenants (`stralis`, `Acme Corp`) once localhost is green.
6. **Staging teardown** — `--teardown` deletes the staging tenant. Verified via post-teardown count query.

## What this spec deliberately does not cover

- **The migration script itself** — that's Z1.8's implementation work, not this spec's scope.
- **Rollback strategy** — deferred to Z1.8's implementation plan. Set B is designed to be reversible (new tables can be dropped), so rollback is a well-defined operation, but the exact sequence is implementation-time detail.
- **Data volume tuning** — staging tenant has 7 users. Production tenants have 19 (`stralis`) + 1 (`Acme Corp`). Nothing in Z1.8's writes is O(N²), so the volume gap is not a concern.
- **Multi-tenant staging** — one staging tenant is enough for Z1.8's dry-run. If Z1.8 later reveals cross-tenant migration semantics, this spec can grow.

## Related open items

- If `super.ts`'s `listTenantsWithHealth` is exercised during localhost verification, the staging tenant will appear in the SUPER_ADMIN dashboard until teardown. Add a filter that hides tenants whose slug starts with `_z18-staging-` from the health view during Z1.8, or teardown before the operator visits the dashboard. Filed as a Z1.8 implementation-time decision.
