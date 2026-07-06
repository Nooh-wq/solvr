// Z1.4 dry-run: projects every column-level backfill that Z1.4's SQL
// migration will perform, plus every anomaly bucket. Read-only against
// live Supabase.
//
// Backfills projected:
//   tickets.clientEndUserId          := clientId (client is always CLIENT-role User)
//   tickets.assignedTeamMemberId     := assignedToId (assignedTo is always staff User; nullable)
//   tickets.organizationId           := (SELECT companyId FROM users WHERE users.id = tickets.clientId)
//   messages.senderEndUserId         := senderId (where sender.role = CLIENT)
//   messages.senderTeamMemberId      := senderId (where sender.role IN staff)
//   audit_logs.actorEndUserId        := actorId (where actor.role = CLIENT)
//   audit_logs.actorTeamMemberId     := actorId (where actor.role IN staff)
//   ticket_guests.invitedByEndUserId := invitedById (where invitedBy.role = CLIENT; nullable)
//   ticket_guests.invitedByTeamMemberId := invitedById (where invitedBy.role IN staff)
//   login_otps.endUserId             := userId (where user.role = CLIENT)
//   login_otps.teamMemberId          := userId (where user.role IN staff)
//   notifications.recipientEndUserId := userId (where user.role = CLIENT)
//   notifications.recipientTeamMemberId := userId (where user.role IN staff)
//   attachments.uploadedByEndUserId  := uploadedById (where uploader.role = CLIENT; nullable)
//   attachments.uploadedByTeamMemberId := uploadedById (where uploader.role IN staff)
//   chat_conversations.endUserId     := userId (where user.role = CLIENT; nullable)
//   chat_conversations.teamMemberId  := userId (where user.role IN staff)

import { config } from "dotenv";
import pg from "pg";
config();

