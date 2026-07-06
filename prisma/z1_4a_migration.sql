-- Z1.4a migration: dual-FK columns + tightened CHECKs + backfill for the
-- Support-owned tables that reference the legacy User/Company today.
--
-- Runs against Support's Supabase DB (the shared physical DB — see
-- docs/shared-platform-boundary.md). Idempotent: every statement uses
-- IF NOT EXISTS / DROP + ADD, safe to re-run.
--
-- Apply with:
--   npx prisma db execute --file prisma/z1_4a_migration.sql --schema prisma/schema.prisma
--
-- Scope:
--   1. Add nullable dual-FK columns to 6 tables (tickets, attachments,
--      ticket_guests, login_otps, notifications, chat_conversations) —
--      the 5 in boundary doc §7.1 + tickets (per Employee-Service-Suite
--      decision, see §7.7).
--   2. Add per-tenant indexes on each new column pair.
--   3. Backfill every new column from the corresponding legacy FK via a
--      join to users (or users → companies for tickets.organizationId).
--      Keyed on preserved ids from Z1.3, so this is a straight column-
--      level rewrite — no lookup table needed.
--   4. Add num_nonnulls(newEU, newTM) <= 1 CHECK constraints for each
--      new pair (across NEW columns only, not including legacy — the
--      legacy column stays populated during Z1.4a→Z1.5).
--   5. Tighten the Z1.1b-era CHECKs on messages/audit_logs to also
--      exclude the legacy column from their arg lists. This pre-
--      implements the §7.2 Z1.5-planned CHECK forms; Z1.5's scope
--      shrinks to just DROP COLUMN.
--
-- What this migration does NOT do:
--   - Doesn't drop any legacy column. That's Z1.5.
--   - Doesn't rename any column. Additive-only.
--   - Doesn't migrate reads. Consumer reads still hit legacy tables
--     (users/companies). Z1.4b's scope.

-- ===========================================================================
-- STEP 1: Add nullable dual-FK columns
-- ===========================================================================

ALTER TABLE "tickets"
  ADD COLUMN IF NOT EXISTS "clientEndUserId" TEXT,
  ADD COLUMN IF NOT EXISTS "clientTeamMemberId" TEXT,
  ADD COLUMN IF NOT EXISTS "assignedTeamMemberId" TEXT,
  ADD COLUMN IF NOT EXISTS "organizationId" TEXT;

ALTER TABLE "attachments"
  ADD COLUMN IF NOT EXISTS "uploadedByEndUserId" TEXT,
  ADD COLUMN IF NOT EXISTS "uploadedByTeamMemberId" TEXT;

ALTER TABLE "ticket_guests"
  ADD COLUMN IF NOT EXISTS "invitedByEndUserId" TEXT,
  ADD COLUMN IF NOT EXISTS "invitedByTeamMemberId" TEXT;

ALTER TABLE "login_otps"
  ADD COLUMN IF NOT EXISTS "endUserId" TEXT,
  ADD COLUMN IF NOT EXISTS "teamMemberId" TEXT;

ALTER TABLE "notifications"
  ADD COLUMN IF NOT EXISTS "recipientEndUserId" TEXT,
  ADD COLUMN IF NOT EXISTS "recipientTeamMemberId" TEXT;

ALTER TABLE "chat_conversations"
  ADD COLUMN IF NOT EXISTS "endUserId" TEXT,
  ADD COLUMN IF NOT EXISTS "teamMemberId" TEXT;

-- ===========================================================================
-- STEP 2: Indexes
-- ===========================================================================

CREATE INDEX IF NOT EXISTS "tickets_tenantId_clientEndUserId_idx"
  ON "tickets"("tenantId", "clientEndUserId");
CREATE INDEX IF NOT EXISTS "tickets_tenantId_clientTeamMemberId_idx"
  ON "tickets"("tenantId", "clientTeamMemberId");
CREATE INDEX IF NOT EXISTS "tickets_tenantId_assignedTeamMemberId_idx"
  ON "tickets"("tenantId", "assignedTeamMemberId");
