-- M21.4 migration: notification preferences + daily-digest queue.
--
-- notification_preferences: one row per subject; each column is one
-- toggleable event. All default TRUE so behaviour pre-M21.4 is preserved
-- for users who never touch the tab.
--
-- digest_queue: rows accumulate for subjects whose digestMode is DAILY;
-- the daily-digest Inngest job drains them into a single summary email.
--
-- Apply with:
--   npx prisma db execute --file prisma/m21_4_migration.sql --schema prisma/schema.prisma
--
-- Idempotent: guards with IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS "notification_preferences" (
  "subjectId"          TEXT PRIMARY KEY,
  "tenantId"           TEXT NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "emailTicketCreated" BOOLEAN NOT NULL DEFAULT TRUE,
  "emailTicketReply"   BOOLEAN NOT NULL DEFAULT TRUE,
  "emailStatusChange"  BOOLEAN NOT NULL DEFAULT TRUE,
  "emailAssigned"      BOOLEAN NOT NULL DEFAULT TRUE,
  "emailCsatRequest"   BOOLEAN NOT NULL DEFAULT TRUE,
  "inAppTicketReply"   BOOLEAN NOT NULL DEFAULT TRUE,
  "inAppStatusChange"  BOOLEAN NOT NULL DEFAULT TRUE,
  "inAppAssigned"      BOOLEAN NOT NULL DEFAULT TRUE,
  "digestMode"         TEXT NOT NULL DEFAULT 'INSTANT',
  "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "notification_preferences_tenantId_idx"
  ON "notification_preferences"("tenantId");

CREATE TABLE IF NOT EXISTS "digest_queue" (
  "id"        TEXT PRIMARY KEY,
  "tenantId"  TEXT NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "subjectId" TEXT NOT NULL,
  "eventKey"  TEXT NOT NULL,
  "subject"   TEXT NOT NULL,
  "body"      TEXT NOT NULL,
  "ticketRef" TEXT,
  "ticketUrl" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "digest_queue_tenantId_subjectId_createdAt_idx"
  ON "digest_queue"("tenantId", "subjectId", "createdAt");

ALTER TABLE "notification_preferences" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notification_preferences" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "notification_preferences";
CREATE POLICY tenant_isolation ON "notification_preferences"
  USING ("tenantId" = app_current_tenant_id());

ALTER TABLE "digest_queue" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "digest_queue" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "digest_queue";
CREATE POLICY tenant_isolation ON "digest_queue"
  USING ("tenantId" = app_current_tenant_id());
