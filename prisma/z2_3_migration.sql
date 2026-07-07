-- Z2.3 migration: Ticket Forms + form-field membership + category pinning.
-- Also folds in the two Z2.4 conditional-visibility columns since they
-- live on the same table.
--
-- Apply with:
--   npx prisma db execute --file prisma/z2_3_migration.sql --schema prisma/schema.prisma

-- ===========================================================================
-- STEP 1: Tables
-- ===========================================================================

CREATE TABLE IF NOT EXISTS "ticket_forms" (
  "id"          TEXT PRIMARY KEY,
  "tenantId"    TEXT NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "name"        TEXT NOT NULL,
  "description" TEXT,
  "isActive"    BOOLEAN NOT NULL DEFAULT true,
  "position"    INTEGER NOT NULL DEFAULT 0,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "ticket_forms_tenantId_isActive_idx"
  ON "ticket_forms"("tenantId", "isActive");

CREATE TABLE IF NOT EXISTS "ticket_form_fields" (
  "id"                 TEXT PRIMARY KEY,
  "tenantId"           TEXT NOT NULL,
  "ticketFormId"       TEXT NOT NULL REFERENCES "ticket_forms"("id") ON DELETE CASCADE,
  "fieldDefinitionId"  TEXT NOT NULL REFERENCES "custom_field_definitions"("id") ON DELETE CASCADE,
  "position"           INTEGER NOT NULL DEFAULT 0,
  "isRequiredOverride" BOOLEAN,
  "visibleWhenFieldId" TEXT,
  "visibleWhenValue"   TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS "ticket_form_fields_ticketFormId_fieldDefinitionId_key"
  ON "ticket_form_fields"("ticketFormId", "fieldDefinitionId");
CREATE INDEX IF NOT EXISTS "ticket_form_fields_tenantId_idx"
  ON "ticket_form_fields"("tenantId");
CREATE INDEX IF NOT EXISTS "ticket_form_fields_ticketFormId_position_idx"
  ON "ticket_form_fields"("ticketFormId", "position");

CREATE TABLE IF NOT EXISTS "ticket_form_categories" (
  "ticketFormId" TEXT NOT NULL REFERENCES "ticket_forms"("id") ON DELETE CASCADE,
  "categoryId"   TEXT NOT NULL REFERENCES "categories"("id") ON DELETE CASCADE,
  "tenantId"     TEXT NOT NULL,
  PRIMARY KEY ("ticketFormId", "categoryId")
);

CREATE INDEX IF NOT EXISTS "ticket_form_categories_tenantId_categoryId_idx"
  ON "ticket_form_categories"("tenantId", "categoryId");

-- ===========================================================================
-- STEP 2: Ticket.ticketFormId
-- ===========================================================================

ALTER TABLE "tickets"
  ADD COLUMN IF NOT EXISTS "ticketFormId" TEXT REFERENCES "ticket_forms"("id") ON DELETE SET NULL;

-- ===========================================================================
-- STEP 3: RLS
-- ===========================================================================

ALTER TABLE "ticket_forms" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ticket_forms" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "ticket_forms";
CREATE POLICY tenant_isolation ON "ticket_forms"
  USING ("tenantId" = app_current_tenant_id());

DROP POLICY IF EXISTS super_admin_read ON "ticket_forms";
CREATE POLICY super_admin_read ON "ticket_forms"
  FOR SELECT USING (app_current_role() = 'SUPER_ADMIN');

ALTER TABLE "ticket_form_fields" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ticket_form_fields" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "ticket_form_fields";
CREATE POLICY tenant_isolation ON "ticket_form_fields"
  USING ("tenantId" = app_current_tenant_id());

DROP POLICY IF EXISTS super_admin_read ON "ticket_form_fields";
CREATE POLICY super_admin_read ON "ticket_form_fields"
  FOR SELECT USING (app_current_role() = 'SUPER_ADMIN');

ALTER TABLE "ticket_form_categories" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ticket_form_categories" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "ticket_form_categories";
CREATE POLICY tenant_isolation ON "ticket_form_categories"
  USING ("tenantId" = app_current_tenant_id());

DROP POLICY IF EXISTS super_admin_read ON "ticket_form_categories";
CREATE POLICY super_admin_read ON "ticket_form_categories"
  FOR SELECT USING (app_current_role() = 'SUPER_ADMIN');