CREATE INDEX IF NOT EXISTS "tickets_tenantId_organizationId_idx"
  ON "tickets"("tenantId", "organizationId");

CREATE INDEX IF NOT EXISTS "attachments_tenantId_uploadedByEndUserId_idx"
  ON "attachments"("tenantId", "uploadedByEndUserId");
CREATE INDEX IF NOT EXISTS "attachments_tenantId_uploadedByTeamMemberId_idx"
  ON "attachments"("tenantId", "uploadedByTeamMemberId");

CREATE INDEX IF NOT EXISTS "ticket_guests_tenantId_invitedByEndUserId_idx"
  ON "ticket_guests"("tenantId", "invitedByEndUserId");
CREATE INDEX IF NOT EXISTS "ticket_guests_tenantId_invitedByTeamMemberId_idx"
  ON "ticket_guests"("tenantId", "invitedByTeamMemberId");

CREATE INDEX IF NOT EXISTS "login_otps_endUserId_idx"
  ON "login_otps"("endUserId");
CREATE INDEX IF NOT EXISTS "login_otps_teamMemberId_idx"
  ON "login_otps"("teamMemberId");

CREATE INDEX IF NOT EXISTS "notifications_tenantId_recipientEndUserId_idx"
  ON "notifications"("tenantId", "recipientEndUserId");
CREATE INDEX IF NOT EXISTS "notifications_tenantId_recipientTeamMemberId_idx"
  ON "notifications"("tenantId", "recipientTeamMemberId");

CREATE INDEX IF NOT EXISTS "chat_conversations_tenantId_endUserId_idx"
  ON "chat_conversations"("tenantId", "endUserId");
CREATE INDEX IF NOT EXISTS "chat_conversations_tenantId_teamMemberId_idx"
  ON "chat_conversations"("tenantId", "teamMemberId");

-- ===========================================================================
-- STEP 3-pre: Drop the Z1.1b CHECKs on messages/audit_logs BEFORE backfill
--
-- Those constraints include the legacy column in their arg list
-- (senderId, actorId). After the UPDATEs below, backfilled rows will
-- have BOTH the legacy column and one new column populated
-- — 2 non-nulls, violating <= 1. The tightened forms (without legacy in
-- the arg list) are re-added in Step 5.
-- ===========================================================================

ALTER TABLE "messages" DROP CONSTRAINT IF EXISTS "messages_sender_exclusive";
ALTER TABLE "audit_logs" DROP CONSTRAINT IF EXISTS "audit_logs_actor_exclusive";

-- ===========================================================================
-- STEP 3: Backfill new columns from legacy FKs
--
-- Every write below is deterministic: joins on legacy User.id or
-- Company.id, keyed on preserved ids from Z1.3, so the target ends up
-- exactly equal to the source id when the source is the right role.
-- ===========================================================================

-- TICKETS ------------------------------------------------------------------

-- clientEndUserId := clientId where the client User is CLIENT role (→ EndUser)
UPDATE "tickets" t
SET "clientEndUserId" = t."clientId"
FROM "users" u
WHERE u.id = t."clientId"
  AND u.role = 'CLIENT'
  AND t."clientEndUserId" IS NULL;

-- clientTeamMemberId := clientId where the client User is staff (→ TeamMember)
UPDATE "tickets" t
SET "clientTeamMemberId" = t."clientId"
FROM "users" u
WHERE u.id = t."clientId"
  AND u.role IN ('AGENT','ADMIN','SUPER_ADMIN')
  AND t."clientTeamMemberId" IS NULL;

-- assignedTeamMemberId := assignedToId where set (assignedTo is always staff)
UPDATE "tickets" t
SET "assignedTeamMemberId" = t."assignedToId"
FROM "users" u
WHERE u.id = t."assignedToId"
  AND u.role IN ('AGENT','ADMIN','SUPER_ADMIN')
  AND t."assignedToId" IS NOT NULL
  AND t."assignedTeamMemberId" IS NULL;

