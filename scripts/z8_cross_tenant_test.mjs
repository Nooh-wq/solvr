import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/index.js";

// Z8 cross-tenant isolation smoke test. RLS is only enforced against
// roles WITHOUT the BYPASSRLS attribute — the migration-owning role
// (DIRECT_URL) can see across tenants. This script uses APP_DIRECT_URL
// (role app_runtime, no BYPASSRLS), same as the app runtime. If
// APP_DIRECT_URL isn't set, the test aborts with a warning rather
// than false-passing under a superuser connection.

const appUrl = process.env.APP_DIRECT_URL || process.env.APP_DATABASE_URL;
if (!appUrl) {
  console.error("APP_DIRECT_URL / APP_DATABASE_URL not set — cannot verify RLS without the app_runtime role.");
  process.exit(1);
}
const prisma = new PrismaClient({ datasources: { db: { url: appUrl } } });

async function withRls(tenantId, role, fn) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true), set_config('app.user_id', '', true), set_config('app.role', ${role}, true), set_config('app.guest_ticket_id', '', true)`;
    return fn(tx);
  });
}

function assert(cond, msg) {
  if (!cond) {
    console.error("❌ FAIL:", msg);
    process.exit(1);
  }
  console.log("✓", msg);
}

const cuid = () => "xt_" + Math.random().toString(36).slice(2) + Date.now().toString(36);

try {
  const tenants = await prisma.tenant.findMany({ orderBy: { createdAt: "asc" }, take: 2 });
  if (tenants.length < 2) {
    console.error("Need at least 2 tenants to test cross-tenant isolation.");
    process.exit(1);
  }
  const [A, B] = tenants;
  console.log(`Testing isolation between tenant A=${A.slug} and B=${B.slug}\n`);

  // Seed one rule + one escalation path per tenant (bypass RLS via a
  // no-context connection for setup — we're only inserting known
  // tenant-scoped rows here).
  const seed = async (t) => {
    const ruleId = cuid();
    const escId = cuid();
    await withRls(t.id, "SUPER_ADMIN", async (tx) => {
      await tx.rule.create({
        data: {
          id: ruleId,
          tenantId: t.id,
          kind: "TRIGGER",
          name: `xtest-rule-${t.slug}-${Date.now()}`,
          triggerEvent: "TICKET_CREATED",
          conditions: { match: "all", conditions: [] },
          actions: [{ type: "add_tag", tag: "xtest" }],
          active: true,
        },
      });
      await tx.escalationPath.create({
        data: {
          id: escId,
          tenantId: t.id,
          label: `xtest-esc-${t.slug}-${Date.now()}`,
          categoryIds: [],
          destKind: "EMAIL",
          destConfig: { toEmails: ["ops@example.com"] },
          active: true,
        },
      });
    });
    return { ruleId, escId };
  };

  const seedA = await seed(A);
  const seedB = await seed(B);

  try {
    // Tenant A's session sees A's rows, NOT B's.
    await withRls(A.id, "SUPER_ADMIN", async (tx) => {
      const rules = await tx.rule.findMany({ select: { id: true } });
      const ids = new Set(rules.map((r) => r.id));
      assert(ids.has(seedA.ruleId), "Tenant A sees its own rule");
      assert(!ids.has(seedB.ruleId), "Tenant A does NOT see tenant B's rule");

      const escs = await tx.escalationPath.findMany({ select: { id: true } });
      const eids = new Set(escs.map((r) => r.id));
      assert(eids.has(seedA.escId), "Tenant A sees its own escalation path");
      assert(!eids.has(seedB.escId), "Tenant A does NOT see tenant B's escalation path");

      const logs = await tx.ruleRunLog.findMany({ select: { tenantId: true }, take: 200 });
      assert(logs.every((l) => l.tenantId === A.id), "Tenant A's rule_run_logs are all tenant A");
    });

    // Tenant B's session sees B's rows, NOT A's.
    await withRls(B.id, "SUPER_ADMIN", async (tx) => {
      const rules = await tx.rule.findMany({ select: { id: true } });
      const ids = new Set(rules.map((r) => r.id));
      assert(ids.has(seedB.ruleId), "Tenant B sees its own rule");
      assert(!ids.has(seedA.ruleId), "Tenant B does NOT see tenant A's rule");
    });

    // Write attempt: A's session must NOT be able to insert a rule
    // stamped with B's tenantId.
    let blocked = false;
    try {
      await withRls(A.id, "SUPER_ADMIN", async (tx) => {
        await tx.rule.create({
          data: {
            tenantId: B.id, // WRONG on purpose
            kind: "TRIGGER",
            name: "crosstenant-attempt",
            triggerEvent: "TICKET_CREATED",
            conditions: { match: "all", conditions: [] },
            actions: [],
          },
        });
      });
    } catch (e) {
      blocked = true;
    }
    assert(blocked, "Tenant A's session blocked from inserting a rule tagged for tenant B");

    console.log("\n✅ Cross-tenant isolation verified for rules + rule_run_logs + escalation_paths.");
  } finally {
    // Cleanup: raw SQL bypass RLS on delete to remove both seed sets.
    await prisma.$executeRaw`DELETE FROM rules WHERE id IN (${seedA.ruleId}, ${seedB.ruleId})`;
    await prisma.$executeRaw`DELETE FROM escalation_paths WHERE id IN (${seedA.escId}, ${seedB.escId})`;
  }
} finally {
  await prisma.$disconnect();
}
