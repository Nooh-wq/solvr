// Post-Z1 QA test tenant — seed / verify / teardown.
//
// Stands up a throwaway tenant covering every touched surface across
// Z2, M21, Z3, Z4, Z5, Z6, Z7, M1, M2, M3, M5, M13 so Phase 2 has
// representative state to drive.
//
// Guardrails:
//   - Slug prefix "_qa-test-" — teardown refuses to touch anything else.
//   - Marker rows written to core_audit_logs on seed + teardown.
//   - Idempotent-per-slug: re-running --seed makes a *new* tenant.
//     Use --teardown <slug> to reclaim.
//
// Usage:
//   node scripts/qa_seed_tenant.mjs --seed
//   node scripts/qa_seed_tenant.mjs --teardown <slug>
//   node scripts/qa_seed_tenant.mjs --list

import "dotenv/config";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import bcrypt from "bcryptjs";
import { PrismaClient } from "../src/generated/prisma/index.js";

const SLUG_PREFIX = "_qa-test-";
const BCRYPT_ROUNDS = 10;

const prisma = new PrismaClient();

const timestampSlug = () => `${SLUG_PREFIX}${Date.now()}`;
const cuid = (p) => `qa_${p}_${randomBytes(6).toString("hex")}`;
const sha256 = (s) => createHash("sha256").update(s).digest("hex");

function assertTestSlug(slug) {
  if (!slug || !slug.startsWith(SLUG_PREFIX)) {
    throw new Error(`refusing to touch non-QA tenant slug: ${slug}`);
  }
}

async function marker(tenantId, action) {
  await prisma.coreAuditLog.create({
    data: {
      tenantId,
      actorId: null,
      actorType: "SYSTEM",
      action,
      resourceType: "QAFixture",
      resourceId: tenantId,
      toValue: { script: "qa_seed_tenant.mjs", at: new Date().toISOString() },
    },
  });
}

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------

