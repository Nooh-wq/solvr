# Z1.8a deploy checklist

**Purpose.** Concrete pre/post-deploy checklist for Z1.8a. Every item exists because a specific failure mode was flagged in Z1.8's design pass — see [implementation plan Decision B](z1-8-implementation-plan.md) for the rollback shape each item protects.

**Scope.** Z1.8a only. Z1.8b will get its own checklist.

---

## Pre-deploy

### 1. Verify Vercel deploy pipeline does NOT re-run migrations on retry

**Why this item exists.** Decision B "gap 3": if Vercel's deploy pipeline re-fires the pre-deploy migration hook on retry, and the backfill is idempotent (which it is), a re-run is safe *for the backfill itself* — but re-running against a *partially-committed schema-change state* has never been tested. Rather than trust that path, verify Vercel is configured to only run migrations on first attempt.

**How to verify.**
- Check `vercel.json` and project settings — no `buildCommand` that includes `prisma db execute` on retry.
- Confirm the schema migration runs from a separate, explicitly-triggered step (either manual `npx prisma db execute` from a local shell against production, or a one-shot GitHub Action).
- If migration IS in the build pipeline: add an idempotency check at the top that no-ops when tables already exist.

**Exit criterion.** Written confirmation (in this checklist's "verified" column below) that the migration path is single-run, not retry-run.

### 2. Confirm backfill SQL is applied against production before code deploys

Schema-first ordering (Decision D). Order:
1. `npx prisma db execute --file prisma/z1_8a_migration.sql --schema prisma/schema.prisma` against production DIRECT_URL.
2. Verify with `node scripts/z1_8_migrate.mjs --verify <tenant-id>` for each tenant.
3. Only then deploy Z1.8a code.

### 3. Session-secret sanity

`SESSION_SECRET` is set on Vercel production env, is not the dev placeholder, is ≥32 chars. Verified at boot by `src/lib/session.ts::getSecret()`.

### 4. Tag the grace-period removal date

In `src/lib/session.ts`'s `verifySessionToken`, the old-shape branch comment must state a concrete removal date (Z1.8a deploy date + 7 days). See [boundary doc §7.15](../shared-platform-boundary.md) for the removal follow-up commit.

---

## During deploy

### 5. Watch the migration output

`npx prisma db execute` completes without error. If it errors:
- Note the specific step (see step numbers in `prisma/z1_8a_migration.sql`).
- Do NOT deploy the code. Rollback plan is at Decision B tier 2 (partial schema state) — script is idempotent, re-run finishes.

### 6. Drift-check before code deploy

```
node scripts/z1_8_migrate.mjs --verify <tenant-id>
```
Must report `✓ In sync` for every tenant. If any tenant reports drift, run `--tenant-id <id>` to catch up, then re-verify.

---

## Post-deploy

### 7. Session-decode traffic check (grace period active)

Within the first 30 minutes of Z1.8a deploy:
- Server logs show 200 responses on authenticated routes (no auth-decode failures).
- No spike in `/auth/login` traffic (would indicate mass logout).
- Sentry (or equivalent) shows no unhandled `verifySessionToken` errors.

### 8. Admin CRUD lifecycle-write smoke test

On production, as a real ADMIN:
- Approve a PENDING user. Confirm both `users.status = ACTIVE` and `end_user_lifecycle.status = ACTIVE` (or `team_member_lifecycle` per role).
- Same for reject/reinvite/deactivate on a test row if available.
- Drift-check reports clean after each action.

### 9. Password-change dual-write smoke test

On production, change your own password via `/profile/security`:
- Confirm `users.passwordHash` updated.
- Confirm `auth_credentials.passwordHash` for the same subject updated to the same value.
- New session cookie is new-shape (has `subjectId` + `subjectKind` claims).

### 10. `listTenantsWithHealth` filter check

On production SUPER_ADMIN dashboard `/admin/super`:
- No tenant slugs starting with `_z18-staging-` appear in the list.
- Real tenants (`stralis`, `Acme Corp`, etc.) appear unchanged.

---

## Day 7 follow-up

### 11. Grace-period removal readiness

Per [boundary doc §7.15](../shared-platform-boundary.md):
- Grep server logs for old-shape session decodes over last 24h.
- If <1% of total decodes: file the removal commit. See §7.15 for scope.
- If >1%: extend contingency to day 14, re-check.

---

## Verified column (fill during deploy)

| # | Item | Verified by | When | Notes |
|---|------|-------------|------|-------|
| 1 | Vercel migration single-run | | | |
| 2 | Schema-first order | | | |
| 3 | SESSION_SECRET sanity | | | |
| 4 | Grace-period date tag | | | |
| 5 | Migration output clean | | | |
| 6 | Drift-check pre-deploy | | | |
| 7 | Session-decode traffic | | | |
| 8 | Admin CRUD dual-write | | | |
| 9 | Password dual-write | | | |
| 10 | listTenants filter | | | |
| 11 | Day-7 removal readiness | | | |