-- organizationId := client.companyId (via users) where the client had a company
UPDATE "tickets" t
SET "organizationId" = u."companyId"
FROM "users" u
WHERE u.id = t."clientId"
  AND u."companyId" IS NOT NULL
  AND t."organizationId" IS NULL
  AND EXISTS (SELECT 1 FROM "organizations" o WHERE o.id = u."companyId");

-- MESSAGES -----------------------------------------------------------------

UPDATE "messages" m
SET "senderEndUserId" = m."senderId"
FROM "users" u
WHERE u.id = m."senderId"
  AND u.role = 'CLIENT'
  AND m."senderEndUserId" IS NULL;

UPDATE "messages" m
SET "senderTeamMemberId" = m."senderId"
FROM "users" u
WHERE u.id = m."senderId"
  AND u.role IN ('AGENT','ADMIN','SUPER_ADMIN')
  AND m."senderTeamMemberId" IS NULL;

-- AUDIT_LOGS ---------------------------------------------------------------

UPDATE "audit_logs" a
SET "actorEndUserId" = a."actorId"
FROM "users" u
WHERE u.id = a."actorId"
  AND u.role = 'CLIENT'
  AND a."actorEndUserId" IS NULL;

UPDATE "audit_logs" a
SET "actorTeamMemberId" = a."actorId"
FROM "users" u
WHERE u.id = a."actorId"
  AND u.role IN ('AGENT','ADMIN','SUPER_ADMIN')
  AND a."actorTeamMemberId" IS NULL;

-- TICKET_GUESTS ------------------------------------------------------------

UPDATE "ticket_guests" g
SET "invitedByEndUserId" = g."invitedById"
FROM "users" u
WHERE u.id = g."invitedById"
  AND u.role = 'CLIENT'
  AND g."invitedByEndUserId" IS NULL;

UPDATE "ticket_guests" g
SET "invitedByTeamMemberId" = g."invitedById"
FROM "users" u
WHERE u.id = g."invitedById"
  AND u.role IN ('AGENT','ADMIN','SUPER_ADMIN')
  AND g."invitedByTeamMemberId" IS NULL;

-- LOGIN_OTPS ---------------------------------------------------------------

UPDATE "login_otps" o
SET "endUserId" = o."userId"
FROM "users" u
WHERE u.id = o."userId"
  AND u.role = 'CLIENT'
  AND o."endUserId" IS NULL;

UPDATE "login_otps" o
SET "teamMemberId" = o."userId"
FROM "users" u
WHERE u.id = o."userId"
  AND u.role IN ('AGENT','ADMIN','SUPER_ADMIN')
  AND o."teamMemberId" IS NULL;

-- NOTIFICATIONS ------------------------------------------------------------

UPDATE "notifications" n
SET "recipientEndUserId" = n."userId"
FROM "users" u
WHERE u.id = n."userId"
  AND u.role = 'CLIENT'
  AND n."recipientEndUserId" IS NULL;

UPDATE "notifications" n
SET "recipientTeamMemberId" = n."userId"
FROM "users" u
WHERE u.id = n."userId"
  AND u.role IN ('AGENT','ADMIN','SUPER_ADMIN')
  AND n."recipientTeamMemberId" IS NULL;

-- ATTACHMENTS --------------------------------------------------------------

UPDATE "attachments" a
SET "uploadedByEndUserId" = a."uploadedById"
FROM "users" u
WHERE u.id = a."uploadedById"
  AND u.role = 'CLIENT'
  AND a."uploadedByEndUserId" IS NULL;

UPDATE "attachments" a
SET "uploadedByTeamMemberId" = a."uploadedById"
FROM "users" u
WHERE u.id = a."uploadedById"
  AND u.role IN ('AGENT','ADMIN','SUPER_ADMIN')
  AND a."uploadedByTeamMemberId" IS NULL;

-- CHAT_CONVERSATIONS -------------------------------------------------------

UPDATE "chat_conversations" c
SET "endUserId" = c."userId"
FROM "users" u
WHERE u.id = c."userId"
  AND u.role = 'CLIENT'
  AND c."endUserId" IS NULL;

