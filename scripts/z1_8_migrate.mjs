// Z1.8a dry-run driver.
//
// The schema migration + backfill in prisma/z1_8a_migration.sql runs once
// (idempotent) at deploy time via `npx prisma db execute`. This driver
// provides the per-tenant verify/apply-catch-up loop used during dry-runs
// against staging tenants and during localhost verification against real
// tenants.
//
// Modes:
//   --tenant-id <id>   Apply catch-up backfill for one tenant only. Idempotent.
//                      Used for staging dry-run and localhost verify against
//                      `stralis` before production migration.
//   --all-tenants      Apply catch-up backfill for every tenant. Requires
//                      --yes-i-am-sure to run (interactive-confirmation
//                      substitute in a non-interactive Node script).
//   --verify <id>      Read-only drift check for one tenant. Reports missing
//                      auth_credentials + lifecycle rows and per-fixture-count
//                      matches. Exit 0 if clean, exit 1 if drift detected.
//
// Guardrails:
//   --all-tenants without --yes-i-am-sure aborts.
//   Backfill uses the same NOT EXISTS / ON CONFLICT patterns as
//   prisma/z1_8a_migration.sql, so re-running is safe.
//
// Drift-check id convention (READ THIS BEFORE MODIFYING VERIFY LOGIC):
//   - auth_credentials.id is a FRESH cuid at row-creation time. It is NOT
//     preserved from legacy users.id. Never match on it directly.
//   - Match auth_credentials rows to users via:
//       * subjectEndUserId for legacy CLIENT users
//       * subjectTeamMemberId for legacy staff (AGENT/ADMIN/SUPER_ADMIN)
//     Both subject_* columns ARE preserved from Z1.3, so the lookup is 1:1.
//   - Lifecycle tables (team_member_lifecycle, end_user_lifecycle) DO use
//     preserved ids as their PK — subjectId == legacy users.id (Z1.3 pattern).
//     Match those directly by id.
//   Two different id-preservation profiles for two different tables. This
//   asymmetry is deliberate — see prisma/z1_8a_migration.sql header and
//   docs/design/z1-8-implementation-plan.md Decision D for rationale.

import "dotenv/config";
import pg from "pg";

const args = process.argv.slice(2);
const client = new pg.Client({
  connectionString: process.env.DIRECT_URL,
  ssl: { rejectUnauthorized: false },
});

function argValue(flag) {
  const idx = args.indexOf(flag);
  return idx >= 0 ? args[idx + 1] : null;
}

