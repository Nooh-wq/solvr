"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withRls } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { analyticsFilterSchema, type AnalyticsFilter } from "@/lib/validation/admin";
import { computeNextRunAt } from "@/lib/report-schedule";
import { rebuildRollupFor } from "@/lib/inngest/functions/build-ticket-rollup";
import type { SavedReportFrequency } from "@/generated/prisma";

// M13.7 — saved reports CRUD. The filter blob is validated against the
// same AnalyticsFilter schema the /admin/analytics page uses, so a
// saved report never carries a shape the widgets can't render.

const frequencySchema = z.enum(["NONE", "DAILY", "WEEKLY", "MONTHLY"]);

const createSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  filters: analyticsFilterSchema,
  recipientEmails: z.array(z.string().email()).max(20).default([]),
  scheduleFrequency: frequencySchema.default("NONE"),
  scheduleHour: z.number().int().min(0).max(23).default(9),
});

const updateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(500).nullable().optional(),
  filters: analyticsFilterSchema.optional(),
  recipientEmails: z.array(z.string().email()).max(20).optional(),
  scheduleFrequency: frequencySchema.optional(),
  scheduleHour: z.number().int().min(0).max(23).optional(),
});

export type SavedReportRow = {
  id: string;
  name: string;
  description: string | null;
  filters: AnalyticsFilter;
  recipientEmails: string[];
  scheduleFrequency: SavedReportFrequency;
  scheduleHour: number;
  nextRunAt: Date | null;
  lastRunAt: Date | null;
  createdAt: Date;
};

export async function listSavedReports(): Promise<SavedReportRow[]> {
  const session = await requireSession({ minRole: "ADMIN" });
  return withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const rows = await tx.savedReport.findMany({
        where: { tenantId: session.tenantId },
        orderBy: { createdAt: "desc" },
      });
      return rows.map((r) => {
        const filters = analyticsFilterSchema.safeParse(r.filters);
        return {
          id: r.id,
          name: r.name,
          description: r.description,
          filters: filters.success ? filters.data : ({ range: "30d" } as AnalyticsFilter),
          recipientEmails: r.recipientEmails,
          scheduleFrequency: r.scheduleFrequency,
          scheduleHour: r.scheduleHour,
          nextRunAt: r.nextRunAt,
          lastRunAt: r.lastRunAt,
          createdAt: r.createdAt,
        };
      });
    }
  );
}

export async function createSavedReport(input: z.infer<typeof createSchema>) {
  const session = await requireSession({ minRole: "ADMIN" });
  const data = createSchema.parse(input);
  const nextRunAt = computeNextRunAt(data.scheduleFrequency, data.scheduleHour, null);
  const created = await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    (tx) =>
      tx.savedReport.create({
        data: {
          tenantId: session.tenantId,
          name: data.name,
          description: data.description ?? null,
          filters: data.filters,
          recipientEmails: data.recipientEmails,
          scheduleFrequency: data.scheduleFrequency,
          scheduleHour: data.scheduleHour,
          nextRunAt,
          createdByTeamMemberId: session.subjectId,
        },
      })
  );
  revalidatePath("/admin/reports");
  return { id: created.id };
}

export async function updateSavedReport(input: z.infer<typeof updateSchema>) {
  const session = await requireSession({ minRole: "ADMIN" });
  const data = updateSchema.parse(input);
  await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const existing = await tx.savedReport.findFirst({
        where: { id: data.id, tenantId: session.tenantId },
      });
      if (!existing) throw new Error("Report not found.");
      const frequency = data.scheduleFrequency ?? existing.scheduleFrequency;
      const hour = data.scheduleHour ?? existing.scheduleHour;
      // Only recompute nextRunAt if the schedule actually changed —
      // this preserves an in-flight cadence when an admin renames the
      // report or edits its filter.
      const scheduleChanged =
        data.scheduleFrequency !== undefined || data.scheduleHour !== undefined;
      const nextRunAt = scheduleChanged
        ? computeNextRunAt(frequency, hour, null)
        : existing.nextRunAt;
      await tx.savedReport.update({
        where: { id: data.id },
        data: {
          ...(data.name !== undefined && { name: data.name }),
          ...(data.description !== undefined && { description: data.description }),
          ...(data.filters !== undefined && { filters: data.filters }),
          ...(data.recipientEmails !== undefined && { recipientEmails: data.recipientEmails }),
          ...(data.scheduleFrequency !== undefined && { scheduleFrequency: data.scheduleFrequency }),
          ...(data.scheduleHour !== undefined && { scheduleHour: data.scheduleHour }),
          nextRunAt,
        },
      });
    }
  );
  revalidatePath("/admin/reports");
  return { ok: true };
}