UPDATE "chat_conversations" c
SET "teamMemberId" = c."userId"
FROM "users" u
WHERE u.id = c."userId"
  AND u.role IN ('AGENT','ADMIN','SUPER_ADMIN')
  AND c."teamMemberId" IS NULL;

-- ===========================================================================
-- STEP 4: CHECK constraints on the new pairs
--
-- Each is num_nonnulls(newEU, newTM) <= 1 — enforces "at most one of the
-- two new columns is non-null." SYSTEM/BOT rows have both null (allowed
-- by <= 1). This does NOT include the legacy column in the arg list —
-- during Z1.4a→Z1.5 the legacy column stays populated in parallel;
-- constraining across legacy+new would forbid the dual-write pattern.
-- Z1.5 drops legacy columns and re-emits any relevant CHECK expansions
-- (see docs/shared-platform-boundary.md §7.2).
-- ===========================================================================

ALTER TABLE "tickets" DROP CONSTRAINT IF EXISTS "tickets_client_exclusive";
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_client_exclusive"
  CHECK (num_nonnulls("clientEndUserId", "clientTeamMemberId") <= 1);

ALTER TABLE "attachments" DROP CONSTRAINT IF EXISTS "attachments_uploader_exclusive";
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_uploader_exclusive"
  CHECK (num_nonnulls("uploadedByEndUserId", "uploadedByTeamMemberId") <= 1);

ALTER TABLE "ticket_guests" DROP CONSTRAINT IF EXISTS "ticket_guests_inviter_exclusive";
ALTER TABLE "ticket_guests" ADD CONSTRAINT "ticket_guests_inviter_exclusive"
  CHECK (num_nonnulls("invitedByEndUserId", "invitedByTeamMemberId") <= 1);

ALTER TABLE "login_otps" DROP CONSTRAINT IF EXISTS "login_otps_subject_exclusive";
ALTER TABLE "login_otps" ADD CONSTRAINT "login_otps_subject_exclusive"
  CHECK (num_nonnulls("endUserId", "teamMemberId") <= 1);

ALTER TABLE "notifications" DROP CONSTRAINT IF EXISTS "notifications_recipient_exclusive";
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_exclusive"
  CHECK (num_nonnulls("recipientEndUserId", "recipientTeamMemberId") <= 1);

ALTER TABLE "chat_conversations" DROP CONSTRAINT IF EXISTS "chat_conversations_subject_exclusive";
ALTER TABLE "chat_conversations" ADD CONSTRAINT "chat_conversations_subject_exclusive"
  CHECK (num_nonnulls("endUserId", "teamMemberId") <= 1);

-- ===========================================================================
-- STEP 5: Tighten the Z1.1b CHECKs — drop the legacy column from the arg
-- list so dual-write during Z1.4a→Z1.4b→Z1.5 doesn't violate them.
--
-- This pre-implements the §7.2 Z1.5-planned CHECK forms. Z1.5's scope
-- for these two tables shrinks to just DROP COLUMN.
-- ===========================================================================

-- messages: was 4-way (senderId, senderEndUserId, senderTeamMemberId, guestId)
--           becomes 3-way (senderEndUserId, senderTeamMemberId, guestId).
--           guestId stays included (see §7.2 rationale).
ALTER TABLE "messages" DROP CONSTRAINT IF EXISTS "messages_sender_exclusive";
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_exclusive"
  CHECK (num_nonnulls("senderEndUserId", "senderTeamMemberId", "guestId") <= 1);

-- audit_logs: was 3-way (actorId, actorEndUserId, actorTeamMemberId)
--             becomes 2-way (actorEndUserId, actorTeamMemberId).
--             Null-actor SYSTEM rows still allowed (0 non-nulls <= 1).
ALTER TABLE "audit_logs" DROP CONSTRAINT IF EXISTS "audit_logs_actor_exclusive";
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_exclusive"
  CHECK (num_nonnulls("actorEndUserId", "actorTeamMemberId") <= 1);
