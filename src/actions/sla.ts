"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@/generated/prisma";
import { withRls } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { actorCols, dualFkForUser } from "@/lib/z1-dual-fk";
import {
  createSlaPolicySchema,
  updateSlaPolicySchema,
  createBusinessCalendarSchema,
  updateBusinessCalendarSchema,
  DEFAULT_SLA_TARGETS,
  DEFAULT_WEEKLY_HOURS,
  type SlaTargets,
  type WeeklyHours,
} from "@/lib/sla-schema";

// M2 — SLA policy + business calendar CRUD. Admin-only. Every mutation
// writes to AuditLog. Only-one-default invariant enforced app-side (a
// tx guard rather than a partial unique index because the "default"
// flag applies to per-tenant, per-kind (policy vs calendar) rows and a
// composite unique index against a nullable would be brittle).

// ---------------------------------------------------------------------------
// SLA policies
// ---------------------------------------------------------------------------

export type SlaPolicyRow = {
  id: string;
  name: string;
  description: string | null;
  targets: SlaTargets;
  isDefault: boolean;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
};

function normalizePolicy(r: {
  id: string;
  name: string;
  description: string | null;
  targets: Prisma.JsonValue;
  isDefault: boolean;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}): SlaPolicyRow {
  return { ...r, targets: (r.targets as unknown as SlaTargets) ?? DEFAULT_SLA_TARGETS };
}

export async function listSlaPolicies(): Promise<SlaPolicyRow[]> {
  const session = await requireSession({ minRole: "ADMIN" });
  const rows = await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    (tx) =>
      tx.slaPolicy.findMany({
        where: { tenantId: session.tenantId },
        orderBy: [{ isDefault: "desc" }, { name: "asc" }],
      })
  );
  return rows.map(normalizePolicy);
}

async function clearOtherDefaultPolicies(tx: Prisma.TransactionClient, tenantId: string, exceptId?: string) {
  await tx.slaPolicy.updateMany({
    where: { tenantId, isDefault: true, ...(exceptId && { id: { not: exceptId } }) },
    data: { isDefault: false },
  });
}

export async function createSlaPolicy(input: z.infer<typeof createSlaPolicySchema>) {
  const session = await requireSession({ minRole: "ADMIN" });
  const data = createSlaPolicySchema.parse(input);
  const row = await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      if (data.isDefault) await clearOtherDefaultPolicies(tx, session.tenantId);
      const r = await tx.slaPolicy.create({
        data: {
          tenantId: session.tenantId,
          name: data.name,
          description: data.description,
          targets: data.targets as Prisma.InputJsonValue,
          isDefault: data.isDefault,
          active: data.active,
        },
      });
      await tx.auditLog.create({
        data: {
          tenantId: session.tenantId,
          ...actorCols(dualFkForUser(session.subjectId, session.role)),
          action: "CREATE_SLA_POLICY",
          toValue: `${r.name}${r.isDefault ? " (default)" : ""}`,
        },
      });
      return r;
    }
  );
  revalidatePath("/admin/sla-policies");
  return { id: row.id };
}

export async function updateSlaPolicy(input: z.infer<typeof updateSlaPolicySchema>) {
  const session = await requireSession({ minRole: "ADMIN" });
  const data = updateSlaPolicySchema.parse(input);
  await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const existing = await tx.slaPolicy.findFirst({
        where: { id: data.id, tenantId: session.tenantId },
      });
      if (!existing) throw new Error("Policy not found.");
      if (data.isDefault === true) await clearOtherDefaultPolicies(tx, session.tenantId, data.id);
      await tx.slaPolicy.update({
        where: { id: data.id },
        data: {
          ...(data.name !== undefined && { name: data.name }),
          ...(data.description !== undefined && { description: data.description }),
          ...(data.targets !== undefined && { targets: data.targets as Prisma.InputJsonValue }),
          ...(data.isDefault !== undefined && { isDefault: data.isDefault }),
          ...(data.active !== undefined && { active: data.active }),
        },
      });
      await tx.auditLog.create({
        data: {
          tenantId: session.tenantId,
          ...actorCols(dualFkForUser(session.subjectId, session.role)),
          action: "UPDATE_SLA_POLICY",
          fromValue: existing.name,
          toValue: data.name ?? existing.name,
        },
      });
    }
  );
  revalidatePath("/admin/sla-policies");
  return { ok: true as const };
}

