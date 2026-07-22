import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/index.js";
const p = new PrismaClient();
await p.$executeRawUnsafe("alter table sla_policies enable row level security");
const [row] = await p.$queryRaw`
  SELECT c.relrowsecurity, c.relforcerowsecurity
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname='public' AND c.relname='sla_policies'`;
console.log(row);
await p.$disconnect();
