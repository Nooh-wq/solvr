-- Z1.5b prep: relax NOT NULL on legacy dual-FK columns so writes can omit
-- them ahead of Z1.5c dropping the columns entirely.
--
-- Every column listed here is a Z1.4a legacy-side column that dual-writes
-- to a new-shape column (senderEndUserId, actorTeamMemberId, etc). Making
-- them nullable lets the Z1.5b code refactor stop writing the legacy value
-- without breaking the schema.
--
-- Z1.5c drops these columns entirely along with the users table.
-- Safe to re-run.
--
-- Apply with:
--   npx prisma db execute --file prisma/z1_5b_prep.sql --schema prisma/schema.prisma

ALTER TABLE "tickets" ALTER COLUMN "clientId" DROP NOT NULL;

-- messages.senderId is already nullable (SYSTEM/BOT/GUEST cases). No change.
-- audit_logs.actorId is already nullable (SYSTEM actor case). No change.
-- attachments.uploadedById is already nullable. No change.
-- ticket_guests.invitedById is already nullable. No change.
-- notifications.userId is required — new-shape recipientEndUserId /
--   recipientTeamMemberId are nullable, so notifications.userId still
--   carries the recipient reference. Kept as-is; Z1.5c handles it.
-- login_otps.userId is required for the same reason. Kept.
-- chat_conversations.userId is nullable already.
