// One-time setup: creates a least-privileged Postgres role (no BYPASSRLS) for
// the app to connect as at runtime, so RLS policies are actually enforced.
// Migrations keep using the `postgres` role (DATABASE_URL/DIRECT_URL);
// this generates APP_DATABASE_URL/APP_DIRECT_URL for src/lib/db.ts to use.
//
// The generated password is never printed — it's written straight to .env.
import "dotenv/config";
import pg from "pg";
import crypto from "node:crypto";
import fs from "node:fs";

const ROLE = "app_runtime";
const password = crypto.randomBytes(24).toString("base64").replace(/[+/=]/g, "");

const client = new pg.Client({ connectionString: process.env.DIRECT_URL });
await client.connect();

// DO blocks can't take bind parameters (no SPI param passthrough), so the
// password is interpolated directly. It's generated in-process and never
// logged/printed, so this doesn't leak it — safe despite not being $1-bound.
const escapedPassword = password.replace(/'/g, "''");
await client.query(
  `DO $do$ BEGIN IF EXISTS (SELECT FROM pg_roles WHERE rolname = '${ROLE}') THEN
     ALTER ROLE ${ROLE} WITH PASSWORD '${escapedPassword}';
   ELSE
     CREATE ROLE ${ROLE} LOGIN PASSWORD '${escapedPassword}';
   END IF; END $do$;`
);
await client.query(`GRANT USAGE ON SCHEMA public TO ${ROLE}`);
await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${ROLE}`);
await client.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${ROLE}`);
await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${ROLE}`);
await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ${ROLE}`);

const check = await client.query(
  `select rolname, rolsuper, rolbypassrls from pg_roles where rolname = $1`,
  [ROLE]
);
await client.end();

// Build the pooled/direct URLs by swapping user+password into the existing
// DATABASE_URL/DIRECT_URL hosts, so we don't have to ask for them again.
// Supabase's pooler (Supavisor) encodes the project ref in the username as
// "<role>.<project-ref>" for routing — preserve that suffix if present,
// otherwise the pooler rejects the connection with ENOIDENTIFIER.
function swapCredentials(url, user, pass) {
  const u = new URL(url);
  const existingUser = decodeURIComponent(u.username);
  const dotIndex = existingUser.indexOf(".");
  const newUsername = dotIndex === -1 ? user : `${user}${existingUser.slice(dotIndex)}`;
  u.username = encodeURIComponent(newUsername);
  u.password = encodeURIComponent(pass);
  return u.toString();
}

const appDatabaseUrl = swapCredentials(process.env.DATABASE_URL, ROLE, password);
const appDirectUrl = swapCredentials(process.env.DIRECT_URL, ROLE, password);

const envPath = new URL("../.env", import.meta.url);
let envContent = fs.readFileSync(envPath, "utf8");
if (envContent.includes("APP_DATABASE_URL=")) {
  envContent = envContent
    .replace(/APP_DATABASE_URL=.*/g, `APP_DATABASE_URL="${appDatabaseUrl}"`)
    .replace(/APP_DIRECT_URL=.*/g, `APP_DIRECT_URL="${appDirectUrl}"`);
} else {
  envContent += `\n# Runtime app connection (least-privileged, RLS-enforced — see scripts/create-app-runtime-role.mjs)\nAPP_DATABASE_URL="${appDatabaseUrl}"\nAPP_DIRECT_URL="${appDirectUrl}"\n`;
}
fs.writeFileSync(envPath, envContent);

console.log("Role ready:", check.rows[0]);
console.log("APP_DATABASE_URL / APP_DIRECT_URL written to .env (password not printed).");