async function seed() {
  const slug = timestampSlug();
  console.log(`\n=== QA seed — slug: ${slug} ===\n`);

  const passwords = {
    superAdmin: `qa-sa-${randomBytes(3).toString("hex")}`,
    admin: `qa-adm-${randomBytes(3).toString("hex")}`,
    agent: `qa-agt-${randomBytes(3).toString("hex")}`,
    client: `qa-cli-${randomBytes(3).toString("hex")}`,
  };
  const hashes = {
    superAdmin: await bcrypt.hash(passwords.superAdmin, BCRYPT_ROUNDS),
    admin: await bcrypt.hash(passwords.admin, BCRYPT_ROUNDS),
    agent: await bcrypt.hash(passwords.agent, BCRYPT_ROUNDS),
    client: await bcrypt.hash(passwords.client, BCRYPT_ROUNDS),
    unusable: await bcrypt.hash(randomUUID(), BCRYPT_ROUNDS),
  };

  // ---- Tenant + branding + chatbot + default group + standard roles
  const tenant = await prisma.tenant.create({
    data: {
      name: `QA Test ${new Date().toISOString().slice(0, 10)}`,
      slug,
      type: "CLIENT",
      status: "ACTIVE",
      branding: {
        create: {
          productName: "QA Support",
          primaryColor: "#FF6A00",
          accentColor: "#000000",
          emailFromName: "QA Support",
        },
      },
      chatbotConfig: {
        create: { isEnabled: true, persona: "qa bot", deflectFirst: true, escalateAfter: 3 },
      },
    },
  });
  console.log(`tenant.id = ${tenant.id}`);
  await marker(tenant.id, "QA_SEED_START");

  // Standard roles — required for team-member creation.
  const [superAdminRole, adminRole, agentRole, lightAgentRole] = await Promise.all([
    prisma.role.create({ data: { tenantId: tenant.id, name: "Super Admin", isCustom: false, permissions: {} } }),
    prisma.role.create({ data: { tenantId: tenant.id, name: "Admin", isCustom: false, permissions: {} } }),
    prisma.role.create({ data: { tenantId: tenant.id, name: "Agent", isCustom: false, permissions: {} } }),
    prisma.role.create({
      data: {
        tenantId: tenant.id,
        name: "Light Agent",
        isCustom: false,
        // Z5.5 — Light Agent forbidden from public replies. The app
        // reads role name string; permissions blob is a placeholder.
        permissions: { publicReply: false },
      },
    }),
  ]);

  // Groups: Support (default) + Billing.
  const [supportGroup, billingGroup] = await Promise.all([
    prisma.group.create({ data: { tenantId: tenant.id, name: "Support", isDefault: true } }),
    prisma.group.create({ data: { tenantId: tenant.id, name: "Billing", isDefault: false } }),
  ]);

  // Categories.
  const [bugCat, billingCat, featureCat] = await Promise.all([
    prisma.category.create({ data: { tenantId: tenant.id, name: "Bug" } }),
    prisma.category.create({ data: { tenantId: tenant.id, name: "Billing" } }),
    prisma.category.create({ data: { tenantId: tenant.id, name: "Feature Request" } }),
  ]);

  // ---- Organizations (3)
  const acme = await prisma.organization.create({
    data: { tenantId: tenant.id, name: "Acme Corp", domain: "acme.test" },
  });
  const beta = await prisma.organization.create({
    data: { tenantId: tenant.id, name: "Beta Inc", domain: "beta.test" },
  });
  const northwind = await prisma.organization.create({
    data: { tenantId: tenant.id, name: "Northwind Traders", domain: "northwind.test" },
  });

  // ---- Team members (5)
  async function makeStaff(name, email, roleId, scope, password, hash) {
    const id = cuid("tm");
    await prisma.teamMember.create({
      data: { id, tenantId: tenant.id, email, name, roleId, ticketAccessScope: scope },
    });
    await prisma.teamMemberLifecycle.create({
      data: { subjectId: id, tenantId: tenant.id, status: "ACTIVE" },
    });
    await prisma.authCredential.create({
      data: {
        tenantId: tenant.id,
        subjectTeamMemberId: id,
        passwordHash: hash,
      },
    });
    return { id, email, password };
  }

  const superAdmin = await makeStaff("QA Super Admin", "qa-super@stralis-qa.test", superAdminRole.id, "ALL", passwords.superAdmin, hashes.superAdmin);
  const admin = await makeStaff("QA Admin", "qa-admin@stralis-qa.test", adminRole.id, "ALL", passwords.admin, hashes.admin);
  const agent1 = await makeStaff("QA Agent One", "qa-agent1@stralis-qa.test", agentRole.id, "ALL", passwords.agent, hashes.agent);
  const agent2 = await makeStaff("QA Agent Two", "qa-agent2@stralis-qa.test", agentRole.id, "GROUPS", passwords.agent, hashes.agent);
  const lightAgent = await makeStaff("QA Light Agent", "qa-lightagent@stralis-qa.test", lightAgentRole.id, "ASSIGNED_ONLY", passwords.agent, hashes.agent);

  // Agent1 → Support, Agent2 → Billing, Light Agent → both.
  await prisma.teamMemberGroup.createMany({
    data: [
      { tenantId: tenant.id, teamMemberId: agent1.id, groupId: supportGroup.id },
      { tenantId: tenant.id, teamMemberId: agent2.id, groupId: billingGroup.id },
      { tenantId: tenant.id, teamMemberId: lightAgent.id, groupId: supportGroup.id },
      { tenantId: tenant.id, teamMemberId: lightAgent.id, groupId: billingGroup.id },
    ],
  });

  // ---- End users (3)
  async function makeClient(name, email, orgId, password, hash) {
    const id = cuid("eu");
    await prisma.endUser.create({
      data: { id, tenantId: tenant.id, email, name, organizationId: orgId },
    });
    await prisma.endUserLifecycle.create({
      data: { subjectId: id, tenantId: tenant.id, status: "ACTIVE" },
    });
    await prisma.authCredential.create({
      data: {
        tenantId: tenant.id,
        subjectEndUserId: id,
        passwordHash: hash,
      },
    });
    return { id, email, password };
  }

  const client1 = await makeClient("Priya Acme", "priya@acme.test", acme.id, passwords.client, hashes.client);
  const client2 = await makeClient("Bob Beta", "bob@beta.test", beta.id, passwords.client, hashes.client);
  const client3 = await makeClient("Carol Acme", "carol@acme.test", acme.id, passwords.client, hashes.client);

  // ---- Custom fields (Z2)
  const severityDef = await prisma.customFieldDefinition.create({
    data: {
      tenantId: tenant.id,
      scope: "TICKET",
      type: "DROPDOWN",
      key: "severity",
      label: "Severity",
      isActive: true,
      isRequired: false,
      position: 0,
    },
  });
  const [sevLow, sevMed, sevHigh] = await Promise.all(
    ["Low", "Medium", "High"].map((name, i) =>
      prisma.customFieldOption.create({
        data: {
          tenantId: tenant.id,
          fieldDefinitionId: severityDef.id,
          label: name,
          value: name.toLowerCase(),
          position: i,
        },
      })
    )
  );
  const langDef = await prisma.customFieldDefinition.create({
    data: {
      tenantId: tenant.id,
      scope: "USER",
      type: "TEXT",
      key: "preferredLanguage",
      label: "Preferred language",
      isActive: true,
      isRequired: false,
      position: 0,
    },
  });
  const planDef = await prisma.customFieldDefinition.create({
    data: {
      tenantId: tenant.id,
      scope: "ORG",
      type: "DROPDOWN",
      key: "plan",
      label: "Plan",
      isActive: true,
      isRequired: false,
      position: 0,
    },
  });
  const [planFree, planPro, planEnt] = await Promise.all(
    ["Free", "Pro", "Enterprise"].map((name, i) =>
      prisma.customFieldOption.create({
        data: {
          tenantId: tenant.id,
          fieldDefinitionId: planDef.id,
          label: name,
          value: name.toLowerCase(),
          position: i,
        },
      })
    )
  );

  // Values: Acme=Pro, Beta=Free, Northwind=Enterprise; Priya prefers Spanish.
  await prisma.customFieldValue.createMany({
    data: [
      { tenantId: tenant.id, fieldDefinitionId: planDef.id, targetType: "ORG", targetId: acme.id, valueOptionId: planPro.id },
      { tenantId: tenant.id, fieldDefinitionId: planDef.id, targetType: "ORG", targetId: beta.id, valueOptionId: planFree.id },
      { tenantId: tenant.id, fieldDefinitionId: planDef.id, targetType: "ORG", targetId: northwind.id, valueOptionId: planEnt.id },
      { tenantId: tenant.id, fieldDefinitionId: langDef.id, targetType: "USER", targetId: client1.id, valueText: "Spanish" },
    ],
  });

  // ---- SLA policy + business calendar (M2)
  const slaPolicy = await prisma.slaPolicy.create({
    data: {
      tenantId: tenant.id,
      name: "Standard SLA",
      isDefault: true,
      active: true,
      targets: {
        URGENT: { firstResponseMins: 60, resolutionMins: 240 },
        HIGH: { firstResponseMins: 240, resolutionMins: 960 },
        MEDIUM: { firstResponseMins: 480, resolutionMins: 1440 },
        LOW: { firstResponseMins: 1440, resolutionMins: 4320 },
      },
    },
  });
  const calendar = await prisma.businessCalendar.create({
    data: {
      tenantId: tenant.id,
      name: "Weekdays 9-5 UTC",
      isDefault: true,
      timezone: "UTC",
      weeklyHours: {
        mon: [["09:00", "17:00"]],
        tue: [["09:00", "17:00"]],
        wed: [["09:00", "17:00"]],
        thu: [["09:00", "17:00"]],
        fri: [["09:00", "17:00"]],
        sat: [],
        sun: [],
      },
      holidays: [],
    },
  });

  // ---- CSAT settings (M5)
  await prisma.csatSettings.create({
    data: { tenantId: tenant.id, enabled: true, surveyType: "CSAT", delayMinutes: 60 },
  });

  // ---- Tickets (50). Distribute across statuses + orgs + priorities.
  const clients = [client1, client2, client3];
  const orgs = [acme, beta, acme]; // parallel to clients
  const categories = [bugCat, billingCat, featureCat];
  const priorities = ["LOW", "MEDIUM", "HIGH", "URGENT"];
  const statusDist = [
    ["OPEN", 15],
    ["IN_PROGRESS", 10],
    ["PENDING", 10],
    ["RESOLVED", 10],
    ["CLOSED", 5],
  ];

  const tickets = [];
  let seq = 1000;
  for (const [status, n] of statusDist) {
    for (let i = 0; i < n; i++) {
      seq++;
      const clientIdx = i % clients.length;
      const client = clients[clientIdx];
      const org = orgs[clientIdx];
      const cat = categories[i % categories.length];
      const priority = priorities[i % priorities.length];
      // Vary assignee: unassigned, agent1, agent2, or nothing.
      const assigneePick = i % 4;
      const assignee = assigneePick === 0 ? null : assigneePick === 1 ? agent1.id : assigneePick === 2 ? agent2.id : null;

      const createdAt = new Date(Date.now() - (i * 3 + 1) * 3_600_000);
      const resolvedAt = status === "RESOLVED" || status === "CLOSED"
        ? new Date(createdAt.getTime() + 2 * 3_600_000)
        : null;
      const firstReplyAt = status !== "OPEN" || i % 3 === 0
        ? new Date(createdAt.getTime() + 30 * 60_000)
        : null;

      const t = await prisma.ticket.create({
        data: {
          tenantId: tenant.id,
          reference: `QA-${seq}`,
          ticketNumber: `${9_000_000 + seq}`,
          title: `${cat.name} ticket #${seq}`,
          description: `Seeded ticket ${seq} for QA — status=${status}, priority=${priority}`,
          status,
          priority,
          categoryId: cat.id,
          clientEndUserId: client.id,
          assignedTeamMemberId: assignee,
          organizationId: org.id,
          source: "portal",
          firstReplyAt,
          resolvedAt,
          createdAt,
        },
      });
      tickets.push(t);
    }
  }
  console.log(`created ${tickets.length} tickets`);

  // ---- Custom-field values on some tickets (severity)
  const sevOptions = [sevLow, sevMed, sevHigh];
  for (let i = 0; i < 10; i++) {
    const t = tickets[i];
    await prisma.customFieldValue.create({
      data: {
        tenantId: tenant.id,
        fieldDefinitionId: severityDef.id,
        targetType: "TICKET",
        targetId: t.id,
        valueOptionId: sevOptions[i % 3].id,
      },
    });
  }

  // ---- SLA rows for a mix of tickets. Satisfied on RESOLVED,
  //      warning on some OPEN (dueAt in ~30 min), breached on some
  //      OPEN (dueAt in the past).
  const now = new Date();
  for (let i = 0; i < 5; i++) {
    const t = tickets[i]; // OPEN #0..4
    await prisma.ticketSla.create({
      data: {
        tenantId: tenant.id,
        ticketId: t.id,
        slaPolicyId: slaPolicy.id,
        kind: "FIRST_RESPONSE",
        targetMins: 60,
        startedAt: t.createdAt,
        dueAt: new Date(now.getTime() + 30 * 60_000), // warning window
      },
    });
  }
  for (let i = 5; i < 10; i++) {
    const t = tickets[i]; // more OPEN
    await prisma.ticketSla.create({
      data: {
        tenantId: tenant.id,
        ticketId: t.id,
        slaPolicyId: slaPolicy.id,
        kind: "FIRST_RESPONSE",
        targetMins: 60,
        startedAt: t.createdAt,
        dueAt: new Date(now.getTime() - 60 * 60_000), // breached
      },
    });
  }
  for (let i = 35; i < 45; i++) {
    const t = tickets[i]; // RESOLVED/CLOSED
    await prisma.ticketSla.create({
      data: {
        tenantId: tenant.id,
        ticketId: t.id,
        slaPolicyId: slaPolicy.id,
        kind: "FIRST_RESPONSE",
        targetMins: 60,
        startedAt: t.createdAt,
        dueAt: new Date(t.createdAt.getTime() + 60 * 60_000),
        satisfiedAt: t.firstReplyAt ?? t.createdAt,
      },
    });
  }

  // ---- CSAT responses (5)
  const resolvedTickets = tickets.filter((t) => t.status === "RESOLVED").slice(0, 5);
  for (let i = 0; i < resolvedTickets.length; i++) {
    const t = resolvedTickets[i];
    const isNps = i >= 3;
    await prisma.surveyResponse.create({
      data: {
        tenantId: tenant.id,
        ticketId: t.id,
        rating: isNps ? 7 + (i % 3) : 3 + (i % 3),
        comment: i === 0 ? "quick and helpful — thanks" : null,
        surveyType: isNps ? "NPS" : "CSAT",
        moderationStatus: "VISIBLE",
      },
    });
  }

  // ---- Rules (M1)
  const urgentTagRule = await prisma.rule.create({
    data: {
      tenantId: tenant.id,
      kind: "TRIGGER",
      name: "Tag urgent tickets",
      triggerEvent: "TICKET_CREATED",
      conditions: {
        match: "all",
        conditions: [{ field: "priority", op: "eq", value: "URGENT" }],
      },
      actions: [{ type: "add_tag", tag: "urgent" }],
      active: true,
    },
  });
  const hourlyAutomation = await prisma.rule.create({
    data: {
      tenantId: tenant.id,
      kind: "AUTOMATION",
      name: "Test hourly automation",
      intervalHours: 1,
      conditions: { match: "all", conditions: [] },
      actions: [{ type: "add_internal_note", body: "hourly automation ran" }],
      active: false, // idle so we don't spam notes
    },
  });

  // ---- Escalation path (M1)
  const escalation = await prisma.escalationPath.create({
    data: {
      tenantId: tenant.id,
      label: "Escalate to Support",
      icon: "shield",
      categoryIds: [],
      destKind: "TEAM",
      destConfig: { groupId: supportGroup.id, strategy: "LOAD_BASED" },
      active: true,
    },
  });

  // ---- Shared view (Z6)
  // Z6.5 — a saved view with ownerTeamMemberId=null IS the shared view;
  // there's no separate `isShared` column.
  const openView = await prisma.savedView.create({
    data: {
      tenantId: tenant.id,
      name: "All open",
      isDefault: false,
      ownerTeamMemberId: null,
      filters: { status: "OPEN" },
      sort: { key: "updatedAt", dir: "desc" },
    },
  });

  // ---- Canned response + macro (Z6)
  const cannedGreet = await prisma.cannedResponse.create({
    data: {
      tenantId: tenant.id,
      ownerTeamMemberId: null,
      shortcut: "greet",
      name: "Standard greeting",
      body: "Hi {{ticket.client.name}}, thanks for reaching out.",
    },
  });
  const closeMacro = await prisma.macro.create({
    data: {
      tenantId: tenant.id,
      ownerTeamMemberId: null,
      name: "Close as duplicate",
      actions: [
        { type: "set_status", status: "CLOSED" },
        { type: "add_tag", tag: "duplicate" },
      ],
    },
  });

  await marker(tenant.id, "QA_SEED_DONE");
  console.log(`\n=== seed complete ===\n`);
  console.log(`login credentials (all against slug=${slug}):`);
  console.log(`  super admin  ${superAdmin.email}  /  ${superAdmin.password}`);
  console.log(`  admin        ${admin.email}       /  ${admin.password}`);
  console.log(`  agent(ALL)   ${agent1.email}      /  ${agent1.password}`);
  console.log(`  agent(GRP)   ${agent2.email}      /  ${agent2.password}`);
  console.log(`  light agent  ${lightAgent.email}  /  ${lightAgent.password}`);
  console.log(`  client 1     ${client1.email}     /  ${client1.password}`);
  console.log(`  client 2     ${client2.email}     /  ${client2.password}`);
  console.log(`  client 3     ${client3.email}     /  ${client3.password}`);
  console.log(`\ntenant.id: ${tenant.id}`);
  console.log(`teardown:  node scripts/qa_seed_tenant.mjs --teardown ${slug}\n`);
}

