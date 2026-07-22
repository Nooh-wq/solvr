// src/lib/ai/tools/builtins.ts
//
// M8 — hard-coded INTERNAL tool implementations. Each entry maps a
// stable `name` (the same string admins register in AiTool.name) to
// a handler that runs INSIDE the caller's RLS context (via the `tx`
// argument the executor passes in). No handler is ever run without
// its args being validated against the registered argsSchema first.
//
// Spec §3 pins encoded here:
//   - Tool credentials never sent to the model — handlers accept only
//     validated primitive args, no headers/keys.
//   - RLS applies to tool executions the same as any other action —
//     handlers receive the RLS-scoped Prisma tx; they never open a
//     separate connection.
//   - Sensitive builtins default requiresApproval=true through the
//     BUILTIN_DEFAULT_APPROVAL map — admins can lower this only by
//     explicit toggle in the registry UI (M8.5 pin: reversal is
//     expensive; approval is cheap).

import type { PrismaClient } from "@/generated/prisma";
import type { JsonSchemaObject, ToolCallerRole } from "./types";
import { createWithReference } from "@/lib/ticket-number";
import { actorCols, ticketClientCols, dualFkForUser } from "@/lib/z1-dual-fk";

/** RLS-scoped tx handed in by the executor. */
type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

export type BuiltinHandlerCtx = {
  tenantId: string;
  callerRole: ToolCallerRole;
  callerSubjectId: string | null;
  ticketId: string | null;
};

export type BuiltinHandler = (
  tx: Tx,
  ctx: BuiltinHandlerCtx,
  args: Record<string, unknown>
) => Promise<unknown>;

// ---------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------

const get_ticket_status: BuiltinHandler = async (tx, ctx, args) => {
  const reference = String(args.reference);
  const ticket = await tx.ticket.findFirst({
    where: { tenantId: ctx.tenantId, reference },
    select: {
      reference: true,
      title: true,
      status: true,
      priority: true,
      createdAt: true,
      resolvedAt: true,
    },
  });
  if (!ticket) throw new Error(`ticket ${reference} not found`);
  return {
    reference: ticket.reference,
    title: ticket.title,
    status: ticket.status,
    priority: ticket.priority,
    createdAt: ticket.createdAt.toISOString(),
    resolvedAt: ticket.resolvedAt?.toISOString() ?? null,
  };
};

const get_recent_tickets_for_me: BuiltinHandler = async (tx, ctx) => {
  // Uses the caller's subject id; RLS enforces tenant scoping.
  // For CLIENT and GUEST roles, the caller only sees their own — RLS
  // policies on tickets already gate this; we filter defensively too.
  if (!ctx.callerSubjectId) return [];
  const tickets = await tx.ticket.findMany({
    where: {
      tenantId: ctx.tenantId,
      OR: [
        { clientEndUserId: ctx.callerSubjectId },
        { clientTeamMemberId: ctx.callerSubjectId },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: 5,
    select: {
      reference: true,
      title: true,
      status: true,
      createdAt: true,
    },
  });
  return tickets.map((t) => ({
    reference: t.reference,
    title: t.title,
    status: t.status,
    createdAt: t.createdAt.toISOString(),
  }));
};

const create_ticket: BuiltinHandler = async (tx, ctx, args) => {
  const title = String(args.title);
  const description = String(args.description);
  const tenant = await tx.tenant.findUniqueOrThrow({
    where: { id: ctx.tenantId },
    select: { name: true },
  });
  // SYSTEM is not a UserRole (it maps to server-initiated actions with a
  // null actor). Anything else maps directly; GUEST is stored as CLIENT.
  const dualRole =
    ctx.callerRole === "SYSTEM"
      ? null
      : ctx.callerRole === "GUEST"
        ? "CLIENT"
        : ctx.callerRole;
  const clientDual =
    ctx.callerSubjectId && dualRole
      ? dualFkForUser(ctx.callerSubjectId, dualRole)
      : null;

  const ticket = await createWithReference(tenant.name, ({ reference, ticketNumber }) =>
    tx.ticket.create({
      data: {
        tenantId: ctx.tenantId,
        reference,
        ticketNumber,
        title,
        description,
        ...(clientDual ? ticketClientCols(clientDual) : {}),
        priority: "MEDIUM",
        status: "OPEN",
        source: "ai_tool",
      },
    })
  );
  if (clientDual) {
    await tx.auditLog.create({
      data: {
        tenantId: ctx.tenantId,
        ticketId: ticket.id,
        ...actorCols(clientDual),
        action: "CREATE",
        toValue: "OPEN",
      },
    });
  }
  return { reference: ticket.reference, id: ticket.id };
};

const add_internal_note: BuiltinHandler = async (tx, ctx, args) => {
  const body = String(args.body);
  if (!ctx.ticketId) throw new Error("ticketId is required in caller context");
  const message = await tx.message.create({
    data: {
      tenantId: ctx.tenantId,
      ticketId: ctx.ticketId,
      body,
      isInternal: true,
      senderRole: "SYSTEM",
    },
  });
  return { messageId: message.id };
};

// ---------------------------------------------------------------------
// Registry of built-in names → handler.
// ---------------------------------------------------------------------

export const BUILTIN_HANDLERS: Record<string, BuiltinHandler> = {
  get_ticket_status,
  get_recent_tickets_for_me,
  create_ticket,
  add_internal_note,
};

/** Spec §3 default: sensitive tools require approval unless the admin explicitly downgrades. */
export const BUILTIN_DEFAULT_APPROVAL: Record<string, boolean> = {
  get_ticket_status: false,
  get_recent_tickets_for_me: false,
  create_ticket: true,
  add_internal_note: true,
};

/** Suggested schema for each built-in — surfaced in the admin registry UI's "seed" list. */
export const BUILTIN_SCHEMAS: Record<string, JsonSchemaObject> = {
  get_ticket_status: {
    type: "object",
    properties: {
      reference: { type: "string", description: "Ticket reference like TKT-000123", minLength: 3, maxLength: 40 },
    },
    required: ["reference"],
  },
  get_recent_tickets_for_me: {
    type: "object",
    properties: {},
    required: [],
  },
  create_ticket: {
    type: "object",
    properties: {
      title: { type: "string", minLength: 3, maxLength: 200 },
      description: { type: "string", minLength: 3, maxLength: 20000 },
    },
    required: ["title", "description"],
  },
  add_internal_note: {
    type: "object",
    properties: {
      body: { type: "string", minLength: 1, maxLength: 5000 },
    },
    required: ["body"],
  },
};

export const BUILTIN_DESCRIPTIONS: Record<string, string> = {
  get_ticket_status: "Look up a ticket's current status by its reference. Read-only.",
  get_recent_tickets_for_me: "List the caller's 5 most recent tickets. Read-only.",
  create_ticket: "Create a new support ticket from the caller.",
  add_internal_note: "Add an internal note to the current ticket. Not visible to end users.",
};
