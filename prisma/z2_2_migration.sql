-- Z2.2 migration: dropdown + multiselect + option storage.
--
-- Extends the Z2.1 tables with:
--   * Two new CustomFieldType enum values (DROPDOWN, MULTISELECT)
--   * New custom_field_options table (per-definition, ordered, immutable value)
--   * Two new value columns on custom_field_values (single + multi)
--   * Rewrites the "exactly one value" CHECK to include them
--
-- Apply with:
--   npx prisma db execute --file prisma/z2_2_migration.sql --schema prisma/schema.prisma
--
-- Idempotent.

-- ===========================================================================
-- STEP 1: Enum extensions
-- ===========================================================================

DO $$ BEGIN
  ALTER TYPE "CustomFieldType" ADD VALUE IF NOT EXISTS 'DROPDOWN';
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TYPE "CustomFieldType" ADD VALUE IF NOT EXISTS 'MULTISELECT';
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ===========================================================================
-- STEP 2: Options table
-- ===========================================================================

CREATE TABLE IF NOT EXISTS "custom_field_options" (
  "id"                TEXT PRIMARY KEY,
  "tenantId"          TEXT NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "fieldDefinitionId" TEXT NOT NULL REFERENCES "custom_field_definitions"("id") ON DELETE CASCADE,
  "value"             TEXT NOT NULL,
  "label"             TEXT NOT NULL,
  "position"          INTEGER NOT NULL DEFAULT 0,
  "implicitTag"       TEXT,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "custom_field_options_fieldDefinitionId_value_key"
  ON "custom_field_options"("fieldDefinitionId", "value");
CREATE INDEX IF NOT EXISTS "custom_field_options_tenantId_idx"
  ON "custom_field_options"("tenantId");
CREATE INDEX IF NOT EXISTS "custom_field_options_fieldDefinitionId_position_idx"
  ON "custom_field_options"("fieldDefinitionId", "position");

-- ===========================================================================
-- STEP 3: New value columns + CHECK rewrite
-- ===========================================================================

ALTER TABLE "custom_field_values"
  ADD COLUMN IF NOT EXISTS "valueOptionId" TEXT;

ALTER TABLE "custom_field_values"
  ADD COLUMN IF NOT EXISTS "valueOptionIds" TEXT[] NOT NULL DEFAULT '{}';

-- Widen the exactly-one CHECK to include the new columns. Multiselect
-- counts as "set" only when it has at least one element — empty array is
-- treated the same as NULL, so a TEXT row with default `{}` doesn't
-- collide.
ALTER TABLE "custom_field_values"
  DROP CONSTRAINT IF EXISTS "custom_field_values_exactly_one_value";
ALTER TABLE "custom_field_values"
  ADD CONSTRAINT "custom_field_values_exactly_one_value"
  CHECK (
    ("valueText" IS NOT NULL)::int
    + ("valueNumber" IS NOT NULL)::int
    + ("valueDate" IS NOT NULL)::int
    + ("valueBoolean" IS NOT NULL)::int
    + ("valueOptionId" IS NOT NULL)::int
    + (array_length("valueOptionIds", 1) IS NOT NULL)::int
    = 1
  );

-- ===========================================================================
-- STEP 4: RLS on the options table
-- ===========================================================================

ALTER TABLE "custom_field_options" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "custom_field_options" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "custom_field_options";
CREATE POLICY tenant_isolation ON "custom_field_options"
  USING ("tenantId" = app_current_tenant_id());

DROP POLICY IF EXISTS super_admin_read ON "custom_field_options";
CREATE POLICY super_admin_read ON "custom_field_options"
  FOR SELECT USING (app_current_role() = 'SUPER_ADMIN');
