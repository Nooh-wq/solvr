// src/core/rbac/mapping.ts
//
// B1 (Z-post / M7 platform layer) — the single source of truth for
// mapping a wrapper Role.name (the human-facing name seeded by
// seedStandardRoles(), plus any custom role names an admin creates)
// to the canonical staff RLS-role tier used for both app-layer
// permission checks and the Postgres `app.role` session GUC.
//
// Extracted so:
//   1. Support-side (Z5's coming platform work) and M7's API-key
//      layer both consume the same rule set. Two copies would silently
//      diverge over time as new standard roles are introduced.
//   2. Consumers can unit-test the RBAC boundary without dragging in
//      Prisma, jose, or the whole session runtime.
//
// Domain of this function: **TeamMember identities only**. Guest
// sessions carry a guest-invite token (never a Role.name) and end
// users carry no role name at all — those paths bypass this mapper
// entirely and produce "GUEST" / "CLIENT" respectively at the callsite.
// See src/lib/auth.ts::getSessionUser for the wider assembly.
//
// Security invariant, preserved from src/lib/auth.ts and mirrored in
// src/actions/auth.ts prior to this extraction: **any Role.name we
// don't recognise falls back to AGENT** — never a higher tier. This
// blocks the failure mode where an admin creates a custom role named,
// say, "Super Admin " (trailing space) or "SUPER_ADMIN" (enum form)
// hoping to inherit elevated privileges via a fuzzy match. Only the
// three exact standard-role names elevate.

/**
 * The RLS-role tier a TeamMember session runs at. Narrower than the
 * full session-role union — CLIENT and GUEST come from non-TeamMember
 * paths (EndUser sessions, guest invites) and are not producible here.
 */
export type TeamMemberRlsRole = "SUPER_ADMIN" | "ADMIN" | "AGENT";

/**
 * Maps a wrapper Role.name to a TeamMemberRlsRole.
 *
 * - Standard-role names ("Super Admin", "Admin", "Agent") — exact,
 *   case-sensitive match required. These are the names emitted by
 *   seedStandardRoles() and any tenant's Role table.
 * - Anything else — including custom role names, misspellings,
 *   different casing, or the enum-form values themselves — maps to
 *   "AGENT". This is the safe-fallback invariant; see the file-level
 *   comment for the reasoning.
 */
export function mapRoleNameToRlsRole(name: string): TeamMemberRlsRole {
  if (name === "Super Admin") return "SUPER_ADMIN";
  if (name === "Admin") return "ADMIN";
  if (name === "Agent") return "AGENT";
  return "AGENT";
}
