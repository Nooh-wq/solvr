"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@/generated/prisma";
import { withRls } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { actorCols, dualFkForUser } from "@/lib/z1-dual-fk";
import {
  createTriggerSchema,
  createAutomationSchema,
  updateRuleSchema,
  type TriggerEvent,
  type RuleAction,
  type ConditionGroup,
} from "@/lib/rule-schema";
import { runAutomationOnce } from "@/lib/rule-engine";

// Z8 — Rule CRUD. Triggers and Automations share the Rule table with a
// `kind` discriminator. Admin-only. Every create/update/delete/toggle
// writes to AuditLog per DoD §7.
//
// The engine (src/lib/rule-engine.ts) is what actually fires rules;
// this file only manages their config.

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export type RuleRow = {
  id: string;
  kind: "TRIGGER" | "AUTOMATION";
  name: string;
  description: string | null;
  active: boolean;
  triggerEvent: TriggerEvent | null;
  intervalHours: number | null;
  conditions: ConditionGroup;
  actions: RuleAction[];
  lastRunAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

function normalizeRow(r: {
  id: string;
  kind: "TRIGGER" | "AUTOMATION";
  name: string;
  description: string | null;
  active: boolean;
  triggerEvent: TriggerEvent | null;
  intervalHours: number | null;
  conditions: Prisma.JsonValue;
  actions: Prisma.JsonValue;
  lastRunAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): RuleRow {
  return {
    ...r,
    conditions: (r.conditions as unknown as ConditionGroup) ?? { match: "all", conditions: [] },
    actions: (r.actions as unknown as RuleAction[]) ?? [],
  };
}

export async function listTriggers(): Promise<RuleRow[]> {
  const session = await requireSession({ minRole: "ADMIN" });
  const rows = await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    (tx) =>
      tx.rule.findMany({
        where: { tenantId: session.tenantId, kind: "TRIGGER" },
        orderBy: [{ active: "desc" }, { createdAt: "asc" }],
      })
  );
  return rows.map((r) =>
    normalizeRow({
      id: r.id,
      kind: r.kind as "TRIGGER",
      name: r.name,
      description: r.description,
      active: r.active,
      triggerEvent: (r.triggerEvent as TriggerEvent | null) ?? null,
      intervalHours: r.intervalHours,
      conditions: r.conditions,
      actions: r.actions,
      lastRunAt: r.lastRunAt,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    })
  );
}

export async function listAutomations(): Promise<RuleRow[]> {
  const session = await requireSession({ minRole: "ADMIN" });
  const rows = await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    (tx) =>
      tx.rule.findMany({
        where: { tenantId: session.tenantId, kind: "AUTOMATION" },
        orderBy: [{ active: "desc" }, { createdAt: "asc" }],
      })
  );
  return rows.map((r) =>
    normalizeRow({
      id: r.id,
      kind: r.kind as "AUTOMATION",
      name: r.name,
      description: r.description,
      active: r.active,
      triggerEvent: null,
      intervalHours: r.intervalHours,
      conditions: r.conditions,
      actions: r.actions,
      lastRunAt: r.lastRunAt,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    })
  );
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

export async function createTrigger(input: z.infer<typeof createTriggerSchema>) {
  const session = await requireSession({ minRole: "ADMIN" });
  const data = createTriggerSchema.parse(input);
  const row = await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const r = await tx.rule.create({
        data: {
          tenantId: session.tenantId,
          kind: "TRIGGER",
          name: data.name,
          description: data.description,
          triggerEvent: data.triggerEvent,
          conditions: data.conditions as Prisma.InputJsonValue,
          actions: data.actions as Prisma.InputJsonValue,
          active: data.active,
        },
      });
      await tx.auditLog.create({
        data: {
          tenantId: session.tenantId,
          ...actorCols(dualFkForUser(session.subjectId, session.role)),
          action: "CREATE_TRIGGER",
          toValue: `${r.name} (${data.triggerEvent})`,
        },
      });
      return r;
    }
  );
  revalidatePath("/admin/triggers");
  return { id: row.id };
}

