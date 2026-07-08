-- Z4 migration: Support-owned organization sidecar.
--
-- Rationale: docs/shared-platform-boundary.md §3 forbids adding columns to
-- wrapper Organization. Notes, and future SLA/business-hours override
-- ids, live on this Support-side row keyed by organizationId. Same Set B
-- precedent as SubjectAvatar / *Lifecycle.
--
-- Apply with:
--   npx prisma db execute --file prisma/z4_migration.sql --schema prisma/schema.prisma
--
-- Idempotent: every statement uses IF NOT EXISTS / OR REPLACE.

-- ===========================================================================
-- STEP 1: Table
-- ===========================================================================

CREATE TABLE IF NOT EXISTS "organization_settings" (
  "organizationId"  TEXT PRIMARY KEY,
  "tenantId"        TEXT NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "notes"           TEXT,
  "slaPolicyId"     TEXT,
  "businessHoursId" TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "organization_settings_tenantId_idx"
  ON "organization_settings"("tenantId");

-- ===========================================================================
-- STEP 2: RLS
-- ===========================================================================

ALTER TABLE "organization_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "organization_settings" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "organization_settings";
CREATE POLICY tenant_isolation ON "organization_settings"
  USING ("tenantId" = app_current_tenant_id());

DROP POLICY IF EXISTS super_admin_read ON "organization_settings";
CREATE POLICY super_admin_read ON "organization_settings"
  FOR SELECT USING (app_current_role() = 'SUPER_ADMIN');
