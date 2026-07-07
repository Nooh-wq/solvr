-- Z1.5c migration: drop the legacy User/Company tables + LegacyRole enum
-- + every remaining legacy singular-FK column across the Support-owned
-- transition tables. Tightens/expands the remaining CHECK constraints
-- to their post-Z1.5 forms.
--
-- Runs against Support's Supabase DB (the shared physical DB — see
-- docs/shared-platform-boundary.md). Idempotent: every DROP uses
-- IF EXISTS. Safe to re-run.
--
-- Apply with:
--   npx prisma db execute --file prisma/z1_5c_migration.sql --schema prisma/schema.prisma
--
-- Scope:
--   1. Drop legacy scalar FK columns from 9 transition tables. Indexes
--      pinned to those columns drop with them.
--   2. Drop tables `users` and `companies` (cascades their remaining
--      FK dependents from *within* the two tables themselves — nothing
--      outside them points at them anymore after step 1).
--   3. Drop DB enum type "Role" (was mapped from Prisma `LegacyRole`).
--   4. Add DB-level presence CHECKs where the wrapper column pair must
--      have exactly one non-null (notifications, login_otps). The
--      exclusivity CHECKs added by Z1.4a (num_nonnulls(pair) <= 1) stay
--      as-is on all six pairs and now co-enforce single-column presence.

-- ===========================================================================
-- STEP 0: Drop RLS policies that reference the legacy columns/tables
--
-- Postgres blocks DROP COLUMN when a policy references the column. Drop
-- everything by name (idempotent); STEP 5 re-runs rls_policies.sql to
-- recreate the Z1.5c-shape policies against the dual-FK columns.
-- ===========================================================================

DROP POLICY IF EXISTS client_sees_own_tickets ON tickets;
DROP POLICY IF EXISTS ticket_guest_write ON ticket_guests;
DROP POLICY IF EXISTS ticket_guest_revoke ON ticket_guests;
DROP POLICY IF EXISTS login_otp_read ON login_otps;
DROP POLICY IF EXISTS login_otp_insert ON login_otps;
DROP POLICY IF EXISTS login_otp_update ON login_otps;
DROP POLICY IF EXISTS audit_log_read ON audit_logs;
DROP POLICY IF EXISTS notification_read ON notifications;
DROP POLICY IF EXISTS notification_update ON notifications;

-- ===========================================================================
-- STEP 1: Drop legacy scalar FK columns
-- ===========================================================================

ALTER TABLE "tickets"
  DROP COLUMN IF EXISTS "clientId",
  DROP COLUMN IF EXISTS "assignedToId";

ALTER TABLE "messages"
  DROP COLUMN IF EXISTS "senderId";

ALTER TABLE "attachments"
  DROP COLUMN IF EXISTS "uploadedById";

ALTER TABLE "ticket_guests"
  DROP COLUMN IF EXISTS "invitedById";

ALTER TABLE "audit_logs"
  DROP COLUMN IF EXISTS "actorId";

ALTER TABLE "notifications"
  DROP COLUMN IF EXISTS "userId";

ALTER TABLE "login_otps"
  DROP COLUMN IF EXISTS "userId";

ALTER TABLE "chat_conversations"
  DROP COLUMN IF EXISTS "userId";

-- Any stale indexes tied to the dropped columns (Postgres auto-drops
-- indexes whose columns disappear, but the named-index scaffold from
-- earlier phases is expressed explicitly so the intent is auditable).
DROP INDEX IF EXISTS "tenants_users_id_idx";
DROP INDEX IF EXISTS "notifications_tenantId_userId_isRead_createdAt_idx";
DROP INDEX IF EXISTS "login_otps_userId_idx";

-- New role-aware notification indexes matching the schema.prisma post-Z1.5c
-- shape (the bell dropdown queries by recipientEndUserId OR
-- recipientTeamMemberId + isRead + createdAt).
CREATE INDEX IF NOT EXISTS "notifications_tenantId_recipientEndUserId_isRead_createdAt_idx"
  ON "notifications"("tenantId", "recipientEndUserId", "isRead", "createdAt");
CREATE INDEX IF NOT EXISTS "notifications_tenantId_recipientTeamMemberId_isRead_createdAt_idx"
  ON "notifications"("tenantId", "recipientTeamMemberId", "isRead", "createdAt");

-- ===========================================================================
-- STEP 2: Drop legacy tables
--
-- users had FK dependents (Tickets.client/assignedTo, Messages.sender,
-- Attachments.uploadedBy, TicketGuests.invitedBy, AuditLogs.actor,
-- Notifications.user, ChatConversations.user, LoginOtps.user) — all of
-- those FK columns were dropped in step 1, so this drop has no dependent
-- rows to cascade against.
-- companies had one FK dependent (users.companyId) — since users itself
-- is now gone, no dependents remain.
-- ===========================================================================

DROP TABLE IF EXISTS "users" CASCADE;
DROP TABLE IF EXISTS "companies" CASCADE;

-- ===========================================================================
-- STEP 3: Drop the legacy DB enum type "Role"
--
-- Prisma's `LegacyRole` enum @@map("Role") — the DB-side type name is "Role".
-- The wrapper's `Role` MODEL is a table @@map("roles"), so there's no
-- name collision at drop time (they're different Postgres object kinds
-- with case-distinct names).
-- ===========================================================================

DROP TYPE IF EXISTS "Role";

-- ===========================================================================
-- STEP 4: Presence CHECKs on notifications + login_otps
--
-- These two tables had a NOT NULL legacy `userId` up until Z1.5c. With
-- that column gone, we assert at the DB level that at least one of the
-- dual-FK columns is populated — the app now writes those two columns
-- for every real row.
-- ===========================================================================

ALTER TABLE "notifications" DROP CONSTRAINT IF EXISTS "notifications_recipient_present";
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_present"
  CHECK (num_nonnulls("recipientEndUserId", "recipientTeamMemberId") >= 1);

ALTER TABLE "login_otps" DROP CONSTRAINT IF EXISTS "login_otps_subject_present";
ALTER TABLE "login_otps" ADD CONSTRAINT "login_otps_subject_present"
  CHECK (num_nonnulls("endUserId", "teamMemberId") >= 1);
