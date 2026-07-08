-- M21.6 migration: data export + account deletion requests.
--
-- Apply with:
--   npx prisma db execute --file prisma/m21_6_migration.sql --schema prisma/schema.prisma
--
-- Idempotent (IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS "data_export_requests" (
  "id"        TEXT PRIMARY KEY,
  "tenantId"  TEXT NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "subjectId" TEXT NOT NULL,
  "status"    TEXT NOT NULL DEFAULT 'PENDING',
  "payload"   JSONB,
  "expiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "data_export_requests_tenantId_subjectId_idx"
  ON "data_export_requests"("tenantId", "subjectId");

CREATE TABLE IF NOT EXISTS "account_deletion_requests" (
  "id"           TEXT PRIMARY KEY,
  "tenantId"     TEXT NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "subjectId"    TEXT NOT NULL,
  "reason"       TEXT,
  "status"       TEXT NOT NULL DEFAULT 'PENDING',
  "reviewedById" TEXT,
  "reviewedAt"   TIMESTAMP(3),
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "account_deletion_requests_tenantId_status_createdAt_idx"
  ON "account_deletion_requests"("tenantId", "status", "createdAt");

ALTER TABLE "data_export_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "data_export_requests" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "data_export_requests";
CREATE POLICY tenant_isolation ON "data_export_requests"
  USING ("tenantId" = app_current_tenant_id());

ALTER TABLE "account_deletion_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "account_deletion_requests" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "account_deletion_requests";
CREATE POLICY tenant_isolation ON "account_deletion_requests"
  USING ("tenantId" = app_current_tenant_id());
