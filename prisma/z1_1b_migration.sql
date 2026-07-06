-- Z1.1b migration: additive author FK columns + CHECK constraints on the
-- Support-owned Message and AuditLog tables.
--
-- Runs against Support's Supabase DB (the shared physical DB — see
-- docs/shared-platform-boundary.md). Idempotent: every statement uses
-- IF NOT EXISTS / DROP + ADD, safe to re-run.
--
-- Why not `prisma db push`? Prisma migrate's diff engine sees the shared
-- platform's mirrored models in this repo's schema.prisma and wants to
-- re-emit FK constraints for them (see boundary doc §3 rule 2). That's
-- unsafe against a DB the shared platform already migrated. Direct SQL
-- for Support-owned tables sidesteps the diff engine entirely.
--
-- Apply with:
--   npx prisma db execute --file prisma/z1_1b_migration.sql --schema prisma/schema.prisma

-- ---------------------------------------------------------------------------
-- messages: add sender columns for the split of User -> EndUser + TeamMember
-- ---------------------------------------------------------------------------

ALTER TABLE "messages"
  ADD COLUMN IF NOT EXISTS "senderEndUserId" TEXT,
  ADD COLUMN IF NOT EXISTS "senderTeamMemberId" TEXT;

CREATE INDEX IF NOT EXISTS "messages_tenantId_senderEndUserId_idx"
  ON "messages"("tenantId", "senderEndUserId");

CREATE INDEX IF NOT EXISTS "messages_tenantId_senderTeamMemberId_idx"
  ON "messages"("tenantId", "senderTeamMemberId");

-- CHECK: at most ONE author FK is non-null per row across all four author
-- paths: {senderId (legacy User), senderEndUserId, senderTeamMemberId,
-- guestId}. SYSTEM/BOT messages legitimately have all four null
-- (senderRole disambiguates). During Z1 transition, existing rows have
-- exactly one of {senderId, guestId} set (or none for SYSTEM/BOT) and the
-- two new columns null — the constraint holds trivially (verified via
-- headcount against Supabase before this migration ran: 0 rows violate).
--
-- guestId is included in the CHECK deliberately (not left to app-layer
-- discipline) because it answers the same question as the other three
-- ("who wrote this message") and letting one of four sender paths be
-- honor-system defeats the reason for having a DB-level constraint at
-- all. This decision is captured in docs/shared-platform-boundary.md
-- (rule 8 + §7.2 Z1.5 tightening).
--
-- Z1.5 will drop the legacy senderId column and tighten this CHECK to
-- "at most one of {senderEndUserId, senderTeamMemberId, guestId}".
ALTER TABLE "messages"
  DROP CONSTRAINT IF EXISTS "messages_sender_exclusive";

ALTER TABLE "messages"
  ADD CONSTRAINT "messages_sender_exclusive"
  CHECK (num_nonnulls("senderId", "senderEndUserId", "senderTeamMemberId", "guestId") <= 1);

-- ---------------------------------------------------------------------------
-- audit_logs: add actor columns for the same User -> EndUser + TeamMember split
-- ---------------------------------------------------------------------------

ALTER TABLE "audit_logs"
  ADD COLUMN IF NOT EXISTS "actorEndUserId" TEXT,
  ADD COLUMN IF NOT EXISTS "actorTeamMemberId" TEXT;

CREATE INDEX IF NOT EXISTS "audit_logs_tenantId_actorEndUserId_idx"
  ON "audit_logs"("tenantId", "actorEndUserId");

CREATE INDEX IF NOT EXISTS "audit_logs_tenantId_actorTeamMemberId_idx"
  ON "audit_logs"("tenantId", "actorTeamMemberId");

-- Same CHECK-constraint reasoning as messages_sender_exclusive.
-- SYSTEM-actor rows (backfills, crons) keep all three null.
ALTER TABLE "audit_logs"
  DROP CONSTRAINT IF EXISTS "audit_logs_actor_exclusive";

ALTER TABLE "audit_logs"
  ADD CONSTRAINT "audit_logs_actor_exclusive"
  CHECK (num_nonnulls("actorId", "actorEndUserId", "actorTeamMemberId") <= 1);
