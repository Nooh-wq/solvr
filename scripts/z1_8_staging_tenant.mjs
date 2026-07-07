// Z1.8 staging tenant fixtures — seed / verify / teardown script.
//
// Purpose: stand up a throwaway tenant with the seven-user fixture set + supporting
// rows (active OTP, expired OTP, standard roles, default group, branding, chatbot
// config, auth_credentials, lifecycle rows) so Z1.8's dry-run can exercise every
// code path the migration touches.
//
// See docs/design/z1-8-staging-fixtures.md for the fixture spec.
//
// Usage:
//   node scripts/z1_8_staging_tenant.mjs --seed
//   node scripts/z1_8_staging_tenant.mjs --verify <tenant-id>
//   node scripts/z1_8_staging_tenant.mjs --teardown <tenant-id>
//
// Guardrails:
//   - Every write is inside a fresh tenant whose slug starts with
//     "_z18-staging-" — no production tenant can ever match this prefix.
//   - Teardown refuses to touch a tenant whose slug doesn't match the prefix.
//   - Marker row written to core_audit_logs at seed + teardown so the
//     tenant's lifecycle is auditable.

import "dotenv/config";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import bcrypt from "bcryptjs";
import { PrismaClient } from "../src/generated/prisma/index.js";

const STAGING_SLUG_PREFIX = "_z18-staging-";
const BCRYPT_ROUNDS = 10;
const OTP_TTL_MS = 15 * 60 * 1000;

const prisma = new PrismaClient();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timestampSlug() {
  return `${STAGING_SLUG_PREFIX}${Date.now()}`;
}

function randomPasswordSuffix() {
  return randomBytes(4).toString("hex");
}

function sha256(input) {
  return createHash("sha256").update(input).digest("hex");
}

function isStagingSlug(slug) {
  return typeof slug === "string" && slug.startsWith(STAGING_SLUG_PREFIX);
}

async function writeMarker(tenantId, action) {
  await prisma.coreAuditLog.create({
    data: {
      tenantId,
      actorId: null,
      actorType: "SYSTEM",
      action,
      resourceType: "StagingFixture",
      resourceId: tenantId,
      toValue: { script: "z1_8_staging_tenant.mjs", at: new Date().toISOString() },
    },
  });
}

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------