async function applyForTenant(tenantId) {
  // Catch-up backfill for a tenant. Every INSERT is guarded so re-running
  // is a no-op. Mirrors the SQL in prisma/z1_8a_migration.sql but scoped
  // to a single tenant via WHERE u."tenantId" = $1.

  const staffCreds = await client.query(
    `
    INSERT INTO "auth_credentials" ("id", "tenantId", "subjectTeamMemberId", "passwordHash", "passwordChangedAt", "createdAt", "updatedAt")
    SELECT gen_random_uuid()::TEXT, u."tenantId", u."id", u."passwordHash", u."passwordChangedAt", NOW(), NOW()
    FROM "users" u
    WHERE u."tenantId" = $1 AND u."role" != 'CLIENT'
      AND NOT EXISTS (SELECT 1 FROM "auth_credentials" ac WHERE ac."subjectTeamMemberId" = u."id")
    RETURNING id
    `,
    [tenantId]
  );

  const clientCreds = await client.query(
    `
    INSERT INTO "auth_credentials" ("id", "tenantId", "subjectEndUserId", "passwordHash", "passwordChangedAt", "createdAt", "updatedAt")
    SELECT gen_random_uuid()::TEXT, u."tenantId", u."id", u."passwordHash", u."passwordChangedAt", NOW(), NOW()
    FROM "users" u
    WHERE u."tenantId" = $1 AND u."role" = 'CLIENT'
      AND NOT EXISTS (SELECT 1 FROM "auth_credentials" ac WHERE ac."subjectEndUserId" = u."id")
    RETURNING id
    `,
    [tenantId]
  );

  const tmLifecycle = await client.query(
    `
    INSERT INTO "team_member_lifecycle" ("subjectId", "tenantId", "status", "invitedAt", "invitedById", "approvedAt", "approvedById", "rejectedAt", "rejectedById", "lastActiveAt", "createdAt", "updatedAt")
    SELECT u."id", u."tenantId", u."status", u."invitedAt", u."invitedById", u."approvedAt", u."approvedById", u."rejectedAt", u."rejectedById", u."lastActiveAt", NOW(), NOW()
    FROM "users" u
    WHERE u."tenantId" = $1 AND u."role" != 'CLIENT'
    ON CONFLICT ("subjectId") DO NOTHING
    RETURNING "subjectId"
    `,
    [tenantId]
  );

  const euLifecycle = await client.query(
    `
    INSERT INTO "end_user_lifecycle" ("subjectId", "tenantId", "status", "invitedAt", "invitedById", "approvedAt", "approvedById", "rejectedAt", "rejectedById", "lastActiveAt", "createdAt", "updatedAt")
    SELECT u."id", u."tenantId", u."status", u."invitedAt", u."invitedById", u."approvedAt", u."approvedById", u."rejectedAt", u."rejectedById", u."lastActiveAt", NOW(), NOW()
    FROM "users" u
    WHERE u."tenantId" = $1 AND u."role" = 'CLIENT'
    ON CONFLICT ("subjectId") DO NOTHING
    RETURNING "subjectId"
    `,
    [tenantId]
  );

  return {
    inserted: {
      staffCredentials: staffCreds.rowCount,
      clientCredentials: clientCreds.rowCount,
      teamMemberLifecycle: tmLifecycle.rowCount,
      endUserLifecycle: euLifecycle.rowCount,
    },
  };
}

async function verifyTenant(tenantId) {
  const users = await client.query(
    `SELECT id, role FROM users WHERE "tenantId" = $1`,
    [tenantId]
  );
  const missingCredentials = [];
  const missingLifecycle = [];
  for (const u of users.rows) {
    const isStaff = u.role !== "CLIENT";
    const credQ = isStaff
      ? `SELECT 1 FROM "auth_credentials" WHERE "subjectTeamMemberId" = $1`
      : `SELECT 1 FROM "auth_credentials" WHERE "subjectEndUserId" = $1`;
    const cred = await client.query(credQ, [u.id]);
    if (cred.rowCount === 0) missingCredentials.push({ id: u.id, role: u.role });

    const lcTable = isStaff ? "team_member_lifecycle" : "end_user_lifecycle";
    const lc = await client.query(
      `SELECT 1 FROM "${lcTable}" WHERE "subjectId" = $1`,
      [u.id]
    );
    if (lc.rowCount === 0) missingLifecycle.push({ id: u.id, role: u.role });
  }

  const counts = {
    users: users.rowCount,
    staff: users.rows.filter((u) => u.role !== "CLIENT").length,
    clients: users.rows.filter((u) => u.role === "CLIENT").length,
  };

  const authCredsCount = await client.query(
    `SELECT COUNT(*)::int AS c FROM auth_credentials WHERE "tenantId" = $1`,
    [tenantId]
  );
  const tmLcCount = await client.query(
    `SELECT COUNT(*)::int AS c FROM team_member_lifecycle WHERE "tenantId" = $1`,
    [tenantId]
  );
  const euLcCount = await client.query(
    `SELECT COUNT(*)::int AS c FROM end_user_lifecycle WHERE "tenantId" = $1`,
    [tenantId]
  );

  const stores = {
    authCredentials: authCredsCount.rows[0].c,
    teamMemberLifecycle: tmLcCount.rows[0].c,
    endUserLifecycle: euLcCount.rows[0].c,
  };

  const inSync =
    missingCredentials.length === 0 &&
    missingLifecycle.length === 0 &&
    stores.authCredentials === counts.users &&
    stores.teamMemberLifecycle === counts.staff &&
    stores.endUserLifecycle === counts.clients;

  return { counts, stores, missingCredentials, missingLifecycle, inSync };
}

