"use server";

// M8.1 / M8.6 — admin CRUD for the AiTool registry + role allow-lists.
// Every mutation gated on ADMIN+. Only ADMIN+ can add HTTP tools (the
// http-headers field can hold credentials); the UI enforces this too.
//
// Audit: every create/update/delete emits an AuditLog row scoped to
// the tenant. AiActionLog rows track only *invocations*.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withRls } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import {
  BUILTIN_HANDLERS,
  BUILTIN_DEFAULT_APPROVAL,
  BUILTIN_SCHEMAS,
  BUILTIN_DESCRIPTIONS,
} from "@/lib/ai/tools/builtins";
import { readSchema } from "@/lib/ai/tools/validate";
import { actorCols, dualFkForUser } from "@/lib/z1-dual-fk";

const CALLER_ROLES = ["CLIENT", "GUEST", "AGENT", "ADMIN", "SUPER_ADMIN"] as const;

const upsertSchema = z.object({
  id: z.string().min(1).optional(),
  name: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[a-z][a-z0-9_]*$/, "snake_case only, must start with a letter"),
  description: z.string().min(1).max(500),
  kind: z.enum(["INTERNAL", "HTTP"]),
  argsSchemaJson: z.string().min(2).max(20_000),
  requiresApproval: z.boolean(),
  isEnabled: z.boolean(),
  roleAllowlist: z.array(z.enum(CALLER_ROLES)).max(CALLER_ROLES.length),
  httpUrl: z.string().url().max(2000).optional().nullable(),
  httpMethod: z.enum(["GET", "POST", "PATCH", "DELETE"]).optional().nullable(),
  httpHeadersJson: z.string().max(4000).optional().nullable(),
  retryLimit: z.number().int().min(0).max(5),
});

export type ToolDto = {
  id: string;
  name: string;
  description: string;
  kind: string;
  argsSchemaJson: string;
  requiresApproval: boolean;
  isEnabled: boolean;
  roleAllowlist: string[];
  httpUrl: string | null;
  httpMethod: string | null;
  httpHeadersJson: string | null;
  retryLimit: number;
  updatedAt: string;
  isBuiltin: boolean;
};

export async function listAiTools(): Promise<ToolDto[]> {
  const session = await requireSession({ minRole: "ADMIN" });
  return withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const rows = await tx.aiTool.findMany({
        where: { tenantId: session.tenantId },
        orderBy: { name: "asc" },
      });
      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        kind: r.kind,
        argsSchemaJson: JSON.stringify(r.argsSchema, null, 2),
        requiresApproval: r.requiresApproval,
        isEnabled: r.isEnabled,
        roleAllowlist: Array.isArray(r.roleAllowlist) ? (r.roleAllowlist as string[]) : [],
        httpUrl: r.httpUrl,
        httpMethod: r.httpMethod,
        httpHeadersJson: r.httpHeaders ? JSON.stringify(r.httpHeaders, null, 2) : null,
        retryLimit: r.retryLimit,
        updatedAt: r.updatedAt.toISOString(),
        isBuiltin: r.name in BUILTIN_HANDLERS,
      }));
    }
  );
}

