// Verify (and, when needed, refresh) the mirrored Shared Platform models in
// this repo's prisma/schema.prisma. See docs/shared-platform-boundary.md.
//
// Behavior:
//   - Reads the mirror block from this repo's prisma/schema.prisma (marked
//     by the STRALIS SHARED PLATFORM — REFERENCE MODELS banner comments).
//   - Reads the source of truth from ../Stralis Shared Platform/prisma/
//     schema.prisma (or the path in SHARED_PLATFORM_SCHEMA env var).
//   - Diffs the shared models + enums line-by-line, ignoring generator/
//     datasource blocks and header comments that legitimately differ
//     between the two files.
//   - Prints a summary. Exits 0 if in sync, 1 if drifted.
//
// Manual workflow when drift is reported:
//   1. Open the source-of-truth schema.prisma.
//   2. Copy models + enums into this repo's mirror block.
//   3. Run this script again to confirm.
//   4. Run `npx prisma generate` + `npx tsc --noEmit`.
//   5. Commit as a standalone "refresh shared platform mirror" change.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const HERE_SCHEMA = "prisma/schema.prisma";
const THERE_SCHEMA_DEFAULT = resolve(
  process.cwd(),
  "..",
  "Stralis Shared Platform",
  "prisma",
  "schema.prisma"
);
const THERE_SCHEMA = process.env.SHARED_PLATFORM_SCHEMA ?? THERE_SCHEMA_DEFAULT;

const MIRROR_START = "// STRALIS SHARED PLATFORM — REFERENCE MODELS (Z1: Six-Object Model Refactor)";
const MIRROR_END = "// END OF STRALIS SHARED PLATFORM REFERENCE MODELS";

// Model/enum names that live in the shared platform.
const SHARED_TYPES = [
  "TicketAccessScope",
  "TagTargetType",
  "AuditActorType",
  "Organization",
  "EndUser",
  "EndUserOrganization",
  "TeamMember",
  "Group",
  "TeamMemberGroup",
  "Role",
  "Tag",
  "TagAssignment",
  "CoreAuditLog",
];

function readFile(path) {
  try {
    return readFileSync(path, "utf8");
  } catch (e) {
    console.error(`Cannot read ${path}: ${e.message}`);
    process.exit(1);
  }
}

/**
 * Extract every declaration (model or enum) whose name is in SHARED_TYPES.
 * Returns an object keyed by name → normalized declaration body (trimmed lines
 * concatenated with \n so trailing-whitespace and blank-line diffs don't
 * false-positive). Comments inside the declaration are preserved because
 * they carry real intent.
 */
function extractDeclarations(source) {
  const out = {};
  const lines = source.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const match = /^(model|enum)\s+(\w+)\s*\{/.exec(line);
    if (match && SHARED_TYPES.includes(match[2])) {
      const name = match[2];
      const collected = [line];
      let depth = 1;
      i++;
      while (i < lines.length && depth > 0) {
        const l = lines[i];
        for (const ch of l) {
          if (ch === "{") depth++;
          else if (ch === "}") depth--;
        }
        collected.push(l);
        i++;
      }
      out[name] = collected.map((l) => l.trimEnd()).join("\n");
    } else {
      i++;
    }
  }
  return out;
}

const hereSource = readFile(HERE_SCHEMA);
const thereSource = readFile(THERE_SCHEMA);

const startIdx = hereSource.indexOf(MIRROR_START);
const endIdx = hereSource.indexOf(MIRROR_END);
if (startIdx === -1 || endIdx === -1) {
  console.error(
    `Mirror block markers not found in ${HERE_SCHEMA}.\n` +
      `Expected banner comments:\n  ${MIRROR_START}\n  ${MIRROR_END}`
  );
  process.exit(1);
}
const mirrorSection = hereSource.slice(startIdx, endIdx);

const here = extractDeclarations(mirrorSection);
const there = extractDeclarations(thereSource);

let drifted = 0;
const missing = [];
const extra = [];
const changed = [];

for (const name of SHARED_TYPES) {
  const a = here[name];
  const b = there[name];
  if (!a && !b) continue;
  if (!a) missing.push(name);
  else if (!b) extra.push(name);
  else if (a !== b) changed.push(name);
}

if (missing.length) {
  drifted += missing.length;
  console.log(`\nMISSING in this repo's mirror (present in Shared Platform):`);
  for (const n of missing) console.log(`  - ${n}`);
}
if (extra.length) {
  drifted += extra.length;
  console.log(`\nEXTRA in this repo's mirror (not in Shared Platform):`);
  for (const n of extra) console.log(`  - ${n}`);
}
if (changed.length) {
  drifted += changed.length;
  console.log(`\nDRIFTED (body differs between the two schemas):`);
  for (const n of changed) {
    console.log(`  - ${n}`);
    console.log(`      here:  ${here[n].split("\n").length} lines`);
    console.log(`      there: ${there[n].split("\n").length} lines`);
  }
}

if (drifted === 0) {
  console.log(`✓ Mirror is in sync (${SHARED_TYPES.length} declarations checked).`);
  console.log(`  This repo:      ${HERE_SCHEMA}`);
  console.log(`  Source of truth: ${THERE_SCHEMA}`);
  process.exit(0);
}

console.log(
  `\n✗ Mirror is out of sync. Follow docs/shared-platform-boundary.md §4 to refresh.\n`
);
process.exit(1);
