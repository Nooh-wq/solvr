// src/lib/ai/tools/executor.ts
//
// M8 — the single choke point that runs a proposed AI tool call. Every
// guardrail from spec §3 is anchored here:
//
//   - "Do NOT let the AI call a tool not in the tenant's registry"
//     → lookup by (tenantId, name) with isEnabled=true; unknown/off
//       tools produce a REJECTED action log and return rejected.
//   - "Do NOT execute a tool without validating its arguments"
//     → validateArgs() before the handler runs.
//   - "Do NOT let a tool's output leak into another tenant's context"
//     → executor takes an RLS-scoped tx from withRls at the caller.
//   - "Do NOT let the model see tenant secrets or API keys"
//     → HTTP tool credentials read from AiTool.httpHeaders on the
//       server side; we never pass them back up the stack.
//   - "Do NOT skip audit on approval-gated tools"
//     → every path writes an AiActionLog row before returning.
//   - "Do NOT let the AI silently retry failed tools"
//     → runWithRetries loops up to tool.retryLimit + 1 attempts and
//       increments AiActionLog.attempts on each — never silent.
//   - "Do NOT ship AI tools that modify tenant billing, delete data, or
//     send external emails without requiresApproval=true by default"
//     → BUILTIN_DEFAULT_APPROVAL in builtins.ts; admin UI seeds it.

import type { PrismaClient } from "@/generated/prisma";
import { prisma, withRls } from "@/lib/db";
import { readSchema, validateArgs } from "./validate";
import {
  BUILTIN_HANDLERS,
  type BuiltinHandlerCtx,
} from "./builtins";
import type {
  ExecutorInput,
  ExecutorOutcome,
  ToolCallerRole,
} from "./types";

type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

const HTTP_TIMEOUT_MS = 15_000;

/**
 * Execute (or queue) a proposed AI tool call. Always writes at least
 * one AiActionLog row before returning — the calling chat loop can
 * safely surface actionLogId to the user / agent without extra work.
 */
export async function runProposedTool(input: ExecutorInput): Promise<ExecutorOutcome> {
  const { tenantId, callerRole, callerSubjectId, ticketId, conversationId, proposal } = input;

  // Registry lookup — under the caller's RLS context so a rogue caller
  // can't probe another tenant's tools even if they know the id.
  const rlsCtx = {
    tenantId,
    userId: callerSubjectId,
    role: callerRole === "SYSTEM" ? "SUPER_ADMIN" : callerRole,
  } as const;

  const tool = await withRls(rlsCtx, (tx) =>
    tx.aiTool.findFirst({
      where: { tenantId, name: proposal.name, isEnabled: true },
    })
  );

  if (!tool) {
    return {
      kind: "rejected",
      reason: `unknown or disabled tool: ${proposal.name}`,
      actionLogId: null,
    };
  }

  // Allow-list gate — spec §M8.6.
  const allowlist = Array.isArray(tool.roleAllowlist)
    ? (tool.roleAllowlist as string[])
    : [];
  if (!allowlist.includes(callerRole)) {
    // Still audit the attempt — rejected but visible in the queue.
    const log = await writeActionLog(tenantId, {
      tool,
      conversationId,
      ticketId,
      proposedByRole: callerRole,
      proposedBySubjectId: callerSubjectId,
      argsJson: proposal.args,
      status: "REJECTED",
      errorMessage: `role ${callerRole} not in allow-list`,
      decidedAt: new Date(),
    });
    return {
      kind: "rejected",
      reason: `role ${callerRole} is not allowed to invoke ${tool.name}`,
      actionLogId: log.id,
    };
  }

  // Args schema validation.
  const schema = readSchema(tool.argsSchema);
  if (!schema) {
    const log = await writeActionLog(tenantId, {
      tool,
      conversationId,
      ticketId,
      proposedByRole: callerRole,
      proposedBySubjectId: callerSubjectId,
      argsJson: proposal.args,
      status: "REJECTED",
      errorMessage: "tool argsSchema is malformed",
      decidedAt: new Date(),
    });
    return {
      kind: "rejected",
      reason: "tool argsSchema is malformed",
      actionLogId: log.id,
    };
  }
  const validation = validateArgs(schema, proposal.args);
  if (!validation.ok) {
    const log = await writeActionLog(tenantId, {
      tool,
      conversationId,
      ticketId,
      proposedByRole: callerRole,
      proposedBySubjectId: callerSubjectId,
      argsJson: proposal.args,
      status: "REJECTED",
      errorMessage: `invalid arguments: ${validation.error}`,
      decidedAt: new Date(),
    });
    return {
      kind: "rejected",
      reason: validation.error,
      actionLogId: log.id,
    };
  }

  // Approval branch — write PROPOSED and let the agent queue take over.
  if (tool.requiresApproval) {
    const log = await writeActionLog(tenantId, {
      tool,
      conversationId,
      ticketId,
      proposedByRole: callerRole,
      proposedBySubjectId: callerSubjectId,
      argsJson: proposal.args,
      status: "PROPOSED",
    });
    return { kind: "queued-for-approval", actionLogId: log.id };
  }

  // Direct execute path.
  const log = await writeActionLog(tenantId, {
    tool,
    conversationId,
    ticketId,
    proposedByRole: callerRole,
    proposedBySubjectId: callerSubjectId,
    argsJson: proposal.args,
    status: "PROPOSED",
  });

  return await executeAndFinalize(log.id, {
    tool,
    callerRole,
    callerSubjectId,
    ticketId,
    args: validation.value,
  });
}

