// Z1.4a smoke test: writes a new row to each dual-FK table via raw SQL
// mimicking the exact insert shape the server actions now produce, then
// verifies the dual-FK columns landed correctly and the CHECK
// constraints didn't reject anything. Cleans up after itself.
//
// This is NOT a replacement for exercising the actual Next.js server
// actions in a running app — it validates the schema+backfill contract
// only. UI-level verification lands with Z1.4b.

import { config } from "dotenv";
import pg from "pg";
config();

const client = new pg.Client({
  connectionString: process.env.DIRECT_URL,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

console.log(`\n=== Z1.4a smoke test — dual-write shape validation ===\n`);

// Pick one live CLIENT-role User + one staff-role User to author test rows
const { rows: clientRow } = await client.query(`
  SELECT id, "tenantId" FROM users WHERE role = 'CLIENT' LIMIT 1
`);
const { rows: staffRow } = await client.query(`
  SELECT id, "tenantId" FROM users WHERE role IN ('AGENT','ADMIN','SUPER_ADMIN') LIMIT 1
`);
if (!clientRow[0] || !staffRow[0]) {
  console.log(`FATAL: need at least one CLIENT and one staff User to exercise`);
  process.exit(1);
}
const c = clientRow[0];
const s = staffRow[0];

// Test rows share this ticket, which we'll create first
const { rows: existingTicket } = await client.query(`
  SELECT id FROM tickets WHERE "clientId" = $1 LIMIT 1
`, [c.id]);
if (!existingTicket[0]) {
  console.log(`FATAL: no existing ticket to piggyback on`);
  process.exit(1);
}
const ticketId = existingTicket[0].id;

const tenantId = c.tenantId;
let failures = 0;

async function expect(label, ok, detail) {
  if (ok) console.log(`  OK  ${label}`);
  else { failures++; console.log(`  FAIL ${label}  ${detail ?? ""}`); }
}

// --- messages ---
const msg = await client.query(`
  INSERT INTO messages (id, "tenantId", "ticketId", "senderId", "senderEndUserId", "senderRole", body)
  VALUES ('z1_4a_smoke_msg', $1, $2, $3, $3, 'CLIENT', 'smoke test')
  ON CONFLICT (id) DO UPDATE SET body = 'smoke test' RETURNING id, "senderEndUserId", "senderTeamMemberId"
`, [tenantId, ticketId, c.id]);
await expect(`messages dual-write CLIENT`,
  msg.rows[0].senderEndUserId === c.id && msg.rows[0].senderTeamMemberId === null);

const msg2 = await client.query(`
  INSERT INTO messages (id, "tenantId", "ticketId", "senderId", "senderTeamMemberId", "senderRole", body)
  VALUES ('z1_4a_smoke_msg2', $1, $2, $3, $3, 'AGENT', 'smoke test 2')
  ON CONFLICT (id) DO UPDATE SET body = 'smoke test 2' RETURNING id, "senderEndUserId", "senderTeamMemberId"
`, [tenantId, ticketId, s.id]);
await expect(`messages dual-write STAFF`,
  msg2.rows[0].senderEndUserId === null && msg2.rows[0].senderTeamMemberId === s.id);

// --- audit_logs ---
const al = await client.query(`
  INSERT INTO audit_logs (id, "tenantId", "ticketId", "actorId", "actorEndUserId", action)
  VALUES ('z1_4a_smoke_al', $1, $2, $3, $3, 'SMOKE')
  ON CONFLICT (id) DO UPDATE SET action = 'SMOKE' RETURNING id, "actorEndUserId", "actorTeamMemberId"
`, [tenantId, ticketId, c.id]);
await expect(`audit_logs dual-write CLIENT`,
  al.rows[0].actorEndUserId === c.id && al.rows[0].actorTeamMemberId === null);

// --- test CHECK enforcement: try inserting BOTH new-pair cols set at once, should fail
let checkOk = false;
try {
  await client.query(`
    INSERT INTO messages (id, "tenantId", "ticketId", "senderEndUserId", "senderTeamMemberId", "senderRole", body)
    VALUES ('z1_4a_smoke_reject', $1, $2, $3, $4, 'CLIENT', 'reject me')
  `, [tenantId, ticketId, c.id, s.id]);
} catch (e) {
  if (e.code === '23514') checkOk = true; // check_violation
}
await expect(`messages_sender_exclusive rejects both-new-cols-set`, checkOk);

// Clean up smoke rows
await client.query(`DELETE FROM messages WHERE id IN ('z1_4a_smoke_msg','z1_4a_smoke_msg2','z1_4a_smoke_reject')`);
await client.query(`DELETE FROM audit_logs WHERE id = 'z1_4a_smoke_al'`);

console.log(`\n=== Smoke ${failures === 0 ? "PASS" : `FAIL (${failures})`} ===`);
await client.end();
process.exit(failures === 0 ? 0 : 1);
