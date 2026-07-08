"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@/generated/prisma";
import { withRls } from "@/lib/db";
import { requireSession, roleAtLeast } from "@/lib/auth";
import { postAgentReply, updateTicket } from "@/actions/tickets";
import { actorCols, dualFkForUser } from "@/lib/z1-dual-fk";
import {
  macroActionsSchema,
  describeAction,
  type MacroAction,
} from "@/lib/macros";

// Z6.4 — macros. Personal or tenant-shared (nullable owner) like canned
// responses + views. The apply flow is deliberately **not** a bulk
// action: each action re-checks role/scope by delegating to the
// existing server actions (postAgentReply, updateTicket) rather than
// bypassing them. That preserves the Z5.5 Light Agent guardrail — a
// macro cannot elevate privileges to send a public message.

const createSchema = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(500).optional(),
  actions: macroActionsSchema,
  shared: z.boolean().default(false),
});

const updateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(80).optional(),
  description: z.string().max(500).optional(),
  actions: macroActionsSchema.optional(),
});

export type MacroRow = {
  id: string;
  ownerTeamMemberId: string | null;
  name: string;
  description: string | null;
  actions: MacroAction[];
  isShared: boolean;
  isOwned: boolean;
  createdAt: Date;
  updatedAt: Date;
};

function parseActions(raw: Prisma.JsonValue): MacroAction[] {
  const parsed = macroActionsSchema.safeParse(raw);
  return parsed.success ? parsed.data : [];
}

export async function listMacros(): Promise<MacroRow[]> {
  const session = await requireSession({ minRole: "AGENT" });
  return withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const rows = await tx.macro.findMany({
        where: {
          tenantId: session.tenantId,
          OR: [
            { ownerTeamMemberId: session.subjectId },
            { ownerTeamMemberId: null },
          ],
        },
        orderBy: [{ ownerTeamMemberId: "asc" }, { name: "asc" }],
      });
      return rows.map((r) => ({
        id: r.id,
        ownerTeamMemberId: r.ownerTeamMemberId,
        name: r.name,
        description: r.description,
        actions: parseActions(r.actions),
        isShared: r.ownerTeamMemberId === null,
        isOwned: r.ownerTeamMemberId === session.subjectId,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      }));
    }
  );
}

export async function createMacro(input: z.infer<typeof createSchema>) {
  const session = await requireSession({ minRole: "AGENT" });
  const data = createSchema.parse(input);
  if (data.shared && !roleAtLeast(session.role, "ADMIN")) {
    throw new Error("Only admins can create shared macros.");
  }
  const ownerTeamMemberId = data.shared ? null : session.subjectId;
  const row = await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    (tx) =>
      tx.macro.create({
        data: {
          tenantId: session.tenantId,
          ownerTeamMemberId,
          name: data.name,
          description: data.description,
          actions: data.actions as Prisma.InputJsonValue,
        },
      })
  );
  revalidatePath("/admin/macros");
  return { id: row.id };
}

export async function updateMacro(input: z.infer<typeof updateSchema>) {
  const session = await requireSession({ minRole: "AGENT" });
  const data = updateSchema.parse(input);
  await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const existing = await tx.macro.findFirst({
        where: { id: data.id, tenantId: session.tenantId },
      });
      if (!existing) throw new Error("Macro not found.");
      const isShared = existing.ownerTeamMemberId === null;
      if (isShared && !roleAtLeast(session.role, "ADMIN")) {
        throw new Error("Only admins can edit shared macros.");
      }
      if (!isShared && existing.ownerTeamMemberId !== session.subjectId) {
        throw new Error("You can only edit your own macros.");
      }
      await tx.macro.update({
        where: { id: data.id },
        data: {
          ...(data.name !== undefined && { name: data.name }),
          ...(data.description !== undefined && { description: data.description }),
          ...(data.actions !== undefined && { actions: data.actions as Prisma.InputJsonValue }),
        },
      });
    }
  );
  revalidatePath("/admin/macros");
  return { ok: true as const };
}

export async function deleteMacro(id: string) {
  const session = await requireSession({ minRole: "AGENT" });
  await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const existing = await tx.macro.findFirst({
        where: { id, tenantId: session.tenantId },
      });
      if (!existing) throw new Error("Macro not found.");
      const isShared = existing.ownerTeamMemberId === null;
      if (isShared && !roleAtLeast(session.role, "ADMIN")) {
        throw new Error("Only admins can delete shared macros.");
      }
      if (!isShared && existing.ownerTeamMemberId !== session.subjectId) {
        throw new Error("You can only delete your own macros.");
      }
      await tx.macro.delete({ where: { id } });
    }
  );
  revalidatePath("/admin/macros");
  return { ok: true as const };
}

// ---------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------

