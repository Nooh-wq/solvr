// Azure Container Apps deploy script.
//
// Builds the Docker image (via `az acr build`, so no local Docker daemon is
// required), pushes it to Azure Container Registry, and updates the target
// Container App to the new image.
//
// This intentionally refuses to run rather than silently deploying something
// broken — see the two preflight checks below. Both are documented gaps from
// the developer handover:
//   1. If APP_DATABASE_URL/APP_DIRECT_URL are missing, the app would connect
//      to Postgres as the migration-owning role (BYPASSRLS) instead of
//      app_runtime — RLS enforcement silently disappears. See AGENTS.md.
//   2. NEXT_PUBLIC_* vars are inlined into the build by Next.js at compile
//      time, not read at container runtime — so NEXT_PUBLIC_SITE_URL has to
//      be correct *before* the image is built, or every emailed link
//      (invites, password resets, guest ticket links, CSAT) silently points
//      at the wrong host.
//
// Required environment variables (set these in your shell or CI secrets —
// never commit them):
//   AZURE_RESOURCE_GROUP     e.g. solvr-prod-rg
//   AZURE_ACR_NAME           Azure Container Registry name (no ".azurecr.io")
//   AZURE_CONTAINERAPP_NAME  the Container App to update
//   NEXT_PUBLIC_SITE_URL     the real public origin, e.g. https://solvr.thestralis.com
//
// Usage:
//   node --env-file=.env scripts/azure-deploy.mjs
//   node --env-file=.env scripts/azure-deploy.mjs --dry-run   # preflight only, no build/deploy
//
// Prerequisite: `az login` (and `az acr login`/appropriate RBAC on the ACR
// and Container App) already done in this shell — this script does not
// handle Azure auth itself.

import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "..");
const dryRun = process.argv.includes("--dry-run");

function fail(msg) {
  console.error(`\n✗ ${msg}\n`);
  process.exit(1);
}

function ok(msg) {
  console.log(`✓ ${msg}`);
}

function run(cmd, args, opts = {}) {
  console.log(`\n$ ${cmd} ${args.join(" ")}`);
  const result = spawnSync(cmd, args, { stdio: "inherit", cwd: repoRoot, ...opts });
  if (result.status !== 0) {
    fail(`command failed (exit ${result.status}): ${cmd} ${args.join(" ")}`);
  }
}

console.log("=== Azure Container Apps deploy — preflight ===\n");

// ---------------------------------------------------------------------------
// Preflight 1: RLS-enforcing runtime role must be configured.
// ---------------------------------------------------------------------------
const envPath = path.join(repoRoot, ".env");
if (!existsSync(envPath)) {
  fail(
    ".env not found. Run `node scripts/create-app-runtime-role.mjs` against " +
      "the target database first (after `npm run db:migrate` + `npm run db:rls`)."
  );
}
const envContent = readFileSync(envPath, "utf8");
const hasAppUrl = /^APP_DATABASE_URL=.+/m.test(envContent) && /^APP_DIRECT_URL=.+/m.test(envContent);
if (!hasAppUrl) {
  fail(
    "APP_DATABASE_URL / APP_DIRECT_URL are not set in .env.\n" +
      "  Without them the app falls back to the migration-owning Postgres role, which has\n" +
      "  BYPASSRLS — every RLS policy in prisma/rls_policies.sql becomes silently inert.\n" +
      "  Fix: node scripts/create-app-runtime-role.mjs (run this against the TARGET database,\n" +
      "  i.e. with DATABASE_URL/DIRECT_URL in .env pointed at the production Postgres instance)."
  );
}
ok("APP_DATABASE_URL / APP_DIRECT_URL present in .env");

// ---------------------------------------------------------------------------
// Preflight 2: the public site URL must be the real one before we build.
// ---------------------------------------------------------------------------
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
if (!siteUrl) {
  fail("NEXT_PUBLIC_SITE_URL is not set. Export it before running this script, e.g.\n" +
    "  NEXT_PUBLIC_SITE_URL=https://solvr.thestralis.com node --env-file=.env scripts/azure-deploy.mjs");
}
if (/localhost|127\.0\.0\.1/.test(siteUrl)) {
  fail(
    `NEXT_PUBLIC_SITE_URL is "${siteUrl}" — that's a local address.\n` +
      "  This gets inlined into the built app at image-build time; every emailed link\n" +
      "  (invites, password resets, guest ticket links, CSAT) would point at localhost\n" +
      "  in production. Set it to the real public origin before building."
  );
}
ok(`NEXT_PUBLIC_SITE_URL = ${siteUrl}`);

// ---------------------------------------------------------------------------
// Preflight 3: required Azure config + CLI auth.
// ---------------------------------------------------------------------------
const required = ["AZURE_RESOURCE_GROUP", "AZURE_ACR_NAME", "AZURE_CONTAINERAPP_NAME"];
const missing = required.filter((k) => !process.env[k]);
if (missing.length) {
  fail(`Missing required environment variable(s): ${missing.join(", ")}`);
}
const { AZURE_RESOURCE_GROUP, AZURE_ACR_NAME, AZURE_CONTAINERAPP_NAME } = process.env;
ok(`Resource group: ${AZURE_RESOURCE_GROUP}`);
ok(`ACR: ${AZURE_ACR_NAME}`);
ok(`Container App: ${AZURE_CONTAINERAPP_NAME}`);

try {
  execFileSync("az", ["account", "show"], { stdio: "ignore" });
  ok("az CLI is authenticated");
} catch {
  fail("Not logged into Azure CLI. Run `az login` first.");
}

if (dryRun) {
  console.log("\n--dry-run: all preflight checks passed. Not building or deploying.\n");
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Build (in ACR — no local Docker daemon needed) + deploy.
// ---------------------------------------------------------------------------
let gitSha = "manual";
try {
  gitSha = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: repoRoot }).toString().trim();
} catch {
  console.warn("(not a git checkout or git unavailable — tagging image as 'manual')");
}
const imageTag = `solvr:${gitSha}`;

console.log(`\n=== Building ${imageTag} in ACR ${AZURE_ACR_NAME} ===`);
run("az", [
  "acr",
  "build",
  "--registry",
  AZURE_ACR_NAME,
  "--image",
  imageTag,
  "--build-arg",
  `NEXT_PUBLIC_SITE_URL=${siteUrl}`,
  ".",
]);

console.log(`\n=== Updating Container App ${AZURE_CONTAINERAPP_NAME} ===`);
const acrLoginServer = `${AZURE_ACR_NAME}.azurecr.io`;
run("az", [
  "containerapp",
  "update",
  "--name",
  AZURE_CONTAINERAPP_NAME,
  "--resource-group",
  AZURE_RESOURCE_GROUP,
  "--image",
  `${acrLoginServer}/${imageTag}`,
]);

console.log(`\n✓ Deployed ${acrLoginServer}/${imageTag} to ${AZURE_CONTAINERAPP_NAME}.\n`);
console.log(
  "Reminder: this does NOT cut DNS over to Azure. solvr.thestralis.com still points\n" +
    "at whatever it pointed at before — that's a separate, deliberate step."
);
