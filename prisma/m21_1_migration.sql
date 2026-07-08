-- M21.1 migration: Support-owned user preferences (timezone, language,
-- and reserved theme/density/defaultLanding columns for M21.5).
--
-- Same Set B pattern as SubjectAvatar (Z1.7): wrapper stays identity-only,
-- Support owns UI concerns. Keyed by subjectId (unique across end_users /
-- team_members via Z1.3 preserved-ids).
--
-- Apply with:
--   npx prisma db execute --file prisma/m21_1_migration.sql --schema prisma/schema.prisma
--
-- Idempotent: every statement uses IF NOT EXISTS. Safe to re-run.

CREATE TABLE IF NOT EXISTS "subject_preferences" (
  "subjectId"      TEXT PRIMARY KEY,
  "tenantId"       TEXT NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "timezone"       TEXT,
  "language"       TEXT,
  "theme"          TEXT,
  "density"        TEXT,
  "defaultLanding" TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "subject_preferences_tenantId_idx"
  ON "subject_preferences"("tenantId");

ALTER TABLE "subject_preferences" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "subject_preferences" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "subject_preferences";
CREATE POLICY tenant_isolation ON "subject_preferences"
  USING ("tenantId" = app_current_tenant_id());

DROP POLICY IF EXISTS super_admin_read ON "subject_preferences";
CREATE POLICY super_admin_read ON "subject_preferences"
  FOR SELECT USING (app_current_role() = 'SUPER_ADMIN');
