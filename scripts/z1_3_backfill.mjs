// Z1.3 backfill: reads every legacy User + Company row and (in APPLY mode)
// writes the corresponding EndUser / TeamMember / Organization rows via the
// Z1.2 wrapper. Preserves IDs so Z1.4's FK rename becomes a column-level
// operation (see docs/shared-platform-boundary.md §7.6). Seeds standard
// Roles + default Group per tenant. Assigns every team-member User to the
// default group.
//
// Defaults to DRY-RUN. Pass `--apply` to actually write. Prints the same
// projection either way; APPLY mode additionally reports actual counts and
// verifies them against the projection.
//
// Idempotent under re-run: existing Organizations/EndUsers/TeamMembers are
// skipped (by id lookup); seedStandardRoles + getOrCreateDefaultGroup +
// assign* are wrapper-idempotent already.

import { config } from "dotenv";
import { randomUUID } from "node:crypto";
import pg from "pg";
config();

// Raw SQL bypasses Prisma's @default(cuid()); allocate ids ourselves for
// rows we're NOT preserving legacy ids on (roles, groups, team_member_groups,
// core_audit_logs). Standard UUID strings fit the text-typed id columns.
function newId() {
  return randomUUID();
}

const APPLY = process.argv.includes("--apply");

// ---------------------------------------------------------------------------
// Personal-mail domains — must match src/lib/shared-platform/organizations.ts.
// ---------------------------------------------------------------------------

const PERSONAL_DOMAINS = new Set([
  "gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "icloud.com",
  "aol.com", "protonmail.com", "proton.me", "live.com", "msn.com",
  "me.com", "mail.com", "gmx.com", "zoho.com", "yandex.com",
]);

function extractCompanyDomain(email) {
  const domain = email.split("@")[1]?.toLowerCase();
  if (!domain) return null;
  if (PERSONAL_DOMAINS.has(domain)) return null;
  return domain;
}

const LEGACY_ROLE_TO_STANDARD_ROLE = {
  SUPER_ADMIN: "Super Admin",
  ADMIN: "Admin",
  AGENT: "Agent",
};

