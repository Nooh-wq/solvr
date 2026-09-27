// src/lib/ai/tools/for-caller.ts
//
// Read the tenant's tool registry down to what the current caller
// role is allowed to invoke. This is the list sent to the model —
// it never sees tools it couldn't invoke anyway.

import type { PrismaClient } from "@/generated/prisma";
import type { ToolSpec, JsonSchemaObjectSpec } from "@/lib/ai/provider";
import type { ToolCallerRole } from "./types";
import { readSchema } from "./validate";

type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

export async function loadToolsForCaller(
  tx: Tx,
  tenantId: string,
  callerRole: ToolCallerRole
): Promise<ToolSpec[]> {
  const rows = await tx.aiTool.findMany({
    where: { tenantId, isEnabled: true },
    select: { name: true, description: true, argsSchema: true, roleAllowlist: true },
  });
  return rows
    .filter((r) => {
      const allow = Array.isArray(r.roleAllowlist) ? (r.roleAllowlist as string[]) : [];
      return allow.includes(callerRole);
    })
    .map((r) => {
      const schema = readSchema(r.argsSchema);
      if (!schema) return null;
      return {
        name: r.name,
        description: r.description,
        argsSchema: schema as JsonSchemaObjectSpec,
      };
    })
    .filter((t): t is ToolSpec => t !== null);
}