async function main() {
  await client.connect();

  if (args.includes("--verify")) {
    const tenantId = argValue("--verify");
    if (!tenantId) throw new Error("--verify requires a tenant id");
    console.log(`\n=== Z1.8a verify — tenant ${tenantId} ===\n`);
    const result = await verifyTenant(tenantId);
    console.log(`Users: ${result.counts.users} (${result.counts.staff} staff, ${result.counts.clients} client)`);
    console.log(`auth_credentials rows:      ${result.stores.authCredentials}  (expected ${result.counts.users})`);
    console.log(`team_member_lifecycle rows: ${result.stores.teamMemberLifecycle}  (expected ${result.counts.staff})`);
    console.log(`end_user_lifecycle rows:    ${result.stores.endUserLifecycle}  (expected ${result.counts.clients})`);
    console.log(`Missing credential rows:    ${result.missingCredentials.length}`);
    console.log(`Missing lifecycle rows:     ${result.missingLifecycle.length}`);
    console.log(`\n${result.inSync ? "✓ In sync" : "✗ Drift detected"}\n`);
    process.exit(result.inSync ? 0 : 1);
  } else if (args.includes("--tenant-id")) {
    const tenantId = argValue("--tenant-id");
    if (!tenantId) throw new Error("--tenant-id requires a value");
    console.log(`\n=== Z1.8a apply — tenant ${tenantId} ===\n`);
    const before = await verifyTenant(tenantId);
    const applied = await applyForTenant(tenantId);
    const after = await verifyTenant(tenantId);
    console.log(`Inserted this run:`);
    console.log(`  staff credentials:        ${applied.inserted.staffCredentials}`);
    console.log(`  client credentials:       ${applied.inserted.clientCredentials}`);
    console.log(`  team_member_lifecycle:    ${applied.inserted.teamMemberLifecycle}`);
    console.log(`  end_user_lifecycle:       ${applied.inserted.endUserLifecycle}`);
    console.log(`\nPost-apply state:`);
    console.log(`  auth_credentials:         ${after.stores.authCredentials}  (expected ${after.counts.users})`);
    console.log(`  team_member_lifecycle:    ${after.stores.teamMemberLifecycle}  (expected ${after.counts.staff})`);
    console.log(`  end_user_lifecycle:       ${after.stores.endUserLifecycle}  (expected ${after.counts.clients})`);
    console.log(`\n${after.inSync ? "✓ In sync" : "✗ Drift remains — investigate"}\n`);
    process.exit(after.inSync ? 0 : 1);
  } else if (args.includes("--all-tenants")) {
    if (!args.includes("--yes-i-am-sure")) {
      console.error("Refusing to run --all-tenants without --yes-i-am-sure.");
      console.error("This applies backfill to every tenant. Use --tenant-id <id> for scoped dry-runs.");
      process.exit(1);
    }
    const tenants = await client.query(`SELECT id, name, slug FROM tenants ORDER BY "createdAt" ASC`);
    console.log(`\n=== Z1.8a apply — ${tenants.rowCount} tenants ===\n`);
    let anyDrift = false;
    for (const t of tenants.rows) {
      console.log(`\nTenant: ${t.name} (${t.slug}) — ${t.id}`);
      const applied = await applyForTenant(t.id);
      const after = await verifyTenant(t.id);
      console.log(`  inserted: ${applied.inserted.staffCredentials + applied.inserted.clientCredentials} credentials, ${applied.inserted.teamMemberLifecycle + applied.inserted.endUserLifecycle} lifecycle`);
      console.log(`  final:    ${after.stores.authCredentials} credentials / ${after.stores.teamMemberLifecycle + after.stores.endUserLifecycle} lifecycle / ${after.inSync ? "✓" : "✗"}`);
      if (!after.inSync) anyDrift = true;
    }
    console.log(`\n${anyDrift ? "✗ Drift on at least one tenant" : "✓ All tenants in sync"}\n`);
    process.exit(anyDrift ? 1 : 0);
  } else {
    console.error("Usage:");
    console.error("  node scripts/z1_8_migrate.mjs --verify <tenant-id>");
    console.error("  node scripts/z1_8_migrate.mjs --tenant-id <id>");
    console.error("  node scripts/z1_8_migrate.mjs --all-tenants --yes-i-am-sure");
    process.exit(1);
  }
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => client.end());
