-- Z2.1 migration: Custom Fields (Support-owned).
--
-- Two tables: definition + polymorphic value. See Z2 spec §3 for the
-- "polymorphic on target, no cross-boundary FK" rationale, and
-- schema.prisma for the model comments.
--
-- Apply with:
--   npx prisma db execute --file prisma/z2_1_migration.sql --schema prisma/schema.prisma
--
-- Idempotent: uses IF NOT EXISTS / DROP-then-CREATE for policies.

-- ===========================================================================
-- STEP 1: Enums
-- ===========================================================================

DO $$ BEGIN
  CREATE TYPE "CustomFieldScope" AS ENUM ('USER', 'ORG', 'TICKET');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "CustomFieldType" AS ENUM ('TEXT', 'NUMBER', 'DATE', 'CHECKBOX');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ===========================================================================
-- STEP 2: Tables
-- ===========================================================================

CREATE TABLE IF NOT EXISTS "custom_field_definitions" (
  "id"          TEXT PRIMARY KEY,
  "tenantId"    TEXT NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "scope"       "CustomFieldScope" NOT NULL,
  "type"        "CustomFieldType"  NOT NULL,
  "key"         TEXT NOT NULL,
  "label"       TEXT NOT NULL,
  "description" TEXT,
  "isActive"    BOOLEAN NOT NULL DEFAULT true,
  "isRequired"  BOOLEAN NOT NULL DEFAULT false,
  "position"    INTEGER NOT NULL DEFAULT 0,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "custom_field_definitions_tenantId_scope_key_key"
  ON "custom_field_definitions"("tenantId", "scope", "key");
CREATE INDEX IF NOT EXISTS "custom_field_definitions_tenantId_scope_isActive_idx"
  ON "custom_field_definitions"("tenantId", "scope", "isActive");

CREATE TABLE IF NOT EXISTS "custom_field_values" (
  "id"                TEXT PRIMARY KEY,
  "tenantId"          TEXT NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "fieldDefinitionId" TEXT NOT NULL REFERENCES "custom_field_definitions"("id") ON DELETE CASCADE,
  "targetType"        "CustomFieldScope" NOT NULL,
  "targetId"          TEXT NOT NULL,
  "valueText"         TEXT,
  "valueNumber"       DECIMAL(20, 6),
  "valueDate"         TIMESTAMP(3),
  "valueBoolean"      BOOLEAN,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "custom_field_values_fieldDefinitionId_targetId_key"
  ON "custom_field_values"("fieldDefinitionId", "targetId");
CREATE INDEX IF NOT EXISTS "custom_field_values_tenantId_targetType_targetId_idx"
  ON "custom_field_values"("tenantId", "targetType", "targetId");

-- Exactly one value* column populated (Z2.1: text/number/date/checkbox).
-- Kept permissive on multi-select for Z2.2 by widening later, not now.
ALTER TABLE "custom_field_values"
  DROP CONSTRAINT IF EXISTS "custom_field_values_exactly_one_value";
ALTER TABLE "custom_field_values"
  ADD CONSTRAINT "custom_field_values_exactly_one_value"
  CHECK (num_nonnulls("valueText", "valueNumber", "valueDate", "valueBoolean") = 1);

-- ===========================================================================
-- STEP 3: RLS
--
-- tenant_isolation: same shape as other Support-owned tables. Writes are
-- gated at the action layer to staff (AGENT+) — RLS blocks cross-tenant
-- access; the app blocks end-user access. Per Z2 spec §3: end users must
-- not see custom fields, enforced server-side.
-- ===========================================================================

ALTER TABLE "custom_field_definitions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "custom_field_definitions" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "custom_field_definitions";
CREATE POLICY tenant_isolation ON "custom_field_definitions"
  USING ("tenantId" = app_current_tenant_id());

DROP POLICY IF EXISTS super_admin_read ON "custom_field_definitions";
CREATE POLICY super_admin_read ON "custom_field_definitions"
  FOR SELECT USING (app_current_role() = 'SUPER_ADMIN');

ALTER TABLE "custom_field_values" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "custom_field_values" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "custom_field_values";
CREATE POLICY tenant_isolation ON "custom_field_values"
  USING ("tenantId" = app_current_tenant_id());

DROP POLICY IF EXISTS super_admin_read ON "custom_field_values";
CREATE POLICY super_admin_read ON "custom_field_values"
  FOR SELECT USING (app_current_role() = 'SUPER_ADMIN');
