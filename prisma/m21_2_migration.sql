-- M21.2 migration: password-gated email change.
--
-- Adds Support-side pending-email columns to AuthCredential. The wrapper
-- email column stays authoritative for identity; nothing outside this
-- flow reads pendingEmail. `pendingEmailRequestedAt` is stored so future
-- audit/expiry work (or a follow-up "resend confirmation") can see the
-- timing without decoding the JWT.
--
-- Apply with:
--   npx prisma db execute --file prisma/m21_2_migration.sql --schema prisma/schema.prisma
--
-- Idempotent: ADD COLUMN IF NOT EXISTS. Safe to re-run.

ALTER TABLE "auth_credentials"
  ADD COLUMN IF NOT EXISTS "pendingEmail"            TEXT,
  ADD COLUMN IF NOT EXISTS "pendingEmailRequestedAt" TIMESTAMP(3);
