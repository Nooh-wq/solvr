-- Z1.7 migration: Support-owned avatar store.
--
-- Rationale: docs/shared-platform-boundary.md §7.10 documents avatarUrl
-- as post-Z1.5 cross-repo work with the Shared Platform. Shipping it
-- via a Support-owned SubjectAvatar table (same Set B precedent as
-- AuthCredential and *Lifecycle — Support owns UI/auth concerns; wrapper
-- stays identity-only) unblocks Z1.7 without any Shared Platform change.
-- If Shared Platform later introduces its own avatar/preferences surface,
-- this table backfills there in one query keyed on subjectId.
--
-- Apply with:
--   npx prisma db execute --file prisma/z1_7_migration.sql --schema prisma/schema.prisma
--
-- Idempotent: every statement uses IF NOT EXISTS / OR REPLACE. Safe to re-run.

-- ===========================================================================
-- STEP 1: Table
-- ===========================================================================

CREATE TABLE IF NOT EXISTS "subject_avatars" (
  "subjectId" TEXT PRIMARY KEY,
  "tenantId"  TEXT NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "avatarUrl" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "subject_avatars_tenantId_idx"
  ON "subject_avatars"("tenantId");

-- ===========================================================================
-- STEP 2: RLS
--
-- tenant_isolation for reads/writes. No role-restriction: any authenticated
-- session in the tenant may read every avatar (they're displayed on every
-- ticket/message/notification) and only ever writes their own (enforced at
-- the app layer, since a session's subjectId is the only value that can be
-- written by profile.ts's uploadProfilePicture).
-- ===========================================================================

ALTER TABLE "subject_avatars" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "subject_avatars" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "subject_avatars";
CREATE POLICY tenant_isolation ON "subject_avatars"
  USING ("tenantId" = app_current_tenant_id());

-- SUPER_ADMIN cross-tenant read for the tenant-health surface — same
-- carve-out as tenant/tenant_branding/categories.
DROP POLICY IF EXISTS super_admin_read ON "subject_avatars";
CREATE POLICY super_admin_read ON "subject_avatars"
  FOR SELECT USING (app_current_role() = 'SUPER_ADMIN');