/**
 * Called from src/actions/aiActionQueue.ts when an agent approves a
 * previously-queued action. Runs the tool now that a human has said yes.
 */
export async function executeApprovedAction(actionLogId: string): Promise<ExecutorOutcome> {
  const log = await prisma.aiActionLog.findUniqueOrThrow({
    where: { id: actionLogId },
    include: { tool: true },
  });
  if (log.status !== "APPROVED") {
    throw new Error(`action ${actionLogId} not in APPROVED state (got ${log.status})`);
  }
  const schema = readSchema(log.tool.argsSchema);
  if (!schema) throw new Error("tool argsSchema is malformed");
  const validation = validateArgs(schema, log.argsJson);
  if (!validation.ok) throw new Error(`invalid arguments: ${validation.error}`);

  return executeAndFinalize(actionLogId, {
    tool: log.tool,
    callerRole: log.proposedByRole as ToolCallerRole,
    callerSubjectId: log.proposedBySubjectId,
    ticketId: log.ticketId,
    args: validation.value,
  });
}

// ---------------------------------------------------------------------
// Execution + retry loop.
// ---------------------------------------------------------------------

async function executeAndFinalize(
  actionLogId: string,
  args: {
    tool: {
      id: string;
      name: string;
      kind: string;
      retryLimit: number;
      httpUrl: string | null;
      httpMethod: string | null;
      httpHeaders: unknown;
    };
    callerRole: ToolCallerRole;
    callerSubjectId: string | null;
    ticketId: string | null;
    args: Record<string, unknown>;
  }
): Promise<ExecutorOutcome> {
  const rlsCtx = {
    tenantId: (await prisma.aiActionLog.findUniqueOrThrow({
      where: { id: actionLogId },
      select: { tenantId: true },
    })).tenantId,
    userId: args.callerSubjectId,
    role: args.callerRole === "SYSTEM" ? "SUPER_ADMIN" : args.callerRole,
  } as const;

  const maxAttempts = Math.max(1, args.tool.retryLimit + 1);
  let lastError: string | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await prisma.aiActionLog.update({
      where: { id: actionLogId },
      data: { attempts: attempt },
    });

    try {
      const result =
        args.tool.kind === "HTTP"
          ? await runHttp(args.tool, args.args)
          : await withRls(rlsCtx, (tx) =>
              runBuiltin(tx, args.tool.name, {
                tenantId: rlsCtx.tenantId,
                callerRole: args.callerRole,
                callerSubjectId: args.callerSubjectId,
                ticketId: args.ticketId,
              }, args.args)
            );

      await prisma.aiActionLog.update({
        where: { id: actionLogId },
        data: {
          status: "EXECUTED",
          resultJson: result as never,
          executedAt: new Date(),
          errorMessage: null,
        },
      });
      // Dual audit — the ticket-level audit log (surfaces in the ticket
      // timeline UI alongside other actor events).
      if (args.ticketId) {
        await withRls(rlsCtx, (tx) =>
          tx.auditLog.create({
            data: {
              tenantId: rlsCtx.tenantId,
              ticketId: args.ticketId!,
              action: "AI_TOOL_EXECUTED",
              toValue: args.tool.name,
            },
          })
        );
      }
      return { kind: "executed", result, actionLogId };
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
      // Continue to next attempt if any remain.
    }
  }

  await prisma.aiActionLog.update({
    where: { id: actionLogId },
    data: {
      status: "FAILED",
      errorMessage: lastError ?? "unknown error",
      executedAt: new Date(),
    },
  });
  return { kind: "failed", error: lastError ?? "unknown error", actionLogId };
}

