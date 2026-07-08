"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withRls } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { analyticsFilterSchema, type AnalyticsFilter } from "@/lib/validation/admin";

// M13.7 — saved reports CRUD. The filter blob is validated against the
// same AnalyticsFilter schema the /admin/analytics page uses, so a
// saved report never carries a shape the widgets can't render.

const createSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  filters: analyticsFilterSchema,
  recipientEmails: z.array(z.string().email()).max(20).default([]),
  scheduleCron: z.string().max(64).optional().nullable(),
});

const updateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(500).nullable().optional(),
  filters: analyticsFilterSchema.optional(),
  recipientEmails: z.array(z.string().email()).max(20).optional(),
  scheduleCron: z.string().max(64).nullable().optional(),
});

export type SavedReportRow = {
  id: string;
  name: string;
  description: string | null;
  filters: AnalyticsFilter;
  recipientEmails: string[];
  scheduleCron: string | null;
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
          scheduleCron: r.scheduleCron,
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
          scheduleCron: data.scheduleCron ?? null,
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
    (tx) =>
      tx.savedReport.update({
        where: { id: data.id },
        data: {
          ...(data.name !== undefined && { name: data.name }),
          ...(data.description !== undefined && { description: data.description }),
          ...(data.filters !== undefined && { filters: data.filters }),
          ...(data.recipientEmails !== undefined && { recipientEmails: data.recipientEmails }),
          ...(data.scheduleCron !== undefined && { scheduleCron: data.scheduleCron }),
        },
      })
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
  const end = filters.range === "custom" && filters.to ? new Date(filters.to) : new Date();
  end.setHours(23, 59, 59, 999);
  const days = filters.range === "7d" ? 7 : filters.range === "90d" ? 90 : 30;
  const start =
    filters.range === "custom" && filters.from
      ? new Date(filters.from)
      : new Date(end.getTime() - (days - 1) * 86_400_000);
  start.setHours(0, 0, 0, 0);

  const rows = await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    (tx) =>
      tx.ticket.findMany({
        where: {
          tenantId: session.tenantId,
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

  // Mark the run — an admin can see when they last exported this report.
  await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    (tx) =>
      tx.savedReport.update({
        where: { id: report.id },
        data: { lastRunAt: new Date() },
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
