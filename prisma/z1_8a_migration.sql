-- Z1.8a migration: Support-owned auth + lifecycle tables (Set B per ADR-001).
--
-- Runs against Support's Supabase DB (the shared physical DB — see
-- docs/shared-platform-boundary.md). Idempotent: every CREATE uses
-- IF NOT EXISTS; every INSERT uses NOT EXISTS guard or ON CONFLICT DO NOTHING.
-- Safe to re-run.
--
-- Apply with:
--   npx prisma db execute --file prisma/z1_8a_migration.sql --schema prisma/schema.prisma
--
-- Scope:
--   1. Create three new Support-owned tables (auth_credentials,
--      team_member_lifecycle, end_user_lifecycle).
--   2. Add indexes (tenant + subject/status).
--   3. Add CHECK constraint on auth_credentials (exactly one subject FK
--      non-null per row).
--   4. Backfill from legacy users, split by role (staff → team_member_*,
--      client → end_user_*). Preserves ids from Z1.3 for lifecycle tables;
--      auth_credentials.id is fresh cuid (not preserved).
--
-- What this migration does NOT do:
--   - Doesn't drop or modify any legacy column. Legacy users.passwordHash,
--     users.status, and all lifecycle timestamp columns stay authoritative
--     through Z1.5.
--   - Doesn't add cross-boundary SQL foreign keys to end_users/team_members.
--     Matches Z1.4a/Z1.1b precedent — raw scalar columns, enforcement via
--     CHECK constraint on auth_credentials and via single-column PK on the
--     lifecycle tables. Cascade ownership stays on the wrapper's team.
--   - Doesn't touch the LegacyRole enum or any other enum. Z1.6's @@map("Role")
--     fix stays in place.
--
-- Drift-check convention:
--   auth_credentials.id is a fresh cuid (not preserved from legacy users.id).
--   Match to legacy users is via subjectEndUserId (for CLIENT users) or
--   subjectTeamMemberId (for staff), NOT via direct id comparison. Both
--   subject_* columns ARE preserved from Z1.3, so the lookup is 1:1.
--   The scripts/z1_8_drift_check.mjs script uses this convention explicitly.

-- ===========================================================================
-- STEP 1: Create tables
-- ===========================================================================

CREATE TABLE IF NOT EXISTS "auth_credentials" (
  "id"                     TEXT PRIMARY KEY,
  "tenantId"               TEXT NOT NULL,
  "subjectEndUserId"       TEXT,
  "subjectTeamMemberId"    TEXT,
  "passwordHash"           TEXT NOT NULL,
  "passwordChangedAt"      TIMESTAMP(3),
  "mfaSecret"              TEXT,
  "createdAt"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"              TIMESTAMP(3) NOT NULL,
  CONSTRAINT "auth_credentials_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "team_member_lifecycle" (
  "subjectId"       TEXT PRIMARY KEY,
  "tenantId"        TEXT NOT NULL,
  "status"          "UserStatus" NOT NULL,
  "invitedAt"       TIMESTAMP(3),
  "invitedById"     TEXT,
  "approvedAt"      TIMESTAMP(3),
  "approvedById"    TEXT,
  "rejectedAt"      TIMESTAMP(3),
  "rejectedById"    TEXT,
  "lastActiveAt"    TIMESTAMP(3),
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,
  CONSTRAINT "team_member_lifecycle_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "end_user_lifecycle" (
  "subjectId"       TEXT PRIMARY KEY,
  "tenantId"        TEXT NOT NULL,
  "status"          "UserStatus" NOT NULL,
  "invitedAt"       TIMESTAMP(3),
  "invitedById"     TEXT,
  "approvedAt"      TIMESTAMP(3),
  "approvedById"    TEXT,
  "rejectedAt"      TIMESTAMP(3),
  "rejectedById"    TEXT,
  "lastActiveAt"    TIMESTAMP(3),
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,
  CONSTRAINT "end_user_lifecycle_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE
);

-- ===========================================================================
-- STEP 2: Indexes
-- ===========================================================================

CREATE INDEX IF NOT EXISTS "auth_credentials_tenantId_subjectEndUserId_idx"
  ON "auth_credentials"("tenantId", "subjectEndUserId");
CREATE INDEX IF NOT EXISTS "auth_credentials_tenantId_subjectTeamMemberId_idx"
  ON "auth_credentials"("tenantId", "subjectTeamMemberId");