export async function upsertAiTool(input: z.infer<typeof upsertSchema>) {
  const session = await requireSession({ minRole: "ADMIN" });
  const data = upsertSchema.parse(input);

  // Validate the schema JSON before persisting — a malformed schema
  // would silently disable the tool via readSchema() at run time.
  let parsedSchema: unknown;
  try {
    parsedSchema = JSON.parse(data.argsSchemaJson);
  } catch {
    throw new Error("argsSchema is not valid JSON");
  }
  if (!readSchema(parsedSchema)) {
    throw new Error("argsSchema must be a top-level object with a properties map");
  }

  let parsedHeaders: unknown = null;
  if (data.kind === "HTTP") {
    if (!data.httpUrl) throw new Error("HTTP tool requires httpUrl");
    if (!data.httpMethod) throw new Error("HTTP tool requires httpMethod");
    if (data.httpHeadersJson) {
      try {
        parsedHeaders = JSON.parse(data.httpHeadersJson);
      } catch {
        throw new Error("httpHeaders is not valid JSON");
      }
      if (!parsedHeaders || typeof parsedHeaders !== "object" || Array.isArray(parsedHeaders)) {
        throw new Error("httpHeaders must be a JSON object");
      }
    }
  }

  // Spec §3 safety default — new sensitive tools must default to
  // requiresApproval=true. We warn (not block) when an admin lowers
  // this on a mutating INTERNAL builtin that ships with approval on.
  if (
    data.kind === "INTERNAL" &&
    data.name in BUILTIN_DEFAULT_APPROVAL &&
    BUILTIN_DEFAULT_APPROVAL[data.name] &&
    !data.requiresApproval
  ) {
    // The UI will surface a "downgrade acknowledged" copy — we still
    // let it through so the tenant has flexibility.
  }

  return withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const tool = data.id
        ? await tx.aiTool.update({
            where: { id: data.id },
            data: {
              name: data.name,
              description: data.description,
              kind: data.kind,
              argsSchema: parsedSchema as never,
              requiresApproval: data.requiresApproval,
              isEnabled: data.isEnabled,
              roleAllowlist: data.roleAllowlist as never,
              httpUrl: data.kind === "HTTP" ? data.httpUrl ?? null : null,
              httpMethod: data.kind === "HTTP" ? data.httpMethod ?? null : null,
              httpHeaders: data.kind === "HTTP" ? (parsedHeaders as never) : undefined,
              retryLimit: data.retryLimit,
            },
          })
        : await tx.aiTool.create({
            data: {
              tenantId: session.tenantId,
              name: data.name,
              description: data.description,
              kind: data.kind,
              argsSchema: parsedSchema as never,
              requiresApproval: data.requiresApproval,
              isEnabled: data.isEnabled,
              roleAllowlist: data.roleAllowlist as never,
              httpUrl: data.kind === "HTTP" ? data.httpUrl ?? null : null,
              httpMethod: data.kind === "HTTP" ? data.httpMethod ?? null : null,
              httpHeaders: data.kind === "HTTP" ? (parsedHeaders as never) : undefined,
              retryLimit: data.retryLimit,
            },
          });

      const dual = dualFkForUser(session.subjectId, session.role);
      await tx.auditLog.create({
        data: {
          tenantId: session.tenantId,
          ...actorCols(dual),
          action: data.id ? "AI_TOOL_UPDATE" : "AI_TOOL_CREATE",
          toValue: tool.name,
        },
      });

      revalidatePath("/admin/ai/tools");
      return { ok: true, id: tool.id };
    }
  );
}

export async function deleteAiTool(id: string) {
  const session = await requireSession({ minRole: "ADMIN" });
  return withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const tool = await tx.aiTool.findFirst({
        where: { id, tenantId: session.tenantId },
      });
      if (!tool) throw new Error("tool not found");
      await tx.aiTool.delete({ where: { id: tool.id } });
      const dual = dualFkForUser(session.subjectId, session.role);
      await tx.auditLog.create({
        data: {
          tenantId: session.tenantId,
          ...actorCols(dual),
          action: "AI_TOOL_DELETE",
          fromValue: tool.name,
        },
      });
      revalidatePath("/admin/ai/tools");
      return { ok: true };
    }
  );
}

/** Seed the four built-ins with their safe defaults. Idempotent — skips names already present. */
export async function seedBuiltinTools() {
  const session = await requireSession({ minRole: "ADMIN" });
  return withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const existing = await tx.aiTool.findMany({
        where: { tenantId: session.tenantId },
        select: { name: true },
      });
      const have = new Set(existing.map((r) => r.name));
      const toCreate = Object.keys(BUILTIN_HANDLERS).filter((n) => !have.has(n));
      for (const name of toCreate) {
        await tx.aiTool.create({
          data: {
            tenantId: session.tenantId,
            name,
            description: BUILTIN_DESCRIPTIONS[name] ?? name,
            kind: "INTERNAL",
            argsSchema: BUILTIN_SCHEMAS[name] as never,
            requiresApproval: BUILTIN_DEFAULT_APPROVAL[name] ?? true,
            isEnabled: true,
            // Sensible starting allow-list: agents + admins for
            // everything, plus clients on the two read-only builtins.
            roleAllowlist: (name === "get_ticket_status" || name === "get_recent_tickets_for_me"
              ? ["CLIENT", "AGENT", "ADMIN", "SUPER_ADMIN"]
              : ["AGENT", "ADMIN", "SUPER_ADMIN"]) as never,
            retryLimit: 2,
          },
        });
      }
      revalidatePath("/admin/ai/tools");
      return { ok: true, created: toCreate.length };
    }
  );
}