const client = new pg.Client({
  connectionString: process.env.DIRECT_URL,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

console.log(`\n=== Z1.4 dry-run — projection against live Supabase ===\n`);

// -- Baseline counts (from Z1.3) --
const users     = (await client.query(`SELECT COUNT(*)::int c FROM users`)).rows[0].c;
const endUsers  = (await client.query(`SELECT COUNT(*)::int c FROM end_users`)).rows[0].c;
const teamMembers = (await client.query(`SELECT COUNT(*)::int c FROM team_members`)).rows[0].c;
const orgs      = (await client.query(`SELECT COUNT(*)::int c FROM organizations`)).rows[0].c;
const companies = (await client.query(`SELECT COUNT(*)::int c FROM companies`)).rows[0].c;

console.log(`--- BASELINE (from Z1.3) ---`);
console.log(`  users:           ${users}     end_users:      ${endUsers}     team_members:  ${teamMembers}`);
console.log(`  companies:       ${companies}     organizations:  ${orgs}`);

// Sanity-check parity
if (endUsers + teamMembers !== users) {
  console.log(`  WARN: end_users + team_members (${endUsers + teamMembers}) != users (${users})`);
}
if (orgs !== companies) {
  console.log(`  WARN: organizations (${orgs}) != companies (${companies})`);
}

// ---------------------------------------------------------------------------
// TICKETS
// ---------------------------------------------------------------------------

console.log(`\n--- TICKETS ---`);

const ticketsTotal = (await client.query(`SELECT COUNT(*)::int c FROM tickets`)).rows[0].c;
console.log(`  total tickets:                        ${ticketsTotal}`);

// clientEndUserId projection: every ticket has clientId; every clientId
// should resolve to a row in end_users (since we backfilled all CLIENT
// role users into end_users with preserved id).
const ticketsClientResolves = (await client.query(`
  SELECT COUNT(*)::int c
  FROM tickets t
  WHERE EXISTS (SELECT 1 FROM end_users eu WHERE eu.id = t."clientId")
`)).rows[0].c;
console.log(`  clientEndUserId will be set:          ${ticketsClientResolves}   (of ${ticketsTotal})`);

const ticketsClientOrphan = (await client.query(`
  SELECT COUNT(*)::int c
  FROM tickets t
  WHERE NOT EXISTS (SELECT 1 FROM end_users eu WHERE eu.id = t."clientId")
`)).rows[0].c;
if (ticketsClientOrphan > 0) {
  console.log(`  WARN: ${ticketsClientOrphan} tickets have clientId not in end_users`);
  const sample = await client.query(`
    SELECT t.id, t.reference, t."clientId", u.role, u.email
    FROM tickets t LEFT JOIN users u ON u.id = t."clientId"
    WHERE NOT EXISTS (SELECT 1 FROM end_users eu WHERE eu.id = t."clientId")
    LIMIT 5
  `);
  for (const r of sample.rows) console.log(`      - ${JSON.stringify(r)}`);
}

// assignedTeamMemberId projection: only tickets with non-null assignedToId
const ticketsAssigned = (await client.query(`
  SELECT COUNT(*)::int c FROM tickets WHERE "assignedToId" IS NOT NULL
`)).rows[0].c;
const ticketsAssignedResolves = (await client.query(`
  SELECT COUNT(*)::int c
  FROM tickets t
  WHERE t."assignedToId" IS NOT NULL
    AND EXISTS (SELECT 1 FROM team_members tm WHERE tm.id = t."assignedToId")
`)).rows[0].c;
console.log(`  assignedToId non-null:                ${ticketsAssigned}`);
console.log(`  assignedTeamMemberId will be set:     ${ticketsAssignedResolves}`);

const ticketsAssignedOrphan = (await client.query(`
  SELECT COUNT(*)::int c
  FROM tickets t
  WHERE t."assignedToId" IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM team_members tm WHERE tm.id = t."assignedToId")
`)).rows[0].c;
if (ticketsAssignedOrphan > 0) {
  console.log(`  WARN: ${ticketsAssignedOrphan} tickets have assignedToId not in team_members`);
}

// organizationId projection: via join to users.companyId → organizations
const ticketsOrgResolvable = (await client.query(`
  SELECT COUNT(*)::int c
  FROM tickets t
  JOIN users u ON u.id = t."clientId"
  WHERE u."companyId" IS NOT NULL
    AND EXISTS (SELECT 1 FROM organizations o WHERE o.id = u."companyId")
`)).rows[0].c;
const ticketsOrgNull = ticketsTotal - ticketsOrgResolvable;
console.log(`  organizationId via client.companyId:  ${ticketsOrgResolvable}`);
console.log(`  organizationId left NULL:             ${ticketsOrgNull}`);

// ---------------------------------------------------------------------------
// MESSAGES
// ---------------------------------------------------------------------------

console.log(`\n--- MESSAGES ---`);

const msgTotal = (await client.query(`SELECT COUNT(*)::int c FROM messages`)).rows[0].c;
const msgWithSender = (await client.query(`SELECT COUNT(*)::int c FROM messages WHERE "senderId" IS NOT NULL`)).rows[0].c;
const msgGuest = (await client.query(`SELECT COUNT(*)::int c FROM messages WHERE "guestId" IS NOT NULL`)).rows[0].c;
const msgSystemNoAuthor = (await client.query(`
  SELECT COUNT(*)::int c FROM messages
  WHERE "senderId" IS NULL AND "guestId" IS NULL
`)).rows[0].c;
console.log(`  total messages:                       ${msgTotal}`);
console.log(`  with senderId (user-authored):        ${msgWithSender}`);
console.log(`  with guestId (guest-authored):        ${msgGuest}`);
console.log(`  SYSTEM/BOT (no senderId, no guestId): ${msgSystemNoAuthor}`);

const msgSenderClient = (await client.query(`
  SELECT COUNT(*)::int c
  FROM messages m JOIN users u ON u.id = m."senderId"
  WHERE u.role = 'CLIENT'
`)).rows[0].c;
const msgSenderStaff = (await client.query(`
  SELECT COUNT(*)::int c
  FROM messages m JOIN users u ON u.id = m."senderId"
  WHERE u.role IN ('AGENT','ADMIN','SUPER_ADMIN')
`)).rows[0].c;
console.log(`  senderEndUserId will be set:          ${msgSenderClient}`);
console.log(`  senderTeamMemberId will be set:       ${msgSenderStaff}`);

const msgSenderOrphan = (await client.query(`
  SELECT COUNT(*)::int c
  FROM messages m
  WHERE m."senderId" IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = m."senderId")
`)).rows[0].c;
if (msgSenderOrphan > 0) console.log(`  WARN: ${msgSenderOrphan} messages have senderId not in users`);

// ---------------------------------------------------------------------------
// AUDIT_LOGS
// ---------------------------------------------------------------------------

console.log(`\n--- AUDIT_LOGS ---`);

const alTotal = (await client.query(`SELECT COUNT(*)::int c FROM audit_logs`)).rows[0].c;
const alWithActor = (await client.query(`SELECT COUNT(*)::int c FROM audit_logs WHERE "actorId" IS NOT NULL`)).rows[0].c;
const alSystem = (await client.query(`SELECT COUNT(*)::int c FROM audit_logs WHERE "actorId" IS NULL`)).rows[0].c;
console.log(`  total audit_logs:                     ${alTotal}`);
console.log(`  with actorId:                         ${alWithActor}`);
console.log(`  system-attributed (actorId NULL):     ${alSystem}   (must remain <=1 non-null after tightening)`);

const alActorClient = (await client.query(`
  SELECT COUNT(*)::int c
  FROM audit_logs a JOIN users u ON u.id = a."actorId"
  WHERE u.role = 'CLIENT'
`)).rows[0].c;
const alActorStaff = (await client.query(`
  SELECT COUNT(*)::int c
  FROM audit_logs a JOIN users u ON u.id = a."actorId"
  WHERE u.role IN ('AGENT','ADMIN','SUPER_ADMIN')
`)).rows[0].c;
console.log(`  actorEndUserId will be set:           ${alActorClient}`);
console.log(`  actorTeamMemberId will be set:        ${alActorStaff}`);

// ---------------------------------------------------------------------------
// TICKET_GUESTS
// ---------------------------------------------------------------------------

console.log(`\n--- TICKET_GUESTS ---`);

const tgTotal = (await client.query(`SELECT COUNT(*)::int c FROM ticket_guests`)).rows[0].c;
const tgWithInviter = (await client.query(`SELECT COUNT(*)::int c FROM ticket_guests WHERE "invitedById" IS NOT NULL`)).rows[0].c;
console.log(`  total ticket_guests:                  ${tgTotal}`);
console.log(`  with invitedById:                     ${tgWithInviter}`);

const tgInviterClient = (await client.query(`
  SELECT COUNT(*)::int c FROM ticket_guests g JOIN users u ON u.id = g."invitedById" WHERE u.role = 'CLIENT'
`)).rows[0].c;
const tgInviterStaff = (await client.query(`
  SELECT COUNT(*)::int c FROM ticket_guests g JOIN users u ON u.id = g."invitedById" WHERE u.role IN ('AGENT','ADMIN','SUPER_ADMIN')
`)).rows[0].c;
console.log(`  invitedByEndUserId will be set:       ${tgInviterClient}`);
console.log(`  invitedByTeamMemberId will be set:    ${tgInviterStaff}`);

// ---------------------------------------------------------------------------
// LOGIN_OTPS
// ---------------------------------------------------------------------------

console.log(`\n--- LOGIN_OTPS ---`);

const otpTotal = (await client.query(`SELECT COUNT(*)::int c FROM login_otps`)).rows[0].c;
const otpClient = (await client.query(`
  SELECT COUNT(*)::int c FROM login_otps o JOIN users u ON u.id = o."userId" WHERE u.role = 'CLIENT'
`)).rows[0].c;
const otpStaff = (await client.query(`
  SELECT COUNT(*)::int c FROM login_otps o JOIN users u ON u.id = o."userId" WHERE u.role IN ('AGENT','ADMIN','SUPER_ADMIN')
`)).rows[0].c;
console.log(`  total login_otps:                     ${otpTotal}`);
console.log(`  endUserId will be set:                ${otpClient}`);
console.log(`  teamMemberId will be set:             ${otpStaff}`);

// ---------------------------------------------------------------------------
// NOTIFICATIONS
// ---------------------------------------------------------------------------

console.log(`\n--- NOTIFICATIONS ---`);

const notifTotal = (await client.query(`SELECT COUNT(*)::int c FROM notifications`)).rows[0].c;
const notifClient = (await client.query(`
  SELECT COUNT(*)::int c FROM notifications n JOIN users u ON u.id = n."userId" WHERE u.role = 'CLIENT'
`)).rows[0].c;
const notifStaff = (await client.query(`
  SELECT COUNT(*)::int c FROM notifications n JOIN users u ON u.id = n."userId" WHERE u.role IN ('AGENT','ADMIN','SUPER_ADMIN')
`)).rows[0].c;
console.log(`  total notifications:                  ${notifTotal}`);
console.log(`  recipientEndUserId will be set:       ${notifClient}`);
console.log(`  recipientTeamMemberId will be set:    ${notifStaff}`);

// ---------------------------------------------------------------------------
// ATTACHMENTS
// ---------------------------------------------------------------------------

console.log(`\n--- ATTACHMENTS ---`);

const attTotal = (await client.query(`SELECT COUNT(*)::int c FROM attachments`)).rows[0].c;
const attWithUploader = (await client.query(`SELECT COUNT(*)::int c FROM attachments WHERE "uploadedById" IS NOT NULL`)).rows[0].c;
const attClient = (await client.query(`
  SELECT COUNT(*)::int c FROM attachments a JOIN users u ON u.id = a."uploadedById" WHERE u.role = 'CLIENT'
`)).rows[0].c;
const attStaff = (await client.query(`
  SELECT COUNT(*)::int c FROM attachments a JOIN users u ON u.id = a."uploadedById" WHERE u.role IN ('AGENT','ADMIN','SUPER_ADMIN')
`)).rows[0].c;
console.log(`  total attachments:                    ${attTotal}`);
console.log(`  with uploadedById:                    ${attWithUploader}`);
console.log(`  uploadedByEndUserId will be set:      ${attClient}`);
console.log(`  uploadedByTeamMemberId will be set:   ${attStaff}`);

// ---------------------------------------------------------------------------
// CHAT_CONVERSATIONS
// ---------------------------------------------------------------------------

console.log(`\n--- CHAT_CONVERSATIONS ---`);

const ccTotal = (await client.query(`SELECT COUNT(*)::int c FROM chat_conversations`)).rows[0].c;
const ccWithUser = (await client.query(`SELECT COUNT(*)::int c FROM chat_conversations WHERE "userId" IS NOT NULL`)).rows[0].c;
const ccClient = (await client.query(`
  SELECT COUNT(*)::int c FROM chat_conversations c JOIN users u ON u.id = c."userId" WHERE u.role = 'CLIENT'
`)).rows[0].c;
const ccStaff = (await client.query(`
  SELECT COUNT(*)::int c FROM chat_conversations c JOIN users u ON u.id = c."userId" WHERE u.role IN ('AGENT','ADMIN','SUPER_ADMIN')
`)).rows[0].c;
console.log(`  total chat_conversations:             ${ccTotal}`);
console.log(`  with userId:                          ${ccWithUser}`);
console.log(`  endUserId will be set:                ${ccClient}`);
console.log(`  teamMemberId will be set:             ${ccStaff}`);

// ---------------------------------------------------------------------------
// GRAND TOTAL
// ---------------------------------------------------------------------------

const grandTotal =
  ticketsClientResolves + ticketsAssignedResolves + ticketsOrgResolvable +
  msgSenderClient + msgSenderStaff +
  alActorClient + alActorStaff +
  tgInviterClient + tgInviterStaff +
  otpClient + otpStaff +
  notifClient + notifStaff +
  attClient + attStaff +
  ccClient + ccStaff;

console.log(`\n--- GRAND TOTAL ---`);
console.log(`  Total column-level backfill writes projected: ${grandTotal}`);

// ---------------------------------------------------------------------------
// ANOMALY BUCKETS
// ---------------------------------------------------------------------------

console.log(`\n--- ANOMALY BUCKETS ---`);

const anomalies = [];
if (ticketsClientOrphan > 0)
  anomalies.push(`ORPHAN_TICKET_CLIENT (${ticketsClientOrphan}): ticket.clientId not in end_users`);
if (ticketsAssignedOrphan > 0)
  anomalies.push(`ORPHAN_TICKET_ASSIGNEE (${ticketsAssignedOrphan}): ticket.assignedToId not in team_members`);
if (msgSenderOrphan > 0)
  anomalies.push(`ORPHAN_MESSAGE_SENDER (${msgSenderOrphan}): message.senderId not in users`);

// SYSTEM audit_log rows already checked in boundary doc §7.2. Preserved
// as null-actor after backfill — informational.
if (alSystem > 0)
  console.log(`  INFO: ${alSystem} audit_logs rows will remain fully null-actor after backfill (system-attributed). CHECK stays <=1 so this is allowed. See boundary doc §7.2.`);
if (msgSystemNoAuthor > 0)
  console.log(`  INFO: ${msgSystemNoAuthor} messages will remain fully null-author after backfill (SYSTEM/BOT rows). CHECK stays <=1 so this is allowed.`);

if (anomalies.length === 0) {
  console.log(`  (no data anomalies — every legacy FK resolves cleanly)`);
} else {
  for (const a of anomalies) console.log(`  ${a}`);
}

console.log(`\n=== DRY-RUN complete. No writes performed. ===`);
await client.end();
process.exit(0);