async function seed() {
  const slug = timestampSlug();
  console.log(`\n=== Z1.8 staging seed — slug: ${slug} ===\n`);

  // Random passwords for the two "known" login users (SUPER_ADMIN #1 + CLIENT #4).
  const superAdminPassword = `staging-sa-${randomPasswordSuffix()}`;
  const clientPassword = `staging-client-${randomPasswordSuffix()}`;
  const unusableHash = await bcrypt.hash(randomUUID(), BCRYPT_ROUNDS);

  const superAdminHash = await bcrypt.hash(superAdminPassword, BCRYPT_ROUNDS);
  const clientHash = await bcrypt.hash(clientPassword, BCRYPT_ROUNDS);

  // Tenant + branding + chatbot config.
  const tenant = await prisma.tenant.create({
    data: {
      name: `Z1.8 Staging ${new Date().toISOString().slice(0, 10)}`,
      slug,
      type: "CLIENT",
      status: "ACTIVE",
      branding: {
        create: {
          productName: "Z1.8 Staging",
          primaryColor: "#FF6A00",
          accentColor: "#000000",
          emailFromName: "Z1.8 Staging",
        },
      },
      chatbotConfig: {
        create: { isEnabled: true, persona: "staging bot", deflectFirst: true, escalateAfter: 3 },
      },
    },
  });

  console.log(`[1/7] Tenant created: ${tenant.id}`);

  // Standard roles (Super Admin / Admin / Agent) with empty permissions —
  // staging exercises auth flow, not permission enforcement.
  const roles = {};
  for (const name of ["Super Admin", "Admin", "Agent"]) {
    const row = await prisma.role.create({
      data: { tenantId: tenant.id, name, isCustom: false, permissions: {} },
    });
    roles[name] = row;
  }
  console.log(`[2/7] Roles seeded: ${Object.keys(roles).join(", ")}`);

  // Default "Support" group.
  const defaultGroup = await prisma.group.create({
    data: { tenantId: tenant.id, name: "Support", isDefault: true },
  });
  console.log(`[3/7] Default group: ${defaultGroup.id}`);

  // Fixture users. See docs/design/z1-8-staging-fixtures.md for the table.
  const users = [
    { n: 1, name: "Staging SuperAdmin",  email: "sa@staging.z18",       role: "SUPER_ADMIN", status: "ACTIVE",    hash: superAdminHash, wrapper: "team_member" },
    { n: 2, name: "Staging Admin",       email: "admin@staging.z18",    role: "ADMIN",       status: "ACTIVE",    hash: unusableHash,   wrapper: "team_member" },
    { n: 3, name: "Staging Agent",       email: "agent@staging.z18",    role: "AGENT",       status: "ACTIVE",    hash: unusableHash,   wrapper: "team_member" },
    { n: 4, name: "Staging Client",      email: "client@staging.z18",   role: "CLIENT",      status: "ACTIVE",    hash: clientHash,     wrapper: "end_user" },
    { n: 5, name: "Staging Pending",     email: "pending@staging.z18",  role: "CLIENT",      status: "PENDING",   hash: unusableHash,   wrapper: "end_user" },
    { n: 6, name: "Staging Suspended",   email: "susp@staging.z18",     role: "AGENT",       status: "SUSPENDED", hash: unusableHash,   wrapper: "team_member" },
    { n: 7, name: "Staging Invited",     email: "invited@staging.z18",  role: "AGENT",       status: "INVITED",   hash: unusableHash,   wrapper: "team_member" },
  ];

  const created = [];
  for (const spec of users) {
    // Legacy User
    const legacyUser = await prisma.user.create({
      data: {
        tenantId: tenant.id,
        name: spec.name,
        email: spec.email,
        role: spec.role,
        status: spec.status,
        passwordHash: spec.hash,
      },
    });

    // Wrapper counterpart with preserved id (Z1.3 pattern).
    if (spec.wrapper === "team_member") {
      const roleName = spec.role === "SUPER_ADMIN" ? "Super Admin" : spec.role === "ADMIN" ? "Admin" : "Agent";
      await prisma.teamMember.create({
        data: {
          id: legacyUser.id,
          tenantId: tenant.id,
          email: spec.email,
          name: spec.name,
          roleId: roles[roleName].id,
        },
      });
      await prisma.teamMemberGroup.create({
        data: {
          teamMemberId: legacyUser.id,
          groupId: defaultGroup.id,
          tenantId: tenant.id,
        },
      });
    } else {
      await prisma.endUser.create({
        data: { id: legacyUser.id, tenantId: tenant.id, email: spec.email, name: spec.name },
      });
    }

    // auth_credentials row (dual-write pattern kicks in at Z1.8a code migration;
    // staging fixture pre-populates so dry-run can exercise reads).
    await prisma.authCredential.create({
      data: {
        tenantId: tenant.id,
        subjectEndUserId: spec.wrapper === "end_user" ? legacyUser.id : null,
        subjectTeamMemberId: spec.wrapper === "team_member" ? legacyUser.id : null,
        passwordHash: spec.hash,
      },
    });

    // Lifecycle row.
    if (spec.wrapper === "team_member") {
      await prisma.teamMemberLifecycle.create({
        data: { subjectId: legacyUser.id, tenantId: tenant.id, status: spec.status },
      });
    } else {
      await prisma.endUserLifecycle.create({
        data: { subjectId: legacyUser.id, tenantId: tenant.id, status: spec.status },
      });
    }

    created.push({ ...spec, id: legacyUser.id });
  }
  console.log(`[4/7] Users created: ${created.length}`);

  // Active OTP for user #4 (CLIENT/ACTIVE) — exercises verifyLoginOtp happy path.
  const activeOtpCode = "123456";
  await prisma.loginOtp.create({
    data: {
      tenantId: tenant.id,
      userId: created[3].id,
      endUserId: created[3].id,
      codeHash: sha256(activeOtpCode),
      expiresAt: new Date(Date.now() + OTP_TTL_MS),
    },
  });

  // Expired OTP for user #7 (AGENT/INVITED) — exercises expired-invite edge case.
  await prisma.loginOtp.create({
    data: {
      tenantId: tenant.id,
      userId: created[6].id,
      teamMemberId: created[6].id,
      codeHash: sha256("999999"),
      expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
    },
  });
  console.log(`[5/7] OTPs seeded (active + expired)`);

  // Marker audit log.
  await writeMarker(tenant.id, "STAGING_SEED");
  console.log(`[6/7] Audit marker written`);

  console.log(`\n[7/7] Seed complete.\n`);
  console.log(`  Tenant ID:   ${tenant.id}`);
  console.log(`  Tenant slug: ${slug}\n`);
  console.log(`  Login credentials (session-scoped — not persisted):`);
  console.log(`    SUPER_ADMIN #1: ${users[0].email} / ${superAdminPassword}`);
  console.log(`    CLIENT #4:      ${users[3].email} / ${clientPassword}`);
  console.log(`    Active OTP for user #4: ${activeOtpCode}`);
  console.log(`\nNext steps:`);
  console.log(`  Verify:   node scripts/z1_8_staging_tenant.mjs --verify ${tenant.id}`);
  console.log(`  Teardown: node scripts/z1_8_staging_tenant.mjs --teardown ${tenant.id}\n`);
}

// ---------------------------------------------------------------------------
// Verify
// ---------------------------------------------------------------------------

