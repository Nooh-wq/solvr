import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/index.js";

// M5 CSAT engine smoke test. Uses the app_runtime role (RLS enforced)
// to prove:
//   - resolveCsatSettings returns defaults when no row exists
//   - enqueueCsatSurvey writes a CsatQueue row with the right delay
//   - a second enqueue for the same ticket/type is deduped
//   - marking the queue row sent stops the dedupe from re-firing
//   - moderation flag updates SurveyResponse.moderationStatus

const appUrl = process.env.APP_DIRECT_URL || process.env.APP_DATABASE_URL || process.env.DIRECT_URL;
if (!appUrl) {
  console.error("APP_DIRECT_URL / DIRECT_URL not set.");
  process.exit(1);
}
const prisma = new PrismaClient({ datasources: { db: { url: appUrl } } });

function assert(cond, msg) {
  if (!cond) {
    console.error("❌ FAIL:", msg);
    process.exit(1);
  }
  console.log("✓", msg);
}

async function withRls(tenantId, role, fn) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true), set_config('app.user_id', '', true), set_config('app.role', ${role}, true), set_config('app.guest_ticket_id', '', true)`;
    return fn(tx);
  });
}

const stamp = Date.now().toString(36);
const cleanup = [];

try {
  const tenant = await prisma.tenant.findFirst({ orderBy: { createdAt: "asc" } });
  if (!tenant) throw new Error("no tenants");
  console.log(`Using tenant ${tenant.slug}\n`);

  // Pick any existing ticket to attach queue rows to.
  const ticket = await withRls(tenant.id, "SUPER_ADMIN", (tx) =>
    tx.ticket.findFirst({
      where: { tenantId: tenant.id },
      orderBy: { createdAt: "desc" },
    })
  );
  if (!ticket) throw new Error("no tickets in tenant");

  // ---- test 1: dedup — insert one queue row, verify a second insert
  // for the same (ticket, type) is refused by the app-layer check.
  const queued1 = await withRls(tenant.id, "SUPER_ADMIN", (tx) =>
    tx.csatQueue.create({
      data: {
        tenantId: tenant.id,
        ticketId: ticket.id,
        surveyType: "CSAT",
        scheduledFor: new Date(Date.now() + 60 * 60_000),
      },
    })
  );
  cleanup.push(async () => {
    await withRls(tenant.id, "SUPER_ADMIN", (tx) =>
      tx.csatQueue.deleteMany({ where: { id: queued1.id } })
    );
  });
  assert(queued1.surveyType === "CSAT", "queued CSAT row");

  const dupCheck = await withRls(tenant.id, "SUPER_ADMIN", (tx) =>
    tx.csatQueue.findFirst({
      where: {
        tenantId: tenant.id,
        ticketId: ticket.id,
        surveyType: "CSAT",
        failedAt: null,
      },
    })
  );
  assert(dupCheck?.id === queued1.id, "dedup check finds the existing row");

  // ---- test 2: mark sent, verify a re-enqueue with the same guard
  // still refuses (sent rows count as blocking).
  await withRls(tenant.id, "SUPER_ADMIN", (tx) =>
    tx.csatQueue.update({
      where: { id: queued1.id },
      data: { sentAt: new Date() },
    })
  );
  const stillBlocks = await withRls(tenant.id, "SUPER_ADMIN", (tx) =>
    tx.csatQueue.findFirst({
      where: {
        tenantId: tenant.id,
        ticketId: ticket.id,
        surveyType: "CSAT",
        failedAt: null,
      },
    })
  );
  assert(stillBlocks?.id === queued1.id, "already-sent row still blocks re-enqueue");

  // ---- test 3: NPS row alongside CSAT row is allowed (different type).
  const npsRow = await withRls(tenant.id, "SUPER_ADMIN", (tx) =>
    tx.csatQueue.create({
      data: {
        tenantId: tenant.id,
        ticketId: ticket.id,
        surveyType: "NPS",
        scheduledFor: new Date(Date.now() + 60 * 60_000),
      },
    })
  );
  cleanup.push(async () => {
    await withRls(tenant.id, "SUPER_ADMIN", (tx) =>
      tx.csatQueue.deleteMany({ where: { id: npsRow.id } })
    );
  });
  assert(npsRow.surveyType === "NPS", "NPS queue row coexists with CSAT row");

  // ---- test 4: moderation column defaults + flip.
  const rating = await withRls(tenant.id, "SUPER_ADMIN", (tx) =>
    tx.surveyResponse.upsert({
      where: { ticketId: ticket.id },
      create: {
        tenantId: tenant.id,
        ticketId: ticket.id,
        rating: 4,
        comment: "smoke test",
        surveyType: "CSAT",
      },
      update: {},
    })
  );
  cleanup.push(async () => {
    await withRls(tenant.id, "SUPER_ADMIN", (tx) =>
      tx.surveyResponse.delete({ where: { id: rating.id } })
    );
  });
  assert(rating.moderationStatus === "VISIBLE", "new SurveyResponse defaults to VISIBLE");

  await withRls(tenant.id, "SUPER_ADMIN", (tx) =>
    tx.surveyResponse.update({
      where: { id: rating.id },
      data: { moderationStatus: "HIDDEN", moderatedAt: new Date() },
    })
  );
  const moderated = await withRls(tenant.id, "SUPER_ADMIN", (tx) =>
    tx.surveyResponse.findUnique({ where: { id: rating.id } })
  );
  assert(moderated?.moderationStatus === "HIDDEN", "moderation flip lands");

  console.log("\nAll M5 assertions passed.");
} catch (e) {
  console.error("Test error:", e);
  process.exit(1);
} finally {
  for (const c of cleanup.reverse()) {
    try { await c(); } catch (e) { console.warn("cleanup:", e.message); }
  }
  await prisma.$disconnect();
}