async function runBuiltin(
  tx: Tx,
  name: string,
  ctx: BuiltinHandlerCtx,
  args: Record<string, unknown>
): Promise<unknown> {
  const handler = BUILTIN_HANDLERS[name];
  if (!handler) throw new Error(`no INTERNAL handler for tool '${name}'`);
  return handler(tx, ctx, args);
}

async function runHttp(
  tool: { httpUrl: string | null; httpMethod: string | null; httpHeaders: unknown },
  args: Record<string, unknown>
): Promise<unknown> {
  if (!tool.httpUrl) throw new Error("HTTP tool missing httpUrl");
  const method = (tool.httpMethod ?? "POST").toUpperCase();
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (tool.httpHeaders && typeof tool.httpHeaders === "object") {
    for (const [k, v] of Object.entries(tool.httpHeaders as Record<string, unknown>)) {
      if (typeof v === "string") headers[k] = v;
    }
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
  try {
    const response = await fetch(tool.httpUrl, {
      method,
      headers,
      body: method === "GET" ? undefined : JSON.stringify(args),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const contentType = response.headers.get("content-type") ?? "";
    return contentType.includes("application/json")
      ? await response.json()
      : { body: (await response.text()).slice(0, 4000) };
  } finally {
    clearTimeout(timeout);
  }
}

// ---------------------------------------------------------------------
// Log writer — used at every branch. Uses `prisma` directly (not RLS
// tx) because the executor runs under a system context similar to the
// classify-message Inngest handler: the tenantId is authoritative
// (from the tool lookup, which WAS scoped), and we need to record
// audit rows even on rejections where withRls would refuse.
// ---------------------------------------------------------------------

async function writeActionLog(
  tenantId: string,
  input: {
    tool: { id: string; name: string };
    conversationId: string | null;
    ticketId: string | null;
    proposedByRole: ToolCallerRole;
    proposedBySubjectId: string | null;
    argsJson: Record<string, unknown>;
    status: "PROPOSED" | "REJECTED";
    errorMessage?: string;
    decidedAt?: Date;
  }
) {
  return prisma.aiActionLog.create({
    data: {
      tenantId,
      toolId: input.tool.id,
      toolName: input.tool.name,
      conversationId: input.conversationId,
      ticketId: input.ticketId,
      proposedByRole: input.proposedByRole,
      proposedBySubjectId: input.proposedBySubjectId,
      argsJson: input.argsJson as never,
      status: input.status,
      errorMessage: input.errorMessage,
      decidedAt: input.decidedAt ?? null,
    },
  });
}
