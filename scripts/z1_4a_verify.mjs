// Z1.4a verification: count populated new columns and compare against
// the dry-run projection. Also runs DoD checks.

import { config } from "dotenv";
import pg from "pg";
config();

const client = new pg.Client({
  connectionString: process.env.DIRECT_URL,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

console.log(`\n=== Z1.4a verification against live Supabase ===\n`);

const q = async (sql) => Number((await client.query(sql)).rows[0].c);

const actuals = {
  ticketsClientEndUserId:      await q(`SELECT COUNT(*)::int c FROM tickets WHERE "clientEndUserId" IS NOT NULL`),
  ticketsClientTeamMemberId:   await q(`SELECT COUNT(*)::int c FROM tickets WHERE "clientTeamMemberId" IS NOT NULL`),
  ticketsAssignedTeamMemberId: await q(`SELECT COUNT(*)::int c FROM tickets WHERE "assignedTeamMemberId" IS NOT NULL`),
  ticketsOrgId:                await q(`SELECT COUNT(*)::int c FROM tickets WHERE "organizationId" IS NOT NULL`),
  msgSenderEndUserId:          await q(`SELECT COUNT(*)::int c FROM messages WHERE "senderEndUserId" IS NOT NULL`),
  msgSenderTeamMemberId:       await q(`SELECT COUNT(*)::int c FROM messages WHERE "senderTeamMemberId" IS NOT NULL`),
  alActorEndUserId:            await q(`SELECT COUNT(*)::int c FROM audit_logs WHERE "actorEndUserId" IS NOT NULL`),
  alActorTeamMemberId:         await q(`SELECT COUNT(*)::int c FROM audit_logs WHERE "actorTeamMemberId" IS NOT NULL`),
  tgInviterEndUserId:          await q(`SELECT COUNT(*)::int c FROM ticket_guests WHERE "invitedByEndUserId" IS NOT NULL`),
  tgInviterTeamMemberId:       await q(`SELECT COUNT(*)::int c FROM ticket_guests WHERE "invitedByTeamMemberId" IS NOT NULL`),
  otpEndUserId:                await q(`SELECT COUNT(*)::int c FROM login_otps WHERE "endUserId" IS NOT NULL`),
  otpTeamMemberId:             await q(`SELECT COUNT(*)::int c FROM login_otps WHERE "teamMemberId" IS NOT NULL`),
  notifRecipientEndUserId:     await q(`SELECT COUNT(*)::int c FROM notifications WHERE "recipientEndUserId" IS NOT NULL`),
  notifRecipientTeamMemberId:  await q(`SELECT COUNT(*)::int c FROM notifications WHERE "recipientTeamMemberId" IS NOT NULL`),
  attUploaderEndUserId:        await q(`SELECT COUNT(*)::int c FROM attachments WHERE "uploadedByEndUserId" IS NOT NULL`),
  attUploaderTeamMemberId:     await q(`SELECT COUNT(*)::int c FROM attachments WHERE "uploadedByTeamMemberId" IS NOT NULL`),
  ccEndUserId:                 await q(`SELECT COUNT(*)::int c FROM chat_conversations WHERE "endUserId" IS NOT NULL`),
  ccTeamMemberId:              await q(`SELECT COUNT(*)::int c FROM chat_conversations WHERE "teamMemberId" IS NOT NULL`),
};

const projection = {
  ticketsClientEndUserId: 18,
  ticketsClientTeamMemberId: 1,
  ticketsAssignedTeamMemberId: 8,
  ticketsOrgId: 15,
  msgSenderEndUserId: 11,
  msgSenderTeamMemberId: 16,
  alActorEndUserId: 16,
  alActorTeamMemberId: 91,
  tgInviterEndUserId: 1,
  tgInviterTeamMemberId: 4,
  otpEndUserId: 2,
  otpTeamMemberId: 0,
  notifRecipientEndUserId: 17,
  notifRecipientTeamMemberId: 12,
  attUploaderEndUserId: 1,
  attUploaderTeamMemberId: 1,
  ccEndUserId: 3,
  ccTeamMemberId: 0,
};

console.log(`--- ACTUAL vs PROJECTION ---`);
console.log(`  ${"column".padEnd(38)} ${"proj".padStart(5)} ${"actual".padStart(6)}  status`);
let allMatch = true;
let sumActual = 0, sumProj = 0;
for (const [k, v] of Object.entries(actuals)) {
  const p = projection[k];
  const ok = v === p;
  if (!ok) allMatch = false;
  sumActual += v;
  sumProj += p;
  console.log(`  ${k.padEnd(38)} ${String(p).padStart(5)} ${String(v).padStart(6)}  ${ok ? "OK" : "MISMATCH"}`);
}
console.log(`  ${"— total —".padEnd(38)} ${String(sumProj).padStart(5)} ${String(sumActual).padStart(6)}  ${sumActual === sumProj ? "OK" : "MISMATCH"}`);

// ---------------------------------------------------------------------------
// DoD checks
// ---------------------------------------------------------------------------

console.log(`\n--- DoD ---`);

// (a) Row-count parity: every legacy row's new column populated per rule
const parity = await client.query(`
  WITH legacy AS (
    SELECT
      (SELECT COUNT(*)::int FROM tickets) tickets_total,
      (SELECT COUNT(*)::int FROM tickets WHERE "assignedToId" IS NOT NULL) tickets_assigned,
      (SELECT COUNT(*)::int FROM messages WHERE "senderId" IS NOT NULL) msg_user_authored,
      (SELECT COUNT(*)::int FROM audit_logs WHERE "actorId" IS NOT NULL) al_with_actor,
      (SELECT COUNT(*)::int FROM ticket_guests WHERE "invitedById" IS NOT NULL) tg_with_inviter,
      (SELECT COUNT(*)::int FROM login_otps) otp_total,
      (SELECT COUNT(*)::int FROM notifications) notif_total,
      (SELECT COUNT(*)::int FROM attachments WHERE "uploadedById" IS NOT NULL) att_with_uploader,
      (SELECT COUNT(*)::int FROM chat_conversations WHERE "userId" IS NOT NULL) cc_with_user
  ) SELECT * FROM legacy
`);
const l = parity.rows[0];

const parityChecks = [
  ["tickets: clientEU + clientTM  == total", actuals.ticketsClientEndUserId + actuals.ticketsClientTeamMemberId, l.tickets_total],
  ["tickets: assignedTM           == assigned", actuals.ticketsAssignedTeamMemberId, l.tickets_assigned],
  ["messages: senderEU + senderTM == user-authored", actuals.msgSenderEndUserId + actuals.msgSenderTeamMemberId, l.msg_user_authored],
  ["audit_logs: actorEU + actorTM == with actor",  actuals.alActorEndUserId + actuals.alActorTeamMemberId, l.al_with_actor],
  ["ticket_guests: invEU + invTM  == with inviter", actuals.tgInviterEndUserId + actuals.tgInviterTeamMemberId, l.tg_with_inviter],
  ["login_otps: EU + TM           == total",       actuals.otpEndUserId + actuals.otpTeamMemberId, l.otp_total],
  ["notifications: recEU + recTM  == total",       actuals.notifRecipientEndUserId + actuals.notifRecipientTeamMemberId, l.notif_total],
  ["attachments: upEU + upTM      == with uploader", actuals.attUploaderEndUserId + actuals.attUploaderTeamMemberId, l.att_with_uploader],
  ["chat_conversations: EU + TM   == with userId", actuals.ccEndUserId + actuals.ccTeamMemberId, l.cc_with_user],
];
let parityOk = true;
for (const [label, lhs, rhs] of parityChecks) {
  const ok = lhs === rhs;
  if (!ok) parityOk = false;
  console.log(`  ${label.padEnd(48)} lhs=${lhs} rhs=${rhs}  ${ok ? "OK" : "FAIL"}`);
}

// (b) CHECK constraints exist
const constraints = await client.query(`
  SELECT conname FROM pg_constraint
  WHERE conname IN (
    'tickets_client_exclusive',
    'attachments_uploader_exclusive',
    'ticket_guests_inviter_exclusive',
    'login_otps_subject_exclusive',
    'notifications_recipient_exclusive',
    'chat_conversations_subject_exclusive',
    'messages_sender_exclusive',
    'audit_logs_actor_exclusive'
  ) ORDER BY conname
`);
const expectedConstraints = [
  'attachments_uploader_exclusive',
  'audit_logs_actor_exclusive',
  'chat_conversations_subject_exclusive',
  'login_otps_subject_exclusive',
  'messages_sender_exclusive',
  'notifications_recipient_exclusive',
  'ticket_guests_inviter_exclusive',
  'tickets_client_exclusive',
];
const found = new Set(constraints.rows.map((r) => r.conname));
const constraintsOk = expectedConstraints.every((c) => found.has(c));
console.log(`  8 CHECK constraints present:                     ${constraintsOk ? "OK" : "FAIL"}`);
if (!constraintsOk) {
  for (const c of expectedConstraints) if (!found.has(c)) console.log(`      missing: ${c}`);
}

// (c) No CHECK violations exist
const violChecks = [
  [`SELECT COUNT(*)::int c FROM tickets WHERE num_nonnulls("clientEndUserId","clientTeamMemberId") > 1`, "tickets_client_exclusive"],
  [`SELECT COUNT(*)::int c FROM attachments WHERE num_nonnulls("uploadedByEndUserId","uploadedByTeamMemberId") > 1`, "attachments_uploader_exclusive"],
  [`SELECT COUNT(*)::int c FROM ticket_guests WHERE num_nonnulls("invitedByEndUserId","invitedByTeamMemberId") > 1`, "ticket_guests_inviter_exclusive"],
  [`SELECT COUNT(*)::int c FROM login_otps WHERE num_nonnulls("endUserId","teamMemberId") > 1`, "login_otps_subject_exclusive"],
  [`SELECT COUNT(*)::int c FROM notifications WHERE num_nonnulls("recipientEndUserId","recipientTeamMemberId") > 1`, "notifications_recipient_exclusive"],
  [`SELECT COUNT(*)::int c FROM chat_conversations WHERE num_nonnulls("endUserId","teamMemberId") > 1`, "chat_conversations_subject_exclusive"],
  [`SELECT COUNT(*)::int c FROM messages WHERE num_nonnulls("senderEndUserId","senderTeamMemberId","guestId") > 1`, "messages_sender_exclusive"],
  [`SELECT COUNT(*)::int c FROM audit_logs WHERE num_nonnulls("actorEndUserId","actorTeamMemberId") > 1`, "audit_logs_actor_exclusive"],
];
let violOk = true;
for (const [sql, name] of violChecks) {
  const n = await q(sql);
  if (n > 0) {
    violOk = false;
    console.log(`  ${name}: ${n} violations FAIL`);
  }
}
console.log(`  No CHECK violations:                              ${violOk ? "OK" : "FAIL"}`);

// (d) No orphaned new-column FKs
const orphanChecks = [
  [`SELECT COUNT(*)::int c FROM tickets t WHERE t."clientEndUserId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM end_users eu WHERE eu.id = t."clientEndUserId")`, "tickets.clientEndUserId"],
  [`SELECT COUNT(*)::int c FROM tickets t WHERE t."clientTeamMemberId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM team_members tm WHERE tm.id = t."clientTeamMemberId")`, "tickets.clientTeamMemberId"],
  [`SELECT COUNT(*)::int c FROM tickets t WHERE t."assignedTeamMemberId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM team_members tm WHERE tm.id = t."assignedTeamMemberId")`, "tickets.assignedTeamMemberId"],
  [`SELECT COUNT(*)::int c FROM tickets t WHERE t."organizationId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM organizations o WHERE o.id = t."organizationId")`, "tickets.organizationId"],
  [`SELECT COUNT(*)::int c FROM messages m WHERE m."senderEndUserId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM end_users eu WHERE eu.id = m."senderEndUserId")`, "messages.senderEndUserId"],
  [`SELECT COUNT(*)::int c FROM messages m WHERE m."senderTeamMemberId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM team_members tm WHERE tm.id = m."senderTeamMemberId")`, "messages.senderTeamMemberId"],
];
let orphOk = true;
for (const [sql, name] of orphanChecks) {
  const n = await q(sql);
  if (n > 0) {
    orphOk = false;
    console.log(`  orphan FK on ${name}: ${n}  FAIL`);
  }
}
console.log(`  No orphaned new-column FKs:                       ${orphOk ? "OK" : "FAIL"}`);

const dodOk = parityOk && constraintsOk && violOk && orphOk;
const finalOk = allMatch && dodOk;
console.log(`\n=== Z1.4a ${finalOk ? "SUCCESS" : "COMPLETED WITH ISSUES"} ===`);

await client.end();
process.exit(finalOk ? 0 : 1);
