"use server";

// Phase 4d — Prompt library CRUD. Server actions on top of PromptTemplate.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { withRls } from "@/lib/db";

const PATH = "/admin/ai/prompts";

const variableSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]*$/i, "Variable keys must be alphanumeric."),
  label: z.string().min(1).max(80),
  defaultValue: z.string().max(500).optional(),
});

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().max(500).optional().nullable(),
  body: z.string().min(1).max(4000),
  variables: z.array(variableSchema).max(20).default([]),
});

const updateSchema = createSchema.extend({ id: z.string().min(1) });

export type PromptRow = {
  id: string;
  name: string;
  description: string | null;
  body: string;
  variables: Array<{ key: string; label: string; defaultValue?: string }>;
  createdAt: Date;
  updatedAt: Date;
};

export async function listPrompts(): Promise<PromptRow[]> {
  const session = await requireSession({ minRole: "ADMIN" });
  const rows = await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    (tx) =>
      tx.promptTemplate.findMany({
        where: { tenantId: session.tenantId },
        orderBy: { updatedAt: "desc" },
      })
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    body: r.body,
    variables: Array.isArray(r.variables) ? (r.variables as PromptRow["variables"]) : [],
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }));
}

export async function createPrompt(
  input: z.infer<typeof createSchema>
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const session = await requireSession({ minRole: "ADMIN" });
  try {
    await withRls(
      { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
      (tx) =>
        tx.promptTemplate.create({
          data: {
            tenantId: session.tenantId,
            name: parsed.data.name,
            description: parsed.data.description ?? null,
            body: parsed.data.body,
            variables: parsed.data.variables,
            createdByTeamMemberId: session.subjectId,
          },
        })
    );
  } catch (e) {
    if (e instanceof Error && e.message.includes("Unique")) {
      return { ok: false, error: "A prompt with that name already exists." };
    }
    throw e;
  }
  revalidatePath(PATH);
  return { ok: true };
}

export async function updatePrompt(
  input: z.infer<typeof updateSchema>
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const session = await requireSession({ minRole: "ADMIN" });
  await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    (tx) =>
      tx.promptTemplate.updateMany({
        where: { id: parsed.data.id, tenantId: session.tenantId },
        data: {
          name: parsed.data.name,
          description: parsed.data.description ?? null,
          body: parsed.data.body,
          variables: parsed.data.variables,
        },
      })
  );
  revalidatePath(PATH);
  return { ok: true };
}

export async function deletePrompt(id: string) {
  const session = await requireSession({ minRole: "ADMIN" });
  await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    (tx) => tx.promptTemplate.deleteMany({ where: { id, tenantId: session.tenantId } })
  );
  revalidatePath(PATH);
  return { ok: true as const };
}
