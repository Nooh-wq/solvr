// Runs a local Postgres-compatible server for development, backed by
// PGlite (real Postgres compiled to WASM). No system Postgres install,
// no OS service, no credentials to manage — Prisma talks to it over the
// normal Postgres wire protocol like any other DATABASE_URL.
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, "..", ".local-pg-data");

const db = new PGlite(dataDir);
const server = new PGLiteSocketServer({ db, host: "127.0.0.1", port: 5433 });

await server.start();
console.log(`Local Postgres (PGlite) listening on postgresql://127.0.0.1:5433/postgres`);
console.log(`Data persisted to ${dataDir}`);

process.on("SIGINT", async () => {
  await server.stop();
  process.exit(0);
});