export async function deleteSlaPolicy(id: string) {
  const session = await requireSession({ minRole: "ADMIN" });
  await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const existing = await tx.slaPolicy.findFirst({
        where: { id, tenantId: session.tenantId },
      });
      if (!existing) throw new Error("Policy not found.");
      // Blocking delete rather than cascade: existing TicketSla rows
      // FK-reference this policy. Refuse if any are in flight so a
      // hasty delete can't orphan live SLA state.
      const attached = await tx.ticketSla.count({ where: { slaPolicyId: id, tenantId: session.tenantId } });
      if (attached > 0) {
        throw new Error(`Cannot delete — ${attached} tickets currently use this policy.`);
      }
      await tx.slaPolicy.delete({ where: { id } });
      await tx.auditLog.create({
        data: {
          tenantId: session.tenantId,
          ...actorCols(dualFkForUser(session.subjectId, session.role)),
          action: "DELETE_SLA_POLICY",
          fromValue: existing.name,
        },
      });
    }
  );
  revalidatePath("/admin/sla-policies");
  return { ok: true as const };
}

// ---------------------------------------------------------------------------
// Business calendars
// ---------------------------------------------------------------------------

export type BusinessCalendarRow = {
  id: string;
  name: string;
  timezone: string;
  weeklyHours: WeeklyHours;
  holidays: string[];
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
};

function normalizeCalendar(r: {
  id: string;
  name: string;
  timezone: string;
  weeklyHours: Prisma.JsonValue;
  holidays: Prisma.JsonValue;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}): BusinessCalendarRow {
  return {
    ...r,
    weeklyHours: (r.weeklyHours as unknown as WeeklyHours) ?? DEFAULT_WEEKLY_HOURS,
    holidays: (r.holidays as unknown as string[]) ?? [],
  };
}

export async function listBusinessCalendars(): Promise<BusinessCalendarRow[]> {
  const session = await requireSession({ minRole: "ADMIN" });
  const rows = await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    (tx) =>
      tx.businessCalendar.findMany({
        where: { tenantId: session.tenantId },
        orderBy: [{ isDefault: "desc" }, { name: "asc" }],
      })
  );
  return rows.map(normalizeCalendar);
}

async function clearOtherDefaultCalendars(tx: Prisma.TransactionClient, tenantId: string, exceptId?: string) {
  await tx.businessCalendar.updateMany({
    where: { tenantId, isDefault: true, ...(exceptId && { id: { not: exceptId } }) },
    data: { isDefault: false },
  });
}

export async function createBusinessCalendar(input: z.infer<typeof createBusinessCalendarSchema>) {
  const session = await requireSession({ minRole: "ADMIN" });
  const data = createBusinessCalendarSchema.parse(input);
  const row = await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      if (data.isDefault) await clearOtherDefaultCalendars(tx, session.tenantId);
      const r = await tx.businessCalendar.create({
        data: {
          tenantId: session.tenantId,
          name: data.name,
          timezone: data.timezone,
          weeklyHours: data.weeklyHours as Prisma.InputJsonValue,
          holidays: (data.holidays ?? []) as Prisma.InputJsonValue,
          isDefault: data.isDefault,
        },
      });
      await tx.auditLog.create({
        data: {
          tenantId: session.tenantId,
          ...actorCols(dualFkForUser(session.subjectId, session.role)),
          action: "CREATE_BUSINESS_CALENDAR",
          toValue: `${r.name} (${r.timezone})${r.isDefault ? " default" : ""}`,
        },
      });
      return r;
    }
  );
  revalidatePath("/admin/business-calendars");
  return { id: row.id };
}