const applySchema = z.object({
  macroId: z.string().min(1),
  ticketId: z.string().min(1),
});

export type MacroApplyResult = {
  ok: true;
  ranActionCount: number;
  /** For "insert_reply_template": the expanded body(s) to hydrate the composer with. Empty if the macro didn't include one. */
  insertReplyBodies: string[];
  /** Actions that were skipped and why — surfaced back to the UI. */
  skipped: Array<{ index: number; reason: string }>;
  /** Prior status/priority captured so undo can restore them. */
  undo: { previousStatus?: string; previousPriority?: string } | null;
  ranActions: Array<{ index: number; summary: string }>;
};

/**
 * Applies a macro against one ticket. Every side-effecting action is
 * delegated to the existing server action for it — postAgentReply for
 * notes (which will 403 for Light Agents on public messages,
 * unchanged), updateTicket for status changes. `insert_reply_template`
 * returns its body to the caller for composer hydration; it does NOT
 * post a message on its own.
 *
 * Skipped actions do NOT abort the macro — the loop records them and
 * moves on. This matches Zendesk parity (a partial-failure macro is
 * still useful) and keeps the audit log honest about what fired.
 */
export async function applyMacro(
  input: z.infer<typeof applySchema>
): Promise<MacroApplyResult> {
  const session = await requireSession({ minRole: "AGENT" });
  const data = applySchema.parse(input);

  const { macro, ticket } = await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const macro = await tx.macro.findFirst({
        where: {
          id: data.macroId,
          tenantId: session.tenantId,
          OR: [
            { ownerTeamMemberId: session.subjectId },
            { ownerTeamMemberId: null },
          ],
        },
      });
      if (!macro) throw new Error("Macro not found or not visible to you.");
      const ticket = await tx.ticket.findFirst({
        where: { id: data.ticketId, tenantId: session.tenantId },
        select: { id: true, status: true, priority: true },
      });
      if (!ticket) throw new Error("Ticket not found.");
      return { macro, ticket };
    }
  );

  const actions = parseActions(macro.actions);
  const insertReplyBodies: string[] = [];
  const ranActions: Array<{ index: number; summary: string }> = [];
  const skipped: Array<{ index: number; reason: string }> = [];
  const undo = { previousStatus: ticket.status, previousPriority: ticket.priority };

  for (let i = 0; i < actions.length; i++) {
    const a = actions[i];
    try {
      if (a.type === "add_internal_note") {
        // Internal notes never trigger the Light Agent guardrail —
        // still, delegating through postAgentReply preserves every
        // other auth/audit hook it already runs.
        await postAgentReply({
          ticketId: data.ticketId,
          body: a.body,
          isInternal: true,
        });
      } else if (a.type === "change_status") {
        await updateTicket({
          ticketId: data.ticketId,
          status: a.status,
        });
      } else if (a.type === "insert_reply_template") {
        // Not a mutation — return the body to the caller. Placeholder
        // expansion happens client-side in the composer, same as
        // canned responses.
        insertReplyBodies.push(a.body);
      }
      ranActions.push({ index: i, summary: describeAction(a) });
    } catch (e) {
      skipped.push({
        index: i,
        reason: e instanceof Error ? e.message : "Unknown error",
      });
    }
  }

  // Audit at the macro level (individual action audits already fire
  // from postAgentReply/updateTicket).
  await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      await tx.auditLog.create({
        data: {
          tenantId: session.tenantId,
          ticketId: data.ticketId,
          ...actorCols(dualFkForUser(session.subjectId, session.role)),
          action: "APPLY_MACRO",
          toValue: `${macro.name} (${ranActions.length}/${actions.length} actions)`,
        },
      });
    }
  );

  return {
    ok: true,
    ranActionCount: ranActions.length,
    insertReplyBodies,
    skipped,
    undo:
      undo.previousStatus !== ticket.status || undo.previousPriority !== ticket.priority
        ? undo
        : null,
    ranActions,
  };
}

/**
 * Reverts the status/priority changes captured on the previous
 * applyMacro() call. 10-second window is enforced client-side (the
 * Toast controls the button visibility); server-side we just do what
 * the caller asks, so a valid undo never fails silently on race.
 */
const undoSchema = z.object({
  ticketId: z.string().min(1),
  previousStatus: z.enum(["OPEN", "IN_PROGRESS", "PENDING", "RESOLVED", "CLOSED"]).optional(),
  previousPriority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).optional(),
});

export async function undoMacroApply(input: z.infer<typeof undoSchema>) {
  await requireSession({ minRole: "AGENT" });
  const data = undoSchema.parse(input);
  await updateTicket({
    ticketId: data.ticketId,
    ...(data.previousStatus && { status: data.previousStatus }),
    ...(data.previousPriority && { priority: data.previousPriority }),
  });
  return { ok: true as const };
}