CREATE INDEX IF NOT EXISTS "team_member_lifecycle_tenantId_status_idx"
  ON "team_member_lifecycle"("tenantId", "status");

CREATE INDEX IF NOT EXISTS "end_user_lifecycle_tenantId_status_idx"
  ON "end_user_lifecycle"("tenantId", "status");

-- ===========================================================================
-- STEP 3: CHECK constraint on auth_credentials
-- ===========================================================================
--
-- Exactly one subject FK non-null per row. Unlike Z1.4a's dual-FK CHECKs
-- (which use <= 1 to permit SYSTEM/BOT rows with no author), auth_credentials
-- has no null-subject legitimate case — every credential belongs to exactly
-- one subject.
--
-- Wrapped in DO block for idempotency (ADD CONSTRAINT IF NOT EXISTS isn't
-- supported in Postgres). Safe to re-run.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'auth_credentials_subject_exclusive'
  ) THEN
    ALTER TABLE "auth_credentials" ADD CONSTRAINT "auth_credentials_subject_exclusive"
      CHECK (num_nonnulls("subjectEndUserId", "subjectTeamMemberId") = 1);
  END IF;
END $$;

-- ===========================================================================
-- STEP 4: Backfill auth_credentials — staff branch (legacy role != CLIENT)
-- ===========================================================================

INSERT INTO "auth_credentials" (
  "id", "tenantId", "subjectTeamMemberId", "passwordHash",
  "passwordChangedAt", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid()::TEXT,
  u."tenantId",
  u."id",
  u."passwordHash",
  u."passwordChangedAt",
  NOW(),
  NOW()
FROM "users" u
WHERE u."role" != 'CLIENT'
  AND NOT EXISTS (
    SELECT 1 FROM "auth_credentials" ac
    WHERE ac."subjectTeamMemberId" = u."id"
  );

-- ===========================================================================
-- STEP 5: Backfill auth_credentials — client branch (legacy role = CLIENT)
-- ===========================================================================

INSERT INTO "auth_credentials" (
  "id", "tenantId", "subjectEndUserId", "passwordHash",
  "passwordChangedAt", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid()::TEXT,
  u."tenantId",
  u."id",
  u."passwordHash",
  u."passwordChangedAt",
  NOW(),
  NOW()
FROM "users" u
WHERE u."role" = 'CLIENT'
  AND NOT EXISTS (
    SELECT 1 FROM "auth_credentials" ac
    WHERE ac."subjectEndUserId" = u."id"
  );

-- ===========================================================================
-- STEP 6: Backfill team_member_lifecycle (preserved-id from Z1.3)
-- ===========================================================================

INSERT INTO "team_member_lifecycle" (
  "subjectId", "tenantId", "status",
  "invitedAt", "invitedById", "approvedAt", "approvedById",
  "rejectedAt", "rejectedById", "lastActiveAt",
  "createdAt", "updatedAt"
)
SELECT
  u."id",
  u."tenantId",
  u."status",
  u."invitedAt",
  u."invitedById",
  u."approvedAt",
  u."approvedById",
  u."rejectedAt",
  u."rejectedById",
  u."lastActiveAt",
  NOW(),
  NOW()
FROM "users" u
WHERE u."role" != 'CLIENT'
ON CONFLICT ("subjectId") DO NOTHING;

-- ===========================================================================
-- STEP 7: Backfill end_user_lifecycle (preserved-id from Z1.3)
-- ===========================================================================

INSERT INTO "end_user_lifecycle" (
  "subjectId", "tenantId", "status",
  "invitedAt", "invitedById", "approvedAt", "approvedById",
  "rejectedAt", "rejectedById", "lastActiveAt",
  "createdAt", "updatedAt"
)
SELECT
  u."id",
  u."tenantId",
  u."status",
  u."invitedAt",
  u."invitedById",
  u."approvedAt",
  u."approvedById",
  u."rejectedAt",
  u."rejectedById",
  u."lastActiveAt",
  NOW(),
  NOW()
FROM "users" u
WHERE u."role" = 'CLIENT'
ON CONFLICT ("subjectId") DO NOTHING;

-- ===========================================================================
-- Projected row counts (verified against current DB state at design time):
--   auth_credentials:      19 rows  (11 staff + 8 client)
--   team_member_lifecycle: 11 rows
--   end_user_lifecycle:     8 rows
-- Total: 38 rows across three tables. Backfill duration trivial at this scale.
-- ===========================================================================
