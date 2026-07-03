-- Email-to-ticket flow + registration approval gate
-- See Stralis_Email_Flow_Design.md

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('PENDING', 'ACTIVE', 'REJECTED', 'SUSPENDED');

-- Users: replace isActive boolean with a 4-state status, backfilling from
-- the existing boolean so no current user gets logged out or blocked.
ALTER TABLE "users" ADD COLUMN "status" "UserStatus" NOT NULL DEFAULT 'PENDING';
UPDATE "users" SET "status" = CASE WHEN "isActive" THEN 'ACTIVE' ELSE 'SUSPENDED' END::"UserStatus";
ALTER TABLE "users" DROP COLUMN "isActive";

-- TenantBranding: dedicated inbound support address + provider route id.
ALTER TABLE "tenant_branding" ADD COLUMN "inboundRouteId" TEXT;
CREATE UNIQUE INDEX "tenant_branding_supportEmail_key" ON "tenant_branding"("supportEmail");

-- Tickets: numeric ticketNumber for email subject tagging + last outbound
-- Message-ID for In-Reply-To threading. Backfill existing rows with a
-- collision-free sequential number before enforcing NOT NULL + UNIQUE.
ALTER TABLE "tickets" ADD COLUMN "ticketNumber" TEXT;
ALTER TABLE "tickets" ADD COLUMN "emailMessageId" TEXT;

WITH numbered AS (
  SELECT id, (10000000 + row_number() OVER (ORDER BY "createdAt"))::text AS num FROM "tickets"
)
UPDATE "tickets" t SET "ticketNumber" = numbered.num FROM numbered WHERE t.id = numbered.id;

ALTER TABLE "tickets" ALTER COLUMN "ticketNumber" SET NOT NULL;
CREATE UNIQUE INDEX "tickets_ticketNumber_key" ON "tickets"("ticketNumber");