async function verify(tenantId) {
  console.log(`\n=== Z1.8 staging verify — tenant: ${tenantId} ===\n`);

  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) {
    console.error(`Tenant ${tenantId} not found.`);
    process.exit(1);
  }
  if (!isStagingSlug(tenant.slug)) {
    console.error(`Refusing to verify — tenant slug "${tenant.slug}" doesn't start with "${STAGING_SLUG_PREFIX}".`);
    process.exit(1);
  }

  const [users, teamMembers, endUsers, roles, groups, credentials, tmLifecycle, euLifecycle, otps] = await Promise.all([
    prisma.user.findMany({ where: { tenantId }, orderBy: { email: "asc" } }),
    prisma.teamMember.count({ where: { tenantId } }),
    prisma.endUser.count({ where: { tenantId } }),
    prisma.role.count({ where: { tenantId } }),
    prisma.group.count({ where: { tenantId } }),
    prisma.authCredential.count({ where: { tenantId } }),
    prisma.teamMemberLifecycle.count({ where: { tenantId } }),
    prisma.endUserLifecycle.count({ where: { tenantId } }),
    prisma.loginOtp.findMany({ where: { tenantId }, orderBy: { expiresAt: "asc" } }),
  ]);

  const staff = users.filter((u) => u.role !== "CLIENT").length;
  const clients = users.filter((u) => u.role === "CLIENT").length;

  const now = Date.now();
  const activeOtps = otps.filter((o) => o.expiresAt.getTime() > now).length;
  const expiredOtps = otps.filter((o) => o.expiresAt.getTime() <= now).length;

  const expected = {
    users: 7, staff: 5, clients: 2,
    teamMembers: 5, endUsers: 2,
    roles: 3, groups: 1,
    credentials: 7, tmLifecycle: 5, euLifecycle: 2,
    otps: 2, activeOtps: 1, expiredOtps: 1,
  };

  const actual = {
    users: users.length, staff, clients,
    teamMembers, endUsers,
    roles, groups,
    credentials, tmLifecycle, euLifecycle,
    otps: otps.length, activeOtps, expiredOtps,
  };

  console.log("Fixture row counts:");
  console.log("  key                 expected  actual");
  let allMatch = true;
  for (const k of Object.keys(expected)) {
    const match = expected[k] === actual[k];
    if (!match) allMatch = false;
    console.log(`  ${k.padEnd(20)} ${String(expected[k]).padEnd(9)} ${actual[k]}${match ? "" : "  ← MISMATCH"}`);
  }

  console.log(`\nOverall: ${allMatch ? "✓ all counts match" : "✗ mismatches detected"}\n`);
  process.exit(allMatch ? 0 : 1);
}

// ---------------------------------------------------------------------------
// Teardown
// ---------------------------------------------------------------------------

async function teardown(tenantId) {
  console.log(`\n=== Z1.8 staging teardown — tenant: ${tenantId} ===\n`);

  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) {
    console.log(`Tenant ${tenantId} not found. Nothing to tear down.`);
    return;
  }
  if (!isStagingSlug(tenant.slug)) {
    console.error(`REFUSING to teardown — tenant slug "${tenant.slug}" doesn't start with "${STAGING_SLUG_PREFIX}".`);
    console.error(`Belt-and-braces guard against accidentally targeting a real tenant.`);
    process.exit(1);
  }

  await writeMarker(tenantId, "STAGING_TEARDOWN");

  await prisma.tenant.delete({ where: { id: tenantId } });
  console.log(`Tenant deleted. Cascades handled by Prisma onDelete: Cascade + FK REFERENCES.`);

  // Verify nothing left behind.
  const leftovers = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS count FROM users WHERE "tenantId" = $1`,
    tenantId,
  );
  const count = leftovers[0]?.count ?? 0;
  if (count === 0) {
    console.log(`Verified: zero residual users for tenant ${tenantId}.\n`);
  } else {
    console.error(`WARNING: ${count} residual user rows found. Cascade may be incomplete.`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);

async function main() {
  if (args.includes("--seed")) {
    await seed();
  } else if (args.includes("--verify")) {
    const idx = args.indexOf("--verify");
    const tenantId = args[idx + 1];
    if (!tenantId) throw new Error("--verify requires a tenant id");
    await verify(tenantId);
  } else if (args.includes("--teardown")) {
    const idx = args.indexOf("--teardown");
    const tenantId = args[idx + 1];
    if (!tenantId) throw new Error("--teardown requires a tenant id");
    await teardown(tenantId);
  } else {
    console.error("Usage:");
    console.error("  node scripts/z1_8_staging_tenant.mjs --seed");
    console.error("  node scripts/z1_8_staging_tenant.mjs --verify <tenant-id>");
    console.error("  node scripts/z1_8_staging_tenant.mjs --teardown <tenant-id>");
    process.exit(1);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
