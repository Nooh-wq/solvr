import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaClient, type TicketStatus, type Priority } from "../src/generated/prisma";
import { initialsOf } from "../src/lib/ticket-number";

const prisma = new PrismaClient();

// Same password for every demo account — fine for local/demo data only.
const DEMO_PASSWORD = "StralisDemo123!";

/** Upserts a User row with a bcrypt hash of DEMO_PASSWORD so the seeded account can log in immediately. */
async function upsertDemoUser(opts: {
  tenantId: string;
  name: string;
  email: string;
  role: "CLIENT" | "AGENT" | "ADMIN" | "SUPER_ADMIN";
  company?: string;
  status?: "PENDING" | "ACTIVE" | "REJECTED" | "SUSPENDED";
}) {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);

  return prisma.user.upsert({
    where: { tenantId_email: { tenantId: opts.tenantId, email: opts.email } },
    update: {},
    create: {
      tenantId: opts.tenantId,
      name: opts.name,
      email: opts.email,
      role: opts.role,
      company: opts.company,
      passwordHash,
      status: opts.status ?? "ACTIVE",
    },
  });
}


async function main() {
  const tenant = await prisma.tenant.upsert({
    where: { slug: "stralis" },
    update: { name: "solvr" },
    create: {
      name: "solvr",
      // Kept as "stralis" — internal identifier only (subdomain routing,
      // HOST_TENANT_SLUG in lib/tenant.ts, DEFAULT_EMAIL_DOMAIN in .env),
      // never shown in the UI. The visible product name is "productName"
      // below, which is what changed for the solvr rebrand.
      slug: "stralis",
      type: "INTERNAL",
      status: "ACTIVE",
      branding: {
        create: {
          productName: "solvr",
          primaryColor: "#FF6A00",
          accentColor: "#000000",
          emailFromName: "solvr Support",
          supportEmail: "support@stralis.app",
        },
      },
      chatbotConfig: {
        create: {
          isEnabled: true,
          persona: "a friendly, direct solvr support assistant",
          deflectFirst: true,
          escalateAfter: 3,
        },
      },
    },
  });

  await prisma.tenantBranding.upsert({
    where: { tenantId: tenant.id },
    update: { productName: "solvr", emailFromName: "solvr Support", supportEmail: "support@stralis.app" },
    create: {
      tenantId: tenant.id,
      productName: "solvr",
      primaryColor: "#FF6A00",
      accentColor: "#000000",
      emailFromName: "solvr Support",
      supportEmail: "support@stralis.app",
    },
  });

  const categories = new Map<string, string>();
  for (const name of ["Technical", "Billing", "General", "Other"]) {
    const c = await prisma.category.upsert({
      where: { tenantId_name: { tenantId: tenant.id, name } },
      update: {},
      create: { tenantId: tenant.id, name },
    });
    categories.set(name, c.id);
  }

  const superAdmin = await upsertDemoUser({
    tenantId: tenant.id,
    name: "Stralis Super Admin",
    email: "superadmin@stralis.app",
    role: "SUPER_ADMIN",
  });
  const admin = await upsertDemoUser({ tenantId: tenant.id, name: "Stralis Admin", email: "admin@stralis.app", role: "ADMIN" });
  const agent = await upsertDemoUser({ tenantId: tenant.id, name: "Jordan Reyes", email: "agent@stralis.app", role: "AGENT" });
  const agent2 = await upsertDemoUser({ tenantId: tenant.id, name: "Sam Patel", email: "sam@stralis.app", role: "AGENT" });

  const clientA = await upsertDemoUser({
    tenantId: tenant.id,
    name: "Dana Whitfield",
    email: "client@example.com",
    role: "CLIENT",
    company: "Acme Corp",
  });
  const clientB = await upsertDemoUser({
    tenantId: tenant.id,
    name: "Marcus Lee",
    email: "marcus@northwind.io",
    role: "CLIENT",
    company: "Northwind Logistics",
  });
  // Exercises the registration-approval UI (/admin/team) out of the box.
  await upsertDemoUser({
    tenantId: tenant.id,
    name: "Priya Nair",
    email: "pending@example.com",
    role: "CLIENT",
    company: "Vantage Retail",
    status: "PENDING",
  });

  // --- Demo tickets -----------------------------------------------------
  type SeedTicket = {
    ref: number;
    title: string;
    description: string;
    category: string;
    priority: Priority;
    status: TicketStatus;
    client: typeof clientA;
    assignedTo?: typeof agent | null;
    thread: { from: "client" | "agent" | "internal"; body: string }[];
  };

  const seedTickets: SeedTicket[] = [
    {
      ref: 1,
      title: "Can't log in after password reset",
      description: "I reset my password yesterday but the new one isn't being accepted on the login page.",
      category: "Technical",
      priority: "HIGH",
      status: "OPEN",
      client: clientA,
      assignedTo: null,
      thread: [],
    },
    {
      ref: 2,
      title: "Invoice total doesn't match quote",
      description: "Our March invoice shows $1,240 but the quote we signed was for $980. Can you check?",
      category: "Billing",
      priority: "MEDIUM",
      status: "IN_PROGRESS",
      client: clientB,
      assignedTo: agent,
      thread: [
        { from: "agent", body: "Thanks for flagging this, Marcus — pulling up the invoice now." },
        { from: "internal", body: "Looks like an extra seat was added mid-cycle. Checking with billing before responding." },
      ],
    },
    {
      ref: 3,
      title: "Export to CSV is missing the last column",
      description: "When I export the report, the 'Status' column is cut off in the downloaded file.",
      category: "Technical",
      priority: "LOW",
      status: "PENDING",
      client: clientA,
      assignedTo: agent2,
      thread: [
        { from: "agent", body: "Could you tell me which browser and report type you're exporting from?" },
      ],
    },
    {
      ref: 4,
      title: "Feature request: dark mode",
      description: "Would love a dark mode option for the dashboard.",
      category: "General",
      priority: "LOW",
      status: "RESOLVED",
      client: clientB,
      assignedTo: agent,
      thread: [
        { from: "agent", body: "Logged this with our product team — not on the near-term roadmap, but appreciated!" },
      ],
    },
    {
      ref: 5,
      title: "Account locked after failed login attempts",
      description: "My account got locked after a few wrong password attempts. Can someone unlock it?",
      category: "Technical",
      priority: "URGENT",
      status: "CLOSED",
      client: clientA,
      assignedTo: admin,
      thread: [
        { from: "agent", body: "Unlocked your account — you should be able to log in now." },
        { from: "client", body: "Confirmed, thank you!" },
      ],
    },
  ];

  const referencePrefix = initialsOf(tenant.name);
  for (const t of seedTickets) {
    // Deterministic per-seed-run ticketNumber (not reference) is the
    // idempotency key here — reference format can change without the
    // "reuse existing tickets on re-seed" guarantee breaking.
    const ticketNumber = String(30_000_000 + t.ref);
    const existing = await prisma.ticket.findUnique({ where: { ticketNumber } });
    if (existing) continue;

    const reference = `${referencePrefix}-${10_000 + t.ref}`;
    const ticket = await prisma.ticket.create({
      data: {
        tenantId: tenant.id,
        reference,
        ticketNumber,
        title: t.title,
        description: t.description,
        categoryId: categories.get(t.category),
        priority: t.priority,
        status: t.status,
        clientId: t.client.id,
        assignedToId: t.assignedTo?.id,
        firstReplyAt: t.thread.some((m) => m.from === "agent") ? new Date() : null,
        resolvedAt: t.status === "RESOLVED" || t.status === "CLOSED" ? new Date() : null,
      },
    });

    for (const m of t.thread) {
      await prisma.message.create({
        data: {
          tenantId: tenant.id,
          ticketId: ticket.id,
          senderId: m.from === "client" ? t.client.id : t.assignedTo?.id ?? agent.id,
          senderRole: m.from === "client" ? "CLIENT" : "AGENT",
          body: m.body,
          isInternal: m.from === "internal",
        },
      });
    }

    await prisma.auditLog.create({
      data: { tenantId: tenant.id, ticketId: ticket.id, action: "CREATE", toValue: "OPEN" },
    });
  }

  console.log({
    tenant: tenant.slug,
    accounts: [superAdmin.email, admin.email, agent.email, agent2.email, clientA.email, clientB.email],
    demoPassword: DEMO_PASSWORD,
    tickets: seedTickets.length,
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
