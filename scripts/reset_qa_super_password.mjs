// One-off: set the QA Super Admin's password to a known value.
// Non-destructive — only touches the AuthCredential row for that email.
//
// Usage:  node --env-file=.env scripts/reset_qa_super_password.mjs
//
// After running, sign in at http://localhost:3000/auth/login with:
//   qa-super@stralis-qa.test  /  Localhost123!

import { PrismaClient } from "../src/generated/prisma/index.js";
import bcrypt from "bcryptjs";

const EMAIL = "qa-super@stralis-qa.test";
const NEW_PASSWORD = "Localhost123!";

const prisma = new PrismaClient();

async function main() {
  // Find every TeamMember with this email (across all tenants — should
  // be one in the QA-seeded tenant).
  const tms = await prisma.teamMember.findMany({
    where: { email: EMAIL },
    select: { id: true, tenantId: true },
  });
  if (tms.length === 0) {
    console.error(`No TeamMember with email ${EMAIL} — run \`node scripts/qa_seed_tenant.mjs\` first.`);
    process.exit(1);
  }

  const hash = await bcrypt.hash(NEW_PASSWORD, 10);
  for (const tm of tms) {
    const tenant = await prisma.tenant.findUnique({
      where: { id: tm.tenantId },
      select: { slug: true },
    });
    const result = await prisma.authCredential.updateMany({
      where: { tenantId: tm.tenantId, subjectTeamMemberId: tm.id },
      data: { passwordHash: hash, passwordChangedAt: new Date() },
    });
    console.log(
      `tenant ${tenant?.slug ?? "?"} (${tm.tenantId}): updated ${result.count} AuthCredential row(s) for ${EMAIL}`
    );
  }

  console.log("\n---");
  console.log(`Email:    ${EMAIL}`);
  console.log(`Password: ${NEW_PASSWORD}`);
  console.log(`Login at: http://localhost:3000/auth/login`);
  console.log("---\n");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
