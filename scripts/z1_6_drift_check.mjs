// Z1.6 drift check: enumerate every legacy `users` row and verify it has
// a matching wrapper counterpart (end_users or team_members, keyed on
// preserved id from Z1.3). Any drift = a user created since Z1.3 backfill
// via a code path that didn't dual-write to the wrapper — a real gap
// Z1.6 must catch up before starting the code migration.
//
// Reports counts only; no writes.

import { config } from "dotenv";
import pg from "pg";
config();

const client = new pg.Client({
  connectionString: process.env.DIRECT_URL,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

console.log(`\n=== Z1.6 drift check — legacy users vs wrapper counterparts ===\n`);

const q = async (sql) => (await client.query(sql)).rows;

// -- Baseline --
const users     = Number((await q(`SELECT COUNT(*)::int c FROM users`))[0].c);
const endUsers  = Number((await q(`SELECT COUNT(*)::int c FROM end_users`))[0].c);
const teamMembers = Number((await q(`SELECT COUNT(*)::int c FROM team_members`))[0].c);

console.log(`--- BASELINE ---`);
console.log(`  users:            ${users}`);
console.log(`  end_users:        ${endUsers}`);
console.log(`  team_members:     ${teamMembers}`);
console.log(`  sum EU + TM:      ${endUsers + teamMembers}`);
console.log(`  parity vs users:  ${endUsers + teamMembers === users ? "OK" : `DRIFT (${users - (endUsers + teamMembers)} legacy users without counterparts)`}`);

// -- By-role drift breakdown --
const byRole = await q(`
  SELECT role, COUNT(*)::int c FROM users GROUP BY role ORDER BY role
`);
console.log(`\n--- LEGACY USERS BY ROLE ---`);
for (const r of byRole) console.log(`  ${r.role.padEnd(15)} ${r.c}`);

// -- CLIENT users missing from end_users --
const clientOrphans = await q(`
  SELECT u.id, u.email, u.role, u.status, u."tenantId"
  FROM users u
  WHERE u.role = 'CLIENT'
    AND NOT EXISTS (SELECT 1 FROM end_users eu WHERE eu.id = u.id)
  ORDER BY u.email
`);
console.log(`\n--- CLIENT users missing from end_users: ${clientOrphans.length} ---`);
for (const c of clientOrphans) console.log(`  ${JSON.stringify(c)}`);

// -- Staff users missing from team_members --
const staffOrphans = await q(`
  SELECT u.id, u.email, u.role, u.status, u."tenantId"
  FROM users u
  WHERE u.role IN ('AGENT','ADMIN','SUPER_ADMIN')
    AND NOT EXISTS (SELECT 1 FROM team_members tm WHERE tm.id = u.id)
  ORDER BY u.email
`);
console.log(`\n--- Staff users missing from team_members: ${staffOrphans.length} ---`);
for (const s of staffOrphans) console.log(`  ${JSON.stringify(s)}`);

// -- Wrapper counterparts without legacy backing (the reverse — unlikely but worth checking) --
const orphanEndUsers = await q(`
  SELECT eu.id, eu.email
  FROM end_users eu
  WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = eu.id)
`);
const orphanTeamMembers = await q(`
  SELECT tm.id, tm.email
  FROM team_members tm
  WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = tm.id)
`);
console.log(`\n--- Reverse orphans ---`);
console.log(`  end_users without legacy: ${orphanEndUsers.length}`);
console.log(`  team_members without legacy: ${orphanTeamMembers.length}`);

// -- Companies vs organizations --
const companies = Number((await q(`SELECT COUNT(*)::int c FROM companies`))[0].c);
const orgs = Number((await q(`SELECT COUNT(*)::int c FROM organizations`))[0].c);
console.log(`\n--- COMPANY / ORGANIZATION ---`);
console.log(`  companies:        ${companies}`);
console.log(`  organizations:    ${orgs}`);
const companyOrphans = await q(`
  SELECT c.id, c.name, c."tenantId"
  FROM companies c
  WHERE NOT EXISTS (SELECT 1 FROM organizations o WHERE o.id = c.id)
`);
console.log(`  companies without organization: ${companyOrphans.length}`);
for (const c of companyOrphans) console.log(`    ${JSON.stringify(c)}`);

// -- New activity since Z1.3 backfill? --
// Z1.3 backfill ran on 2026-07-07 (per commit history). Check for user
// rows created after that date — those are the potentially-drifted ones.
const backfillCutoff = '2026-07-07 00:00:00';
const usersCreatedSince = await q(`
  SELECT id, email, role, status, "tenantId", "createdAt"
  FROM users
  WHERE "createdAt" > '${backfillCutoff}'
  ORDER BY "createdAt" ASC
`);
console.log(`\n--- USERS created after Z1.3 backfill (${backfillCutoff}) ---`);
console.log(`  count: ${usersCreatedSince.length}`);
for (const u of usersCreatedSince) console.log(`  ${JSON.stringify(u)}`);

console.log(`\n=== Drift check complete ===`);
await client.end();
process.exit(0);
