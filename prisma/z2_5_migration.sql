-- Z2.5 migration: Lookup fields.
--
-- Extend the enum, add valueLookupId, rewrite the exactly-one CHECK to
-- include the new column.
--
-- Apply with:
--   npx prisma db execute --file prisma/z2_5_migration.sql --schema prisma/schema.prisma

DO $$ BEGIN
  ALTER TYPE "CustomFieldType" ADD VALUE IF NOT EXISTS 'USER_LOOKUP';
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TYPE "CustomFieldType" ADD VALUE IF NOT EXISTS 'ORG_LOOKUP';
EXCEPTION WHEN duplicate_object THEN null; END $$;

ALTER TABLE "custom_field_values"
  ADD COLUMN IF NOT EXISTS "valueLookupId" TEXT;

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
    + ("valueLookupId" IS NOT NULL)::int
    = 1
  );
