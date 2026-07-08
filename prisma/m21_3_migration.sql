-- M21.3 migration: per-device session tracking + login history.
--
-- user_sessions is the source of truth for "which cookies are still
-- valid" — every issued session cookie carries a sessionId claim and
-- getSessionUser rejects any cookie whose row is missing or expired.
-- Revoking = deleting the row.
--
-- login_activity is append-only audit — kept separate so revoking a
-- session doesn't erase the audit trail.
--
-- Apply with:
--   npx prisma db execute --file prisma/m21_3_migration.sql --schema prisma/schema.prisma
--
-- Idempotent: all statements guard with IF NOT EXISTS / OR REPLACE. Safe
-- to re-run.

-- ===========================================================================
-- STEP 1: Tables
-- ===========================================================================

CREATE TABLE IF NOT EXISTS "user_sessions" (
  "id"           TEXT PRIMARY KEY,
  "tenantId"     TEXT NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "subjectId"    TEXT NOT NULL,
  "subjectKind"  TEXT NOT NULL,
  "userAgent"    TEXT,
  "ipAddress"    TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastActiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt"    TIMESTAMP(3) NOT NULL
);

CREATE INDEX IF NOT EXISTS "user_sessions_tenantId_subjectId_idx"
  ON "user_sessions"("tenantId", "subjectId");
CREATE INDEX IF NOT EXISTS "user_sessions_expiresAt_idx"
  ON "user_sessions"("expiresAt");

CREATE TABLE IF NOT EXISTS "login_activity" (
  "id"          TEXT PRIMARY KEY,
  "tenantId"    TEXT NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "subjectId"   TEXT NOT NULL,
  "subjectKind" TEXT NOT NULL,
  "userAgent"   TEXT,
  "ipAddress"   TEXT,
  "country"     TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "login_activity_tenantId_subjectId_createdAt_idx"
  ON "login_activity"("tenantId", "subjectId", "createdAt");

-- ===========================================================================
-- STEP 2: RLS
--
-- Both tables are tenant-scoped. A user can only see their own rows —
-- enforced at the app layer since every read is keyed by subjectId, but
-- tenant_isolation is the base guard.
-- ===========================================================================

ALTER TABLE "user_sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user_sessions" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "user_sessions";
CREATE POLICY tenant_isolation ON "user_sessions"
  USING ("tenantId" = app_current_tenant_id());

ALTER TABLE "login_activity" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "login_activity" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "login_activity";
CREATE POLICY tenant_isolation ON "login_activity"
  USING ("tenantId" = app_current_tenant_id());
