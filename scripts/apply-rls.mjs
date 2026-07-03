import "dotenv/config";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(path.join(__dirname, "..", "prisma", "rls_policies.sql"), "utf8");

const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!url) {
  console.error("Set DIRECT_URL (or DATABASE_URL) before running db:rls.");
  process.exit(1);
}

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  await client.query(sql);
  console.log("RLS policies applied.");
} finally {
  await client.end();
}
