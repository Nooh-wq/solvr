import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma";

// Post-Z1.5c: seed.ts is minimal — it provisions the host tenant, its
// branding/chatbot config, and default categories. Users, tickets and
// messages now live in the wrapper (end_users/team_members) and are
// created through the app itself or via scripts/z1_8_staging_tenant.mjs.
// The old dual-write demo dataset was tightly coupled to the legacy
// `users` table (dropped by prisma/z1_5c_migration.sql) and porting it
// to the wrapper is deferred behind Z1's stabilization window.

const prisma = new PrismaClient();

async function main() {
  const tenant = await prisma.tenant.upsert({
    where: { slug: "stralis" },
    update: { name: "solvr" },
    create: {
      name: "solvr",
      slug: "stralis",
      type: "INTERNAL",
      status: "ACTIVE",
      branding: { create: { productName: "solvr" } },
      chatbotConfig: { create: {} },
    },
  });

  const defaultCategories = ["Technical", "Billing", "General", "Other"];
  for (const name of defaultCategories) {
    await prisma.category.upsert({
      where: { tenantId_name: { tenantId: tenant.id, name } },
      update: {},
      create: { tenantId: tenant.id, name },
    });
  }

  console.log({ tenant: tenant.slug, categories: defaultCategories.length });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