function isTeamMemberRole(legacyRole) {
  return legacyRole in LEGACY_ROLE_TO_STANDARD_ROLE;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const client = new pg.Client({
  connectionString: process.env.DIRECT_URL,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

const mode = APPLY ? "APPLY" : "DRY-RUN";
console.log(`\n=== Z1.3 backfill — mode: ${mode} ===\n`);

// -- READ phase ------------------------------------------------------------

const tenants = (await client.query(`SELECT id, name, slug, type FROM tenants ORDER BY name ASC`)).rows;

const usersAll = (
  await client.query(`
    SELECT id, "tenantId", email, name, role, company, "companyId", status
    FROM users
    ORDER BY "tenantId" ASC, email ASC
  `)
).rows;

const companiesAll = (
  await client.query(`
    SELECT id, "tenantId", name, country, domain
    FROM companies
    ORDER BY "tenantId" ASC, name ASC
  `)
).rows;

const usersByTenant = new Map();
for (const u of usersAll) {
  if (!usersByTenant.has(u.tenantId)) usersByTenant.set(u.tenantId, []);
  usersByTenant.get(u.tenantId).push(u);
}
const companiesByTenant = new Map();
for (const c of companiesAll) {
  if (!companiesByTenant.has(c.tenantId)) companiesByTenant.set(c.tenantId, []);
  companiesByTenant.get(c.tenantId).push(c);
}

// ---------------------------------------------------------------------------
// Projection
// ---------------------------------------------------------------------------

const projection = {
  totals: {
    tenants: tenants.length,
    companies: companiesAll.length,
    users: usersAll.length,
  },
  byRole: { CLIENT: 0, AGENT: 0, ADMIN: 0, SUPER_ADMIN: 0 },
  byStatus: { UNVERIFIED: 0, PENDING: 0, ACTIVE: 0, REJECTED: 0, SUSPENDED: 0, INVITED: 0 },
  transformations: {
    companiesToOrganizations: 0,
    usersToEndUsers: 0,
    usersToTeamMembers: 0,
  },
  // ALL-users linkage (informational, includes staff whose companyId
  // resolves in the legacy schema but who won't carry organizationId in
  // the new model since TeamMember has no such field).
  organizationLinkageAllUsers: {
    linkedByCompanyId: 0,
    linkedByEmailDomainMatch: 0,
    linkedByCompanyStringLookup: 0,
    unlinked: 0,
  },
  // EndUser-only linkage — this is the one that maps to actual writes.
  // CLIENT users become EndUsers; only EndUser.organizationId exists on
  // the new side.
  organizationLinkageEndUsersOnly: {
    linkedByCompanyId: 0,
    linkedByEmailDomainMatch: 0,
    linkedByCompanyStringLookup: 0,
    unlinked: 0,
  },
  seeds: {
    rolesPerTenantExpected: 3,
    rolesTotalToSeed: tenants.length * 3,
    defaultGroupsToCreate: tenants.length,
    teamMemberGroupAssignments: 0,
  },
  anomalies: [],
  auditRowsExpected: 0,
};

const perTenant = [];

for (const t of tenants) {
  const usersHere = usersByTenant.get(t.id) ?? [];
  const companiesHere = companiesByTenant.get(t.id) ?? [];

  const companyById = new Map(companiesHere.map((c) => [c.id, c]));
  const companyByName = new Map(companiesHere.map((c) => [c.name, c]));
  const companyByDomain = new Map();
  for (const c of companiesHere) {
    if (c.domain) companyByDomain.set(c.domain.toLowerCase(), c);
  }

  let tCLIENT = 0, tAGENT = 0, tADMIN = 0, tSUPER = 0;
  let tByCompanyIdAll = 0, tByDomainAll = 0, tByStringAll = 0, tUnlinkedAll = 0;
  let tByCompanyIdEU = 0, tByDomainEU = 0, tByStringEU = 0, tUnlinkedEU = 0;
  let tCountryLoss = 0;

  for (const c of companiesHere) {
    if (c.country) tCountryLoss++;
  }
  if (tCountryLoss > 0) {
    projection.anomalies.push({
      tenant: t.name,
      kind: "COMPANY_COUNTRY_DATA_LOSS",
      count: tCountryLoss,
      note: "Company.country has no counterpart on Organization; values will be discarded at backfill unless the Shared Platform adds a country column first.",
    });
  }

  for (const u of usersHere) {
    projection.byRole[u.role] = (projection.byRole[u.role] ?? 0) + 1;
    projection.byStatus[u.status] = (projection.byStatus[u.status] ?? 0) + 1;
    if (u.role === "CLIENT") tCLIENT++;
    else if (u.role === "AGENT") tAGENT++;
    else if (u.role === "ADMIN") tADMIN++;
    else if (u.role === "SUPER_ADMIN") tSUPER++;

    // Compute linkage bucket for this user
    let bucket; // "byCoId" | "byDomain" | "byString" | "unlinked"
    if (u.companyId) {
      if (companyById.has(u.companyId)) {
        bucket = "byCoId";
      } else {
        projection.anomalies.push({
          tenant: t.name,
          kind: "USER_ORPHAN_COMPANY_FK",
          userEmail: u.email,
          companyId: u.companyId,
          note: "User.companyId does not resolve to any Company row in the same tenant. Will be treated as null.",
        });
        const dom = extractCompanyDomain(u.email);
        if (dom && companyByDomain.has(dom)) bucket = "byDomain";
        else if (u.company && companyByName.has(u.company)) bucket = "byString";
        else bucket = "unlinked";
      }
    } else {
      const dom = extractCompanyDomain(u.email);
      if (dom && companyByDomain.has(dom)) bucket = "byDomain";
      else if (u.company && companyByName.has(u.company)) bucket = "byString";
      else bucket = "unlinked";
    }

    // Count into ALL-users linkage
    if (bucket === "byCoId") tByCompanyIdAll++;
    else if (bucket === "byDomain") tByDomainAll++;
    else if (bucket === "byString") tByStringAll++;
    else tUnlinkedAll++;

    // Count into EndUser-only linkage (CLIENT role only)
    if (u.role === "CLIENT") {
      if (bucket === "byCoId") tByCompanyIdEU++;
      else if (bucket === "byDomain") tByDomainEU++;
      else if (bucket === "byString") tByStringEU++;
      else tUnlinkedEU++;
    }

    if ((u.role === "SUPER_ADMIN" || u.role === "ADMIN") &&
        (u.status === "INVITED" || u.status === "PENDING" || u.status === "REJECTED" || u.status === "SUSPENDED")) {
      projection.anomalies.push({
        tenant: t.name,
        kind: "STAFF_NON_ACTIVE_STATUS",
        userEmail: u.email,
        role: u.role,
        status: u.status,
        note: "A staff-level role is attached to a non-ACTIVE user. Will be backfilled anyway (row-count parity), but consumers should be aware.",
      });
    }

    if (!u.email || u.email.trim() === "") {
      projection.anomalies.push({
        tenant: t.name,
        kind: "USER_MISSING_EMAIL",
        userId: u.id,
        note: "Cannot backfill — EndUser/TeamMember schema requires non-null email. Will be SKIPPED in APPLY mode.",
      });
    }

    if (!u.companyId && u.company && !companyByName.has(u.company)) {
      projection.anomalies.push({
        tenant: t.name,
        kind: "USER_COMPANY_STRING_UNMATCHED",
        userEmail: u.email,
        companyString: u.company,
        note: "Legacy User.company (string) does not match any Company row in this tenant. Falls through to domain-match then null.",
      });
    }
  }

  const tOrgs = companiesHere.length;
  const tEndUsers = tCLIENT;
  const tTeamMembers = tAGENT + tADMIN + tSUPER;

  projection.transformations.companiesToOrganizations += tOrgs;
  projection.transformations.usersToEndUsers += tEndUsers;
  projection.transformations.usersToTeamMembers += tTeamMembers;
  projection.organizationLinkageAllUsers.linkedByCompanyId += tByCompanyIdAll;
  projection.organizationLinkageAllUsers.linkedByEmailDomainMatch += tByDomainAll;
  projection.organizationLinkageAllUsers.linkedByCompanyStringLookup += tByStringAll;
  projection.organizationLinkageAllUsers.unlinked += tUnlinkedAll;
  projection.organizationLinkageEndUsersOnly.linkedByCompanyId += tByCompanyIdEU;
  projection.organizationLinkageEndUsersOnly.linkedByEmailDomainMatch += tByDomainEU;
  projection.organizationLinkageEndUsersOnly.linkedByCompanyStringLookup += tByStringEU;
  projection.organizationLinkageEndUsersOnly.unlinked += tUnlinkedEU;
  projection.seeds.teamMemberGroupAssignments += tTeamMembers;

  // Expected CoreAuditLog rows per tenant on a fresh run:
  //   3 seedStandardRoles + 1 getOrCreateDefaultGroup
  //   + N Organization CREATE + N EndUser CREATE + N TeamMember CREATE
  //   + N TeamMember→Group ASSIGN
  projection.auditRowsExpected += 3 + 1 + tOrgs + tEndUsers + tTeamMembers + tTeamMembers;

  perTenant.push({
    tenantId: t.id,
    tenantName: t.name,
    tenantSlug: t.slug,
    tenantType: t.type,
    companies: tOrgs,
    users: usersHere.length,
    endUsers: tEndUsers,
    teamMembers: tTeamMembers,
    linkageAll: {
      byCompanyId: tByCompanyIdAll,
      byDomain: tByDomainAll,
      byString: tByStringAll,
      unlinked: tUnlinkedAll,
    },
    linkageEU: {
      byCompanyId: tByCompanyIdEU,
      byDomain: tByDomainEU,
      byString: tByStringEU,
      unlinked: tUnlinkedEU,
    },
    countryLoss: tCountryLoss,
  });
}

// ---------------------------------------------------------------------------
// Cross-tenant email check (informational — same email in >1 tenant means
// two distinct new-model rows will be created, one per tenant; that's not
// an error under the per-tenant unique email constraint, but callers
// working with a single email may not expect it).
// ---------------------------------------------------------------------------

const emailToTenants = new Map();
for (const u of usersAll) {
  if (!u.email) continue;
  const key = u.email.toLowerCase();
  if (!emailToTenants.has(key)) emailToTenants.set(key, new Set());
  emailToTenants.get(key).add(u.tenantId);
}
for (const [email, tenantIdSet] of emailToTenants) {
  if (tenantIdSet.size > 1) {
    const tenantNames = tenants
      .filter((t) => tenantIdSet.has(t.id))
      .map((t) => t.name);
    projection.anomalies.push({
      kind: "CROSS_TENANT_EMAIL",
      email,
      tenants: tenantNames,
      note: "Email appears in more than one tenant. Each tenant will get its own EndUser/TeamMember row (per-tenant unique email is enforced). This is expected for consultants/staff who are also customers elsewhere — informational only.",
    });
  }
}

// ---------------------------------------------------------------------------
// Print projection
// ---------------------------------------------------------------------------

console.log(`--- TOTALS ---`);
console.log(`  Tenants:                        ${projection.totals.tenants}`);
console.log(`  Companies (legacy):             ${projection.totals.companies}`);
console.log(`  Users (legacy):                 ${projection.totals.users}`);

console.log(`\n--- BY ROLE ---`);
for (const [r, n] of Object.entries(projection.byRole)) {
  console.log(`  ${r.padEnd(13)} ${String(n).padStart(4)}`);
}

console.log(`\n--- BY STATUS ---`);
for (const [s, n] of Object.entries(projection.byStatus)) {
  console.log(`  ${s.padEnd(13)} ${String(n).padStart(4)}`);
}

console.log(`\n--- TRANSFORMATIONS (projected) ---`);
console.log(`  Companies → Organizations:      ${projection.transformations.companiesToOrganizations}`);
console.log(`  Users(CLIENT) → EndUsers:       ${projection.transformations.usersToEndUsers}`);
console.log(`  Users(staff) → TeamMembers:     ${projection.transformations.usersToTeamMembers}`);

console.log(`\n--- ORGANIZATION LINKAGE (all users, informational) ---`);
console.log(`  Linked via User.companyId:      ${projection.organizationLinkageAllUsers.linkedByCompanyId}`);
console.log(`  Auto-matched by email domain:   ${projection.organizationLinkageAllUsers.linkedByEmailDomainMatch}`);
console.log(`  Matched via legacy company str: ${projection.organizationLinkageAllUsers.linkedByCompanyStringLookup}`);
console.log(`  Left unlinked:                  ${projection.organizationLinkageAllUsers.unlinked}`);

console.log(`\n--- ORGANIZATION LINKAGE (EndUsers only — actual writes) ---`);
console.log(`  Linked via User.companyId:      ${projection.organizationLinkageEndUsersOnly.linkedByCompanyId}`);
console.log(`  Auto-matched by email domain:   ${projection.organizationLinkageEndUsersOnly.linkedByEmailDomainMatch}`);
console.log(`  Matched via legacy company str: ${projection.organizationLinkageEndUsersOnly.linkedByCompanyStringLookup}`);
console.log(`  Left with null organizationId:  ${projection.organizationLinkageEndUsersOnly.unlinked}`);

console.log(`\n--- SEEDS ---`);
console.log(`  Roles per tenant seeded:        ${projection.seeds.rolesPerTenantExpected} (Super Admin / Admin / Agent)`);
console.log(`  Total Role rows on fresh run:   ${projection.seeds.rolesTotalToSeed}`);
console.log(`  Default Groups to create:       ${projection.seeds.defaultGroupsToCreate}`);
console.log(`  TeamMember→Group assignments:   ${projection.seeds.teamMemberGroupAssignments}`);

console.log(`\n--- COREAUDITLOG (expected fresh run) ---`);
console.log(`  Rows to write:                  ${projection.auditRowsExpected}`);

console.log(`\n--- PER-TENANT DETAIL ---`);
console.log(`  (linkage columns split: All = all users; EU = EndUsers only)`);
console.log(`  ${"tenant".padEnd(24)} ${"type".padEnd(10)} ${"cos".padStart(4)} ${"usrs".padStart(4)} ${"eu".padStart(4)} ${"tm".padStart(4)}   ${"All(coId/dom/str/none)".padEnd(24)}  ${"EU(coId/dom/str/none)".padEnd(24)}`);
for (const t of perTenant) {
  const all = `${t.linkageAll.byCompanyId}/${t.linkageAll.byDomain}/${t.linkageAll.byString}/${t.linkageAll.unlinked}`;
  const eu = `${t.linkageEU.byCompanyId}/${t.linkageEU.byDomain}/${t.linkageEU.byString}/${t.linkageEU.unlinked}`;
  console.log(
    `  ${t.tenantName.slice(0, 24).padEnd(24)} ${t.tenantType.padEnd(10)}` +
    ` ${String(t.companies).padStart(4)}` +
    ` ${String(t.users).padStart(4)}` +
    ` ${String(t.endUsers).padStart(4)}` +
    ` ${String(t.teamMembers).padStart(4)}   ` +
    all.padEnd(24) + "  " + eu.padEnd(24)
  );
}

console.log(`\n--- ANOMALIES (${projection.anomalies.length}) ---`);
if (projection.anomalies.length === 0) {
  console.log(`  (none)`);
} else {
  const byKind = new Map();
  for (const a of projection.anomalies) {
    if (!byKind.has(a.kind)) byKind.set(a.kind, []);
    byKind.get(a.kind).push(a);
  }
  for (const [kind, list] of byKind) {
    console.log(`\n  ${kind} (${list.length}):`);
    console.log(`    ${list[0].note}`);
    for (const a of list.slice(0, 10)) {
      const { kind: _k, note: _n, ...rest } = a;
      console.log(`      - ${JSON.stringify(rest)}`);
    }
    if (list.length > 10) console.log(`      ...(${list.length - 10} more suppressed)`);
  }
}

if (!APPLY) {
  console.log(`\n=== DRY-RUN complete. No writes performed. ===`);
  console.log(`    Re-run with \`--apply\` after review to actually write.`);
  await client.end();
  process.exit(0);
}

// ---------------------------------------------------------------------------
// APPLY mode
// ---------------------------------------------------------------------------

console.log(`\n\n=== APPLY mode starting ===\n`);

// Dynamic import the wrapper — it's TS/Next-alias code, so we route through
// a runtime that understands it. Simpler here: use the raw pg client for
// the actual writes, since we're a one-shot script and the wrapper's own
// withRls transactions plus the tsc/next tooling would need bootstrapping
// for a .mjs script.
//
// Rationale: boundary-doc rule 4 forbids consumer code from bypassing the
// wrapper, but Z1.3 backfill is explicitly named as an exception in
// §7.6 — it's the one-shot script that populates the tables the wrapper
// wraps, and every write here mirrors what the wrapper would produce
// (id preservation via the same input.id fields we just added, plus
// hand-written CoreAuditLog inserts with actorType=SYSTEM and actorId=NULL
// to match wrapper output on a systemContext).

// Snapshot BEFORE for verification
const before = await snapshot(client);

const actual = {
  organizationsCreated: 0,
  organizationsSkipped: 0,
  endUsersCreated: 0,
  endUsersSkipped: 0,
  teamMembersCreated: 0,
  teamMembersSkipped: 0,
  rolesSeeded: 0,
  groupsCreated: 0,
  groupsFound: 0,
  teamMemberGroupAssignments: 0,
  teamMemberGroupSkipped: 0,
  auditRowsWritten: 0,
  errors: [],
};

for (const t of tenants) {
  const tenantId = t.id;
  console.log(`\n[tenant ${t.name} / ${tenantId}]`);

  // --- 1. Seed standard roles (idempotent, id NOT preserved — roles are
  //        new-model concepts with no legacy id to preserve) ---
  const standardRoleNames = ["Super Admin", "Admin", "Agent"];
  const roleIdByName = new Map();
  for (const name of standardRoleNames) {
    const existing = await client.query(
      `SELECT id FROM roles WHERE "tenantId" = $1 AND name = $2 LIMIT 1`,
      [tenantId, name]
    );
    if (existing.rows[0]) {
      roleIdByName.set(name, existing.rows[0].id);
      console.log(`  role "${name}": exists (${existing.rows[0].id})`);
    } else {
      const inserted = await client.query(
        `INSERT INTO roles (id, "tenantId", name, "isCustom", permissions, "updatedAt")
         VALUES ($1, $2, $3, false, '{}'::jsonb, NOW())
         RETURNING id`,
        [newId(), tenantId, name]
      );
      roleIdByName.set(name, inserted.rows[0].id);
      actual.rolesSeeded++;
      await writeAudit(client, tenantId, "CREATE", "Role", inserted.rows[0].id, null, { name, isCustom: false });
      actual.auditRowsWritten++;
      console.log(`  role "${name}": CREATED (${inserted.rows[0].id})`);
    }
  }

  // --- 2. Default group (idempotent) ---
  const defaultGroupQ = await client.query(
    `SELECT id FROM groups WHERE "tenantId" = $1 AND "isDefault" = true LIMIT 1`,
    [tenantId]
  );
  let defaultGroupId;
  if (defaultGroupQ.rows[0]) {
    defaultGroupId = defaultGroupQ.rows[0].id;
    actual.groupsFound++;
    console.log(`  default group: exists (${defaultGroupId})`);
  } else {
    const inserted = await client.query(
      `INSERT INTO groups (id, "tenantId", name, "isDefault", "updatedAt")
       VALUES ($1, $2, 'Support', true, NOW())
       RETURNING id`,
      [newId(), tenantId]
    );
    defaultGroupId = inserted.rows[0].id;
    actual.groupsCreated++;
    await writeAudit(client, tenantId, "CREATE", "Group", defaultGroupId, null, { name: "Support", isDefault: true });
    actual.auditRowsWritten++;
    console.log(`  default group: CREATED (${defaultGroupId})`);
  }

  // --- 3. Companies → Organizations (id preserved) ---
  const companiesHere = companiesByTenant.get(tenantId) ?? [];
  for (const c of companiesHere) {
    const existing = await client.query(
      `SELECT id FROM organizations WHERE id = $1 LIMIT 1`,
      [c.id]
    );
    if (existing.rows[0]) {
      actual.organizationsSkipped++;
      continue;
    }
    await client.query(
      `INSERT INTO organizations (id, "tenantId", name, domain, "updatedAt")
       VALUES ($1, $2, $3, $4, NOW())`,
      [c.id, tenantId, c.name, c.domain ?? null]
    );
    actual.organizationsCreated++;
    await writeAudit(client, tenantId, "CREATE", "Organization", c.id, null, { name: c.name, domain: c.domain ?? null });
    actual.auditRowsWritten++;
  }
  console.log(`  organizations: ${actual.organizationsCreated} created, ${actual.organizationsSkipped} skipped`);

  // Rebuild domain-match map after inserts
  const orgByDomain = new Map();
  for (const c of companiesHere) {
    if (c.domain) orgByDomain.set(c.domain.toLowerCase(), c.id);
  }
  const orgByName = new Map(companiesHere.map((c) => [c.name, c.id]));
  const orgById = new Set(companiesHere.map((c) => c.id));

  // --- 4. Users → EndUsers / TeamMembers (id preserved) ---
  const usersHere = usersByTenant.get(tenantId) ?? [];
  for (const u of usersHere) {
    if (!u.email || u.email.trim() === "") {
      actual.errors.push({ tenantId, userId: u.id, reason: "missing_email" });
      continue;
    }

    if (u.role === "CLIENT") {
      // EndUser path — resolve organizationId
      let orgId = null;
      if (u.companyId && orgById.has(u.companyId)) {
        orgId = u.companyId;
      } else {
        const dom = extractCompanyDomain(u.email);
        if (dom && orgByDomain.has(dom)) orgId = orgByDomain.get(dom);
        else if (u.company && orgByName.has(u.company)) orgId = orgByName.get(u.company);
      }
      const existing = await client.query(
        `SELECT id FROM end_users WHERE id = $1 LIMIT 1`,
        [u.id]
      );
      if (existing.rows[0]) {
        actual.endUsersSkipped++;
        continue;
      }
      try {
        await client.query(
          `INSERT INTO end_users (id, "tenantId", email, name, "organizationId", "updatedAt")
           VALUES ($1, $2, $3, $4, $5, NOW())`,
          [u.id, tenantId, u.email, u.name ?? null, orgId]
        );
        actual.endUsersCreated++;
        await writeAudit(client, tenantId, "CREATE", "EndUser", u.id, null, {
          email: u.email, name: u.name ?? null, organizationId: orgId,
        });
        actual.auditRowsWritten++;
      } catch (e) {
        actual.errors.push({ tenantId, userId: u.id, email: u.email, reason: e.message });
      }
    } else if (isTeamMemberRole(u.role)) {
      const roleName = LEGACY_ROLE_TO_STANDARD_ROLE[u.role];
      const roleId = roleIdByName.get(roleName);
      if (!roleId) {
        actual.errors.push({ tenantId, userId: u.id, email: u.email, reason: `role_not_seeded:${roleName}` });
        continue;
      }
      const existing = await client.query(
        `SELECT id FROM team_members WHERE id = $1 LIMIT 1`,
        [u.id]
      );
      if (existing.rows[0]) {
        actual.teamMembersSkipped++;
      } else {
        try {
          await client.query(
            `INSERT INTO team_members (id, "tenantId", email, name, "roleId", "ticketAccessScope", "updatedAt")
             VALUES ($1, $2, $3, $4, $5, 'ALL', NOW())`,
            [u.id, tenantId, u.email, u.name ?? null, roleId]
          );
          actual.teamMembersCreated++;
          await writeAudit(client, tenantId, "CREATE", "TeamMember", u.id, null, {
            email: u.email, name: u.name ?? null, roleId, ticketAccessScope: "ALL",
          });
          actual.auditRowsWritten++;
        } catch (e) {
          actual.errors.push({ tenantId, userId: u.id, email: u.email, reason: e.message });
          continue;
        }
      }

      // Assign to default group (idempotent)
      const existingAssign = await client.query(
        `SELECT 1 FROM team_member_groups
         WHERE "teamMemberId" = $1 AND "groupId" = $2 LIMIT 1`,
        [u.id, defaultGroupId]
      );
      if (existingAssign.rows[0]) {
        actual.teamMemberGroupSkipped++;
      } else {
        await client.query(
          `INSERT INTO team_member_groups ("teamMemberId", "groupId", "tenantId")
           VALUES ($1, $2, $3)`,
          [u.id, defaultGroupId, tenantId]
        );
        actual.teamMemberGroupAssignments++;
        await writeAudit(client, tenantId, "ASSIGN", "TeamMemberGroup", `${u.id}:${defaultGroupId}`, null, {
          teamMemberId: u.id, groupId: defaultGroupId,
        });
        actual.auditRowsWritten++;
      }
    }
  }

  console.log(`  end_users: ${actual.endUsersCreated} created, ${actual.endUsersSkipped} skipped`);
  console.log(`  team_members: ${actual.teamMembersCreated} created, ${actual.teamMembersSkipped} skipped`);
}

// Snapshot AFTER for verification
const after = await snapshot(client);

console.log(`\n--- APPLY totals ---`);
console.log(`  roles seeded:                   ${actual.rolesSeeded}`);
console.log(`  groups created:                 ${actual.groupsCreated} (${actual.groupsFound} already existed)`);
console.log(`  organizations created:          ${actual.organizationsCreated}   (skipped: ${actual.organizationsSkipped})`);
console.log(`  end_users created:              ${actual.endUsersCreated}    (skipped: ${actual.endUsersSkipped})`);
console.log(`  team_members created:           ${actual.teamMembersCreated}   (skipped: ${actual.teamMembersSkipped})`);
console.log(`  team_member_groups assigned:    ${actual.teamMemberGroupAssignments}   (skipped: ${actual.teamMemberGroupSkipped})`);
console.log(`  core_audit_logs written:        ${actual.auditRowsWritten}`);
console.log(`  errors:                         ${actual.errors.length}`);
if (actual.errors.length > 0) {
  for (const e of actual.errors) console.log(`    - ${JSON.stringify(e)}`);
}

// ---------------------------------------------------------------------------
// Verification vs projection
// ---------------------------------------------------------------------------

console.log(`\n--- VERIFICATION: actual vs projection ---`);
const checks = [
  ["Organizations",  actual.organizationsCreated + actual.organizationsSkipped, projection.transformations.companiesToOrganizations],
  ["EndUsers",       actual.endUsersCreated + actual.endUsersSkipped,           projection.transformations.usersToEndUsers],
  ["TeamMembers",    actual.teamMembersCreated + actual.teamMembersSkipped,     projection.transformations.usersToTeamMembers],
  ["TM-Group asgn",  actual.teamMemberGroupAssignments + actual.teamMemberGroupSkipped, projection.seeds.teamMemberGroupAssignments],
];
let allMatch = true;
for (const [name, act, proj] of checks) {
  const ok = act === proj;
  if (!ok) allMatch = false;
  console.log(`  ${name.padEnd(18)} actual=${act} projected=${proj}  ${ok ? "OK" : "MISMATCH"}`);
}

// ---------------------------------------------------------------------------
// DoD checks
// ---------------------------------------------------------------------------

console.log(`\n--- DoD ---`);

// (a) Row-count parity
const totalUsers = usersAll.length;
const totalNew = after.endUsers + after.teamMembers;
const parityOk = totalNew >= totalUsers; // >= because re-run tolerant
console.log(`  Row-count parity: users=${totalUsers}  end_users+team_members=${totalNew}  ${parityOk ? "OK" : "SHORT"}`);

// (b) Every tenant has ≥1 group
const tenantsMissingGroup = await client.query(
  `SELECT t.id, t.name
   FROM tenants t
   WHERE NOT EXISTS (SELECT 1 FROM groups g WHERE g."tenantId" = t.id)`
);
const groupsOk = tenantsMissingGroup.rows.length === 0;
console.log(`  Every tenant has ≥1 group:      ${groupsOk ? "OK" : "FAIL — " + JSON.stringify(tenantsMissingGroup.rows)}`);

// (c) Every TeamMember is in ≥1 group
const teamMembersMissingGroup = await client.query(
  `SELECT tm.id, tm.email
   FROM team_members tm
   WHERE NOT EXISTS (SELECT 1 FROM team_member_groups g WHERE g."teamMemberId" = tm.id)`
);
const tmGroupOk = teamMembersMissingGroup.rows.length === 0;
console.log(`  Every TeamMember in ≥1 group:   ${tmGroupOk ? "OK" : "FAIL — " + JSON.stringify(teamMembersMissingGroup.rows)}`);

// (d) No orphaned FKs
const orphanedEndUserOrgs = await client.query(
  `SELECT eu.id, eu.email, eu."organizationId"
   FROM end_users eu
   WHERE eu."organizationId" IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM organizations o WHERE o.id = eu."organizationId")`
);
const orphanedTeamMemberRoles = await client.query(
  `SELECT tm.id, tm.email, tm."roleId"
   FROM team_members tm
   WHERE NOT EXISTS (SELECT 1 FROM roles r WHERE r.id = tm."roleId")`
);
const fksOk = orphanedEndUserOrgs.rows.length === 0 && orphanedTeamMemberRoles.rows.length === 0;
console.log(`  No orphaned FKs:                ${fksOk ? "OK" : "FAIL"}`);
if (!fksOk) {
  console.log(`    orphaned end_user.organizationId: ${JSON.stringify(orphanedEndUserOrgs.rows)}`);
  console.log(`    orphaned team_member.roleId:      ${JSON.stringify(orphanedTeamMemberRoles.rows)}`);
}

const dodOk = parityOk && groupsOk && tmGroupOk && fksOk;
const finalOk = allMatch && dodOk;
console.log(`\n=== APPLY ${finalOk ? "SUCCESS" : "COMPLETED WITH ISSUES"} ===`);

await client.end();
process.exit(finalOk ? 0 : 2);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function writeAudit(pgClient, tenantId, action, resourceType, resourceId, fromValue, toValue) {
  await pgClient.query(
    `INSERT INTO core_audit_logs
      (id, "tenantId", "actorId", "actorType", action, "resourceType", "resourceId", "fromValue", "toValue")
     VALUES ($1, $2, NULL, 'SYSTEM', $3, $4, $5, $6::jsonb, $7::jsonb)`,
    [
      newId(),
      tenantId,
      action,
      resourceType,
      resourceId,
      fromValue == null ? null : JSON.stringify(fromValue),
      toValue == null ? null : JSON.stringify(toValue),
    ]
  );
}

async function snapshot(pgClient) {
  const q = async (sql) => Number((await pgClient.query(sql)).rows[0].c);
  return {
    organizations: await q(`SELECT COUNT(*)::int AS c FROM organizations`),
    endUsers: await q(`SELECT COUNT(*)::int AS c FROM end_users`),
    teamMembers: await q(`SELECT COUNT(*)::int AS c FROM team_members`),
    roles: await q(`SELECT COUNT(*)::int AS c FROM roles`),
    groups: await q(`SELECT COUNT(*)::int AS c FROM groups`),
    teamMemberGroups: await q(`SELECT COUNT(*)::int AS c FROM team_member_groups`),
    coreAuditLogs: await q(`SELECT COUNT(*)::int AS c FROM core_audit_logs`),
  };
}
