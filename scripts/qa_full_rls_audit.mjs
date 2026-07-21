// QA sweep — full RLS audit across EVERY tenant-scoped table.
//
// Two layers:
//   1. Metadata (owner connection): every public table with a "tenantId"
//      column must have relrowsecurity = true and at least one policy.
//   2. Functional (app_runtime connection — the role the app actually
//      uses, no BYPASSRLS): inside a transaction with
//      app.tenant_id = a bogus id and app.role = 'ADMIN', count(*) on
//      each tenant-scoped table must be 0. Non-zero means the policy
//      leaks rows across tenants.
//
// Tables WITHOUT a tenantId column are listed for manual review (some
// are global by design: _prisma_migrations, tenants themselves).
//
// Usage: node --env-file=.env scripts/qa_full_rls_audit.mjs
import "dotenv/config";
import pg from "pg";

const BOGUS_TENANT = "qa-bogus-tenant-00000000";

const owner = new pg.Client({ connectionString: process.env.DIRECT_URL });
await owner.connect();

const { rows: tenantTables } = await owner.query(`
  SELECT c.table_name,
         cls.relrowsecurity,
         (SELECT count(*)::int FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = c.table_name) AS policy_count
  FROM information_schema.columns c
  JOIN pg_class cls ON cls.relname = c.table_name
  JOIN pg_namespace n ON n.oid = cls.relnamespace AND n.nspname = 'public'
  WHERE c.table_schema = 'public' AND c.column_name = 'tenantId' AND cls.relkind = 'r'
  ORDER BY c.table_name
`);

const { rows: otherTables } = await owner.query(`
  SELECT cls.relname AS table_name
  FROM pg_class cls
  JOIN pg_namespace n ON n.oid = cls.relnamespace AND n.nspname = 'public'
  WHERE cls.relkind = 'r'
    AND cls.relname NOT IN (
      SELECT c.table_name FROM information_schema.columns c
      WHERE c.table_schema = 'public' AND c.column_name = 'tenantId'
    )
  ORDER BY cls.relname
`);
await owner.end();

let metaFailures = 0;
for (const t of tenantTables) {
  const problems = [];
  if (!t.relrowsecurity) problems.push("RLS NOT ENABLED");
  if (t.policy_count === 0) problems.push("NO POLICIES");
  if (problems.length) {
    metaFailures++;
    console.log(`META FAIL  ${t.table_name}: ${problems.join(", ")}`);
  }
}
console.log(
  `\n[meta] ${tenantTables.length} tenant-scoped tables checked, ${metaFailures} metadata failure(s)`
);

// Functional probe through the app runtime role.
const appUrl = process.env.APP_DIRECT_URL ?? process.env.APP_DATABASE_URL;
if (!appUrl) {
  console.log("[functional] SKIPPED — no APP_DATABASE_URL/APP_DIRECT_URL set");
  process.exit(metaFailures ? 1 : 0);
}
const app = new pg.Client({ connectionString: appUrl });
await app.connect();

let leakFailures = 0;
for (const t of tenantTables) {
  await app.query("BEGIN");
  try {
    await app.query(
      `SELECT set_config('app.tenant_id', $1, true),
              set_config('app.user_id', '', true),
              set_config('app.role', 'ADMIN', true),
              set_config('app.guest_ticket_id', '', true)`,
      [BOGUS_TENANT]
    );
    const { rows } = await app.query(`SELECT count(*)::int AS n FROM "${t.table_name}"`);
    if (rows[0].n !== 0) {
      leakFailures++;
      console.log(`LEAK FAIL  ${t.table_name}: bogus tenant sees ${rows[0].n} row(s)`);
    }
  } catch (e) {
    console.log(`PROBE ERR  ${t.table_name}: ${e.message}`);
  } finally {
    await app.query("ROLLBACK");
  }
}
await app.end();

console.log(`[functional] ${tenantTables.length} tables probed as bogus tenant, ${leakFailures} leak(s)`);
console.log(`\n[review] tables without tenantId column (global by design or keyed differently):`);
for (const t of otherTables) console.log(`  - ${t.table_name}`);

process.exit(metaFailures + leakFailures ? 1 : 0);