// ---------------------------------------------------------------------------
// Teardown
// ---------------------------------------------------------------------------

async function teardown(slug) {
  assertTestSlug(slug);
  const t = await prisma.tenant.findUnique({ where: { slug } });
  if (!t) {
    console.log(`no tenant with slug=${slug}`);
    return;
  }
  await marker(t.id, "QA_TEARDOWN_START");
  // The tenant → * cascade drops all Support-owned rows. Wrapper rows
  // (org, endUser, teamMember, group, role, tag_assignment) are scalar
  // tenantId FKs so we cascade them explicitly.
  await prisma.tagAssignment.deleteMany({ where: { tenantId: t.id } });
  await prisma.tag.deleteMany({ where: { tenantId: t.id } });
  await prisma.teamMemberGroup.deleteMany({ where: { tenantId: t.id } });
  await prisma.endUserOrganization.deleteMany({ where: { tenantId: t.id } });
  await prisma.endUser.deleteMany({ where: { tenantId: t.id } });
  await prisma.teamMember.deleteMany({ where: { tenantId: t.id } });
  await prisma.group.deleteMany({ where: { tenantId: t.id } });
  await prisma.role.deleteMany({ where: { tenantId: t.id } });
  await prisma.organization.deleteMany({ where: { tenantId: t.id } });
  await prisma.tenant.delete({ where: { id: t.id } });
  console.log(`teardown complete for slug=${slug}`);
}

async function list() {
  const rows = await prisma.tenant.findMany({
    where: { slug: { startsWith: SLUG_PREFIX } },
    orderBy: { createdAt: "desc" },
  });
  for (const r of rows) console.log(`  ${r.slug}  id=${r.id}  createdAt=${r.createdAt.toISOString()}`);
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
try {
  if (args[0] === "--seed") {
    await seed();
  } else if (args[0] === "--teardown") {
    await teardown(args[1]);
  } else if (args[0] === "--list") {
    await list();
  } else {
    console.log(`Usage:
  node scripts/qa_seed_tenant.mjs --seed
  node scripts/qa_seed_tenant.mjs --teardown <slug>
  node scripts/qa_seed_tenant.mjs --list`);
  }
} catch (e) {
  console.error(e);
  process.exit(1);
} finally {
  await prisma.$disconnect();
}
