# scripts/

One-off and operational Node scripts (`.mjs`, run with `node --env-file=.env`).
None are part of the app runtime — they're setup, migration, QA, and
verification helpers. `psql` is not available in this repo, so anything that
touches Postgres directly goes through `pg` or the generated Prisma client.

## Setup / operational

| Script | Purpose |
|---|---|
| `create-app-runtime-role.mjs` | One-time: creates the least-privileged `app_runtime` Postgres role (no BYPASSRLS) and writes `APP_DATABASE_URL` / `APP_DIRECT_URL` to `.env`. This is what makes RLS a real backstop — see [AGENTS.md](../AGENTS.md) "Row-Level Security". |
| `apply-rls.mjs` | Applies `prisma/rls_policies.sql`. Run after every `prisma db push` (Prisma does not manage RLS). `npm run db:rls`. |
| `local-pg-server.mjs` | Boots a local PGlite server for `dev:local-db`. |
| `pull-shared-core.mjs` | Diffs this repo's mirrored core models against Shared Platform. `npm run pull-core`. |
| `reset_qa_super_password.mjs` | Resets the QA super-admin login (`qa-super@stralis-qa.test`) for local browser testing. |

## QA / verification

| Script | Purpose |
|---|---|
| `qa_full_rls_audit.mjs` | **Tenant-isolation gate.** For every table with a `tenantId` column: checks RLS is enabled + has a policy (metadata, via the owner connection) and that a bogus-tenant `app_runtime` session sees 0 rows (functional). Fails on any missing RLS or cross-tenant leak. Run after adding any tenant-scoped table. |
| `qa_rls_check.mjs` | Narrow RLS spot-check for the SLA tables (`sla_policies`, `business_calendars`, `ticket_slas`). |
| `qa_apply_sla_rls_fix.mjs` | Historical: applied a targeted SLA-table RLS fix. |
| `qa_seed_tenant.mjs` | Seeds a QA tenant with representative data. |
| `qa_phase2_probes.mjs`, `qa_phase2_behavior.mjs`, `qa_phase3_integration.mjs` | QA-phase behavioral / integration probes. |
| `z8_cross_tenant_test.mjs` | Z8 rule-engine cross-tenant isolation smoke test. |
| `m3_routing_test.mjs`, `m5_csat_test.mjs` | Milestone smoke tests (routing, CSAT). |

## Z1 wrapper migration (historical, one-shot)

`z1_3_backfill.mjs`, `z1_4_dryrun.mjs`, `z1_4a_smoke.mjs`, `z1_4a_verify.mjs`,
`z1_6_drift_check.mjs`, `z1_8_migrate.mjs`, `z1_8_staging_tenant.mjs` — steps of
the Z1 legacy-User/Company → Shared-Platform-wrapper migration. Kept for
reference and re-runnable dry-runs; not part of routine operation.

## Conventions

- Always invoke with `node --env-file=.env scripts/<name>.mjs` so the DB URLs load.
- Anything that reads/writes tenant data as the app would should go through the
  `app_runtime` connection (`APP_DATABASE_URL`), not the migration-owning role,
  or it silently bypasses RLS and proves nothing.
