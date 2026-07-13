"use server";

// M11.1 — QA rubric CRUD. Gated on ADMIN+. Every mutation adds an
// AuditLog row so tenants can trace who changed the scoring bar.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withRls } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { rubricSchema, DEFAULT_RUBRIC, type Rubric } from "@/lib/ai/qa";
import { actorCols, dualFkForUser } from "@/lib/z1-dual-fk";

const upsertSchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().min(1).max(120),
  dimensions: rubricSchema,
  isActive: z.boolean(),
});

export type RubricDto = {
  id: string;
  name: string;
  dimensions: Rubric;
  isActive: boolean;
  updatedAt: string;
};

export async function listQaRubrics(): Promise<RubricDto[]> {
  const session = await requireSession({ minRole: "ADMIN" });
  return withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const rows = await tx.qaRubric.findMany({
        where: { tenantId: session.tenantId },
        orderBy: [{ isActive: "desc" }, { updatedAt: "desc" }],
      });
      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        dimensions: r.dimensions as Rubric,
        isActive: r.isActive,
        updatedAt: r.updatedAt.toISOString(),
      }));
    }
  );
}

export async function upsertQaRubric(input: z.infer<typeof upsertSchema>) {
  const session = await requireSession({ minRole: "ADMIN" });
  const data = upsertSchema.parse(input);

  return withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      // Only one active rubric at a time — activating a new one
      // deactivates any prior actives.
      if (data.isActive) {
        await tx.qaRubric.updateMany({
          where: { tenantId: session.tenantId, isActive: true, ...(data.id ? { NOT: { id: data.id } } : {}) },
          data: { isActive: false },
        });
      }
      const row = data.id
        ? await tx.qaRubric.update({
            where: { id: data.id },
            data: {
              name: data.name,
              dimensions: data.dimensions as never,
              isActive: data.isActive,
            },
          })
        : await tx.qaRubric.create({
            data: {
              tenantId: session.tenantId,
              name: data.name,
              dimensions: data.dimensions as never,
              isActive: data.isActive,
            },
          });
      const dual = dualFkForUser(session.subjectId, session.role);
      await tx.auditLog.create({
        data: {
          tenantId: session.tenantId,
          ...actorCols(dual),
          action: data.id ? "QA_RUBRIC_UPDATE" : "QA_RUBRIC_CREATE",
          toValue: row.name,
        },
      });
      revalidatePath("/admin/ai/qa/rubric");
      return { ok: true, id: row.id };
    }
  );
}

export async function seedDefaultRubric() {
  const session = await requireSession({ minRole: "ADMIN" });
  return withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const existing = await tx.qaRubric.findFirst({
        where: { tenantId: session.tenantId },
      });
      if (existing) return { ok: true, created: false };
      const row = await tx.qaRubric.create({
        data: {
          tenantId: session.tenantId,
          name: "Default rubric",
          dimensions: DEFAULT_RUBRIC as never,
          isActive: true,
        },
      });
      revalidatePath("/admin/ai/qa/rubric");
      return { ok: true, created: true, id: row.id };
    }
  );
}

export async function deleteQaRubric(id: string) {
  const session = await requireSession({ minRole: "ADMIN" });
  return withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const row = await tx.qaRubric.findFirst({
        where: { id, tenantId: session.tenantId },
      });
      if (!row) throw new Error("rubric not found");
      await tx.qaRubric.delete({ where: { id } });
      const dual = dualFkForUser(session.subjectId, session.role);
      await tx.auditLog.create({
        data: {
          tenantId: session.tenantId,
          ...actorCols(dual),
          action: "QA_RUBRIC_DELETE",
          fromValue: row.name,
        },
      });
      revalidatePath("/admin/ai/qa/rubric");
      return { ok: true };
    }
  );
}
