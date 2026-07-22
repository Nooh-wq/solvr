-- QA Phase 3 fix — enable RLS on sla_policies.
--
-- The M2 migration file (prisma/m2_migration.sql) both ENABLEd and
-- FORCEd RLS and defined a tenant_isolation policy. On this database
-- FORCE + the policy are present, but ENABLE is missing — so the
-- policy is dormant. Every sla_policies read/write is currently
-- constrained only by explicit `tenantId` clauses in the app layer
-- (verified: src/lib/sla-engine.ts, src/actions/sla.ts,
-- src/actions/organizations.ts). No live cross-tenant leak observed,
-- but the safety net is off. This restores it.
--
-- Idempotent: ENABLE is a no-op if already on. `business_calendars`
-- and `ticket_slas` are already correctly enabled per the pg_class
-- snapshot taken during Phase 3 (scripts/qa_rls_check.mjs).

alter table sla_policies enable row level security;
