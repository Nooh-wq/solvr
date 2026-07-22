import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/index.js";
const p = new PrismaClient();
const rows = await p.$queryRaw`
  SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname IN ('sla_policies','business_calendars','ticket_slas')
  ORDER BY c.relname`;
console.log(rows);
const pols = await p.$queryRaw`
  SELECT tablename, policyname FROM pg_policies
  WHERE tablename IN ('sla_policies','business_calendars','ticket_slas')
  ORDER BY tablename, policyname`;
console.log(pols);
await p.$disconnect();