export async function updateBusinessCalendar(input: z.infer<typeof updateBusinessCalendarSchema>) {
  const session = await requireSession({ minRole: "ADMIN" });
  const data = updateBusinessCalendarSchema.parse(input);
  await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const existing = await tx.businessCalendar.findFirst({
        where: { id: data.id, tenantId: session.tenantId },
      });
      if (!existing) throw new Error("Calendar not found.");
      if (data.isDefault === true) await clearOtherDefaultCalendars(tx, session.tenantId, data.id);
      await tx.businessCalendar.update({
        where: { id: data.id },
        data: {
          ...(data.name !== undefined && { name: data.name }),
          ...(data.timezone !== undefined && { timezone: data.timezone }),
          ...(data.weeklyHours !== undefined && { weeklyHours: data.weeklyHours as Prisma.InputJsonValue }),
          ...(data.holidays !== undefined && { holidays: data.holidays as Prisma.InputJsonValue }),
          ...(data.isDefault !== undefined && { isDefault: data.isDefault }),
        },
      });
      await tx.auditLog.create({
        data: {
          tenantId: session.tenantId,
          ...actorCols(dualFkForUser(session.subjectId, session.role)),
          action: "UPDATE_BUSINESS_CALENDAR",
          fromValue: existing.name,
          toValue: data.name ?? existing.name,
        },
      });
    }
  );
  revalidatePath("/admin/business-calendars");
  return { ok: true as const };
}

export async function deleteBusinessCalendar(id: string) {
  const session = await requireSession({ minRole: "ADMIN" });
  await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const existing = await tx.businessCalendar.findFirst({
        where: { id, tenantId: session.tenantId },
      });
      if (!existing) throw new Error("Calendar not found.");
      await tx.businessCalendar.delete({ where: { id } });
      await tx.auditLog.create({
        data: {
          tenantId: session.tenantId,
          ...actorCols(dualFkForUser(session.subjectId, session.role)),
          action: "DELETE_BUSINESS_CALENDAR",
          fromValue: existing.name,
        },
      });
    }
  );
  revalidatePath("/admin/business-calendars");
  return { ok: true as const };
}

// ---------------------------------------------------------------------------
// Read TicketSla for one ticket (used by ticket-detail countdown)
// ---------------------------------------------------------------------------

export type TicketSlaRow = {
  kind: "FIRST_RESPONSE" | "RESOLUTION";
  targetMins: number;
  dueAt: string; // ISO
  pausedMs: number;
  pauseStartedAt: string | null;
  warnedAt: string | null;
  breachedAt: string | null;
  satisfiedAt: string | null;
};

export async function getSlaForTicket(ticketId: string): Promise<TicketSlaRow[]> {
  const session = await requireSession({ minRole: "AGENT" });
  const rows = await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    (tx) =>
      tx.ticketSla.findMany({
        where: { ticketId, tenantId: session.tenantId },
        orderBy: { kind: "asc" },
      })
  );
  return rows.map((r) => ({
    kind: r.kind,
    targetMins: r.targetMins,
    dueAt: r.dueAt.toISOString(),
    pausedMs: r.pausedMs,
    pauseStartedAt: r.pauseStartedAt?.toISOString() ?? null,
    warnedAt: r.warnedAt?.toISOString() ?? null,
    breachedAt: r.breachedAt?.toISOString() ?? null,
    satisfiedAt: r.satisfiedAt?.toISOString() ?? null,
  }));
}

/** Batch-read TicketSla for the queue view. Keyed by ticketId. */
export async function getSlaForTickets(ticketIds: string[]): Promise<Record<string, TicketSlaRow[]>> {
  if (ticketIds.length === 0) return {};
  const session = await requireSession({ minRole: "AGENT" });
  const rows = await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    (tx) =>
      tx.ticketSla.findMany({
        where: { ticketId: { in: ticketIds }, tenantId: session.tenantId },
      })
  );
  const grouped: Record<string, TicketSlaRow[]> = {};
  for (const r of rows) {
    (grouped[r.ticketId] ??= []).push({
      kind: r.kind,
      targetMins: r.targetMins,
      dueAt: r.dueAt.toISOString(),
      pausedMs: r.pausedMs,
      pauseStartedAt: r.pauseStartedAt?.toISOString() ?? null,
      warnedAt: r.warnedAt?.toISOString() ?? null,
      breachedAt: r.breachedAt?.toISOString() ?? null,
      satisfiedAt: r.satisfiedAt?.toISOString() ?? null,
    });
  }
  return grouped;
}