export async function deleteSavedReport(input: { id: string }) {
  const session = await requireSession({ minRole: "ADMIN" });
  await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    (tx) => tx.savedReport.delete({ where: { id: input.id } })
  );
  revalidatePath("/admin/reports");
  return { ok: true };
}

// M13.7 — one-shot CSV export. Runs the report's filter through the
// same widget-scoped ticket query and returns a CSV string. Callers
// (an admin clicking "Export CSV") stream this to a downloadable
// blob on the client.
export async function exportSavedReportCsv(input: { id: string }): Promise<string> {
  const session = await requireSession({ minRole: "ADMIN" });
  const report = await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    (tx) => tx.savedReport.findFirst({ where: { id: input.id, tenantId: session.tenantId } })
  );
  if (!report) throw new Error("Report not found.");
  const filters = analyticsFilterSchema.parse(report.filters);
  const csv = await renderReportCsv(session.tenantId, filters);

  // Mark the run — an admin can see when they last exported this report.
  await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    (tx) =>
      tx.savedReport.update({
        where: { id: report.id },
        data: { lastRunAt: new Date() },
      })
  );
  return csv;
}

// Extracted so the scheduled dispatcher (Inngest cron) can reuse the
// exact CSV shape without re-implementing the filter → rows path.
export async function renderReportCsv(tenantId: string, filters: AnalyticsFilter): Promise<string> {
  const end = filters.range === "custom" && filters.to ? new Date(filters.to) : new Date();
  end.setHours(23, 59, 59, 999);
  const days = filters.range === "7d" ? 7 : filters.range === "90d" ? 90 : 30;
  const start =
    filters.range === "custom" && filters.from
      ? new Date(filters.from)
      : new Date(end.getTime() - (days - 1) * 86_400_000);
  start.setHours(0, 0, 0, 0);

  const rows = await withRls(
    { tenantId, userId: null, role: "SUPER_ADMIN" },
    (tx) =>
      tx.ticket.findMany({
        where: {
          tenantId,
          createdAt: { gte: start, lte: end },
          ...(filters.channel && { source: filters.channel }),
          ...(filters.categoryId && { categoryId: filters.categoryId }),
          ...(filters.priority && { priority: filters.priority }),
          ...(filters.organizationId && { organizationId: filters.organizationId }),
          ...(filters.assignedToId
            ? filters.assignedToId === "unassigned"
              ? { assignedTeamMemberId: null }
              : { assignedTeamMemberId: filters.assignedToId }
            : {}),
        },
        // 10k row cap — spec §3 "Do NOT let the custom report builder
        // run unbounded queries."
        take: 10_000,
        orderBy: { createdAt: "asc" },
        select: {
          reference: true,
          title: true,
          status: true,
          priority: true,
          createdAt: true,
          firstReplyAt: true,
          resolvedAt: true,
          source: true,
        },
      })
  );

  const header = ["reference", "title", "status", "priority", "createdAt", "firstReplyAt", "resolvedAt", "source"];
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.reference,
        csvEscape(r.title),
        r.status,
        r.priority,
        r.createdAt.toISOString(),
        r.firstReplyAt?.toISOString() ?? "",
        r.resolvedAt?.toISOString() ?? "",
        r.source,
      ].join(",")
    );
  }
  return lines.join("\n");
}

function csvEscape(s: string): string {
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

// M13 gap 3 — admin-triggered backfill for the daily rollup table.
// Runs on-demand from /admin/reports. Walks backwards from yesterday
// for `daysBack` days, upserting one row per (tenantId, date). Cheap:
// even 90 days is 90 groupBy-like scans, and the smoke-test suite
// covers correctness.
export async function backfillTicketRollup(input: { daysBack?: number } = {}): Promise<{ days: number }> {
  const session = await requireSession({ minRole: "ADMIN" });
  const daysBack = Math.max(1, Math.min(365, input.daysBack ?? 90));
  const cursor = new Date();
  cursor.setUTCHours(0, 0, 0, 0);
  cursor.setUTCDate(cursor.getUTCDate() - 1);
  for (let i = 0; i < daysBack; i++) {
    const start = new Date(cursor);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 1);
    await rebuildRollupFor(session.tenantId, start, end);
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  revalidatePath("/admin/analytics");
  revalidatePath("/admin/reports");
  return { days: daysBack };
}