export async function createAutomation(input: z.infer<typeof createAutomationSchema>) {
  const session = await requireSession({ minRole: "ADMIN" });
  const data = createAutomationSchema.parse(input);
  const row = await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const r = await tx.rule.create({
        data: {
          tenantId: session.tenantId,
          kind: "AUTOMATION",
          name: data.name,
          description: data.description,
          intervalHours: data.intervalHours,
          conditions: data.conditions as Prisma.InputJsonValue,
          actions: data.actions as Prisma.InputJsonValue,
          active: data.active,
        },
      });
      await tx.auditLog.create({
        data: {
          tenantId: session.tenantId,
          ...actorCols(dualFkForUser(session.subjectId, session.role)),
          action: "CREATE_AUTOMATION",
          toValue: `${r.name} (every ${data.intervalHours}h)`,
        },
      });
      return r;
    }
  );
  revalidatePath("/admin/automations");
  return { id: row.id };
}

export async function updateRule(input: z.infer<typeof updateRuleSchema>) {
  const session = await requireSession({ minRole: "ADMIN" });
  const data = updateRuleSchema.parse(input);
  await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const existing = await tx.rule.findFirst({
        where: { id: data.id, tenantId: session.tenantId },
      });
      if (!existing) throw new Error("Rule not found.");
      await tx.rule.update({
        where: { id: data.id },
        data: {
          ...(data.name !== undefined && { name: data.name }),
          ...(data.description !== undefined && { description: data.description }),
          ...(data.triggerEvent !== undefined && existing.kind === "TRIGGER" && { triggerEvent: data.triggerEvent }),
          ...(data.intervalHours !== undefined && existing.kind === "AUTOMATION" && { intervalHours: data.intervalHours }),
          ...(data.conditions !== undefined && { conditions: data.conditions as Prisma.InputJsonValue }),
          ...(data.actions !== undefined && { actions: data.actions as Prisma.InputJsonValue }),
          ...(data.active !== undefined && { active: data.active }),
        },
      });
      await tx.auditLog.create({
        data: {
          tenantId: session.tenantId,
          ...actorCols(dualFkForUser(session.subjectId, session.role)),
          action: data.active === false ? "DEACTIVATE_RULE" : data.active === true ? "ACTIVATE_RULE" : "UPDATE_RULE",
          fromValue: existing.name,
          toValue: data.name ?? existing.name,
        },
      });
    }
  );
  revalidatePath("/admin/triggers");
  revalidatePath("/admin/automations");
  return { ok: true as const };
}

export async function deleteRule(id: string) {
  const session = await requireSession({ minRole: "ADMIN" });
  await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const existing = await tx.rule.findFirst({
        where: { id, tenantId: session.tenantId },
      });
      if (!existing) throw new Error("Rule not found.");
      await tx.rule.delete({ where: { id } });
      await tx.auditLog.create({
        data: {
          tenantId: session.tenantId,
          ...actorCols(dualFkForUser(session.subjectId, session.role)),
          action: existing.kind === "TRIGGER" ? "DELETE_TRIGGER" : "DELETE_AUTOMATION",
          fromValue: existing.name,
        },
      });
    }
  );
  revalidatePath("/admin/triggers");
  revalidatePath("/admin/automations");
  return { ok: true as const };
}

// ---------------------------------------------------------------------------
// Manual run (Z8.3) — until the Inngest cron ships, admins can fire an
// automation on demand from the editor. Reuses the engine's
// runAutomationOnce which is the same code path a future scheduler
// will call.
// ---------------------------------------------------------------------------

export async function runAutomationManually(ruleId: string) {
  const session = await requireSession({ minRole: "ADMIN" });
  const result = await runAutomationOnce({
    ruleId,
    session: { tenantId: session.tenantId, subjectId: session.subjectId, role: session.role },
  });
  await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      await tx.auditLog.create({
        data: {
          tenantId: session.tenantId,
          ...actorCols(dualFkForUser(session.subjectId, session.role)),
          action: "RUN_AUTOMATION_MANUAL",
          toValue: `${result.matched} matched, ${result.ranActionCount} actions, ${result.errors} errors`,
        },
      });
    }
  );
  revalidatePath("/admin/automations");
  return result;
}
