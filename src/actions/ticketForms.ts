"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@/generated/prisma";
import { withRls } from "@/lib/db";
import { requireSession, type SessionUser } from "@/lib/auth";

// ---------------------------------------------------------------------------
// Z2.3 — Ticket Forms server actions
//
// A form curates an ordered list of TICKET-scoped custom fields and pins
// itself to zero or more categories. When the client portal picks a
// category, we look for a form pinned to it; if exactly one matches we
// use it, if none match no custom fields render, if multiple match we
// pick the earliest-position active one (deterministic — not a picker).
// ---------------------------------------------------------------------------

const createFormSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).nullable().optional(),
});

const updateFormSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(500).nullable().optional(),
  isActive: z.boolean().optional(),
  position: z.number().int().min(0).optional(),
});

const addFieldSchema = z.object({
  ticketFormId: z.string().min(1),
  fieldDefinitionId: z.string().min(1),
  position: z.number().int().min(0).optional(),
  isRequiredOverride: z.boolean().nullable().optional(),
});

const updateFormFieldSchema = z.object({
  id: z.string().min(1),
  position: z.number().int().min(0).optional(),
  isRequiredOverride: z.boolean().nullable().optional(),
  // Z2.4 conditional visibility — both must be set together or both cleared.
  visibleWhenFieldId: z.string().nullable().optional(),
  visibleWhenValue: z.string().nullable().optional(),
});

const setCategoriesSchema = z.object({
  ticketFormId: z.string().min(1),
  categoryIds: z.array(z.string()),
});

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listTicketForms() {
  const session = await requireSession({ minRole: "AGENT" });
  return withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    (tx) =>
      tx.ticketForm.findMany({
        where: { tenantId: session.tenantId },
        orderBy: [{ isActive: "desc" }, { position: "asc" }, { createdAt: "asc" }],
        include: {
          _count: { select: { fields: true, categories: true } },
        },
      })
  );
}

export async function getTicketFormFull(id: string) {
  const session = await requireSession({ minRole: "AGENT" });
  return withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const form = await tx.ticketForm.findFirst({
        where: { id, tenantId: session.tenantId },
        include: {
          fields: {
            orderBy: [{ position: "asc" }],
            include: {
              fieldDefinition: {
                include: {
                  options: {
                    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
                    select: { id: true, value: true, label: true },
                  },
                },
              },
            },
          },
          categories: { select: { categoryId: true } },
        },
      });
      return form;
    }
  );
}

/**
 * Portal helper: given a Category id, resolve the ticket form that should
 * render for it. Returns null when no form pins the category (client just
 * gets the built-in fields). Deterministic tie-break: lowest `position`
 * among matching active forms.
 */
export async function resolveTicketFormForCategory(
  categoryId: string
): Promise<{
  id: string;
  name: string;
  fields: Array<{
    id: string;
    position: number;
    isRequiredOverride: boolean | null;
    visibleWhenFieldId: string | null;
    visibleWhenValue: string | null;
    definition: {
      id: string;
      key: string;
      label: string;
      type: string;
      isRequired: boolean;
      description: string | null;
      options: Array<{ id: string; value: string; label: string }>;
    };
  }>;
} | null> {
  const session: SessionUser = await requireSession();
  return withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const match = await tx.ticketFormCategory.findFirst({
        where: { tenantId: session.tenantId, categoryId, ticketForm: { isActive: true } },
        orderBy: [{ ticketForm: { position: "asc" } }],
        select: { ticketFormId: true },
      });
      if (!match) return null;
      const form = await tx.ticketForm.findFirst({
        where: { id: match.ticketFormId, tenantId: session.tenantId, isActive: true },
        include: {
          fields: {
            orderBy: [{ position: "asc" }],
            include: {
              fieldDefinition: {
                include: {
                  options: {
                    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
                    select: { id: true, value: true, label: true },
                  },
                },
              },
            },
          },
        },
      });
      if (!form) return null;
      return {
        id: form.id,
        name: form.name,
        fields: form.fields
          .filter((f) => f.fieldDefinition.isActive && f.fieldDefinition.scope === "TICKET")
          .map((f) => ({
            id: f.id,
            position: f.position,
            isRequiredOverride: f.isRequiredOverride,
            visibleWhenFieldId: f.visibleWhenFieldId,
            visibleWhenValue: f.visibleWhenValue,
            definition: {
              id: f.fieldDefinition.id,
              key: f.fieldDefinition.key,
              label: f.fieldDefinition.label,
              type: f.fieldDefinition.type,
              isRequired: f.fieldDefinition.isRequired,
              description: f.fieldDefinition.description,
              options: f.fieldDefinition.options,
            },
          })),
      };
    }
  );
}

// ---------------------------------------------------------------------------
// Writes (ADMIN gate)
// ---------------------------------------------------------------------------

export async function createTicketForm(input: z.infer<typeof createFormSchema>) {
  const session = await requireSession({ minRole: "ADMIN" });
  const data = createFormSchema.parse(input);
  const created = await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    (tx) =>
      tx.ticketForm.create({
        data: {
          tenantId: session.tenantId,
          name: data.name,
          description: data.description ?? null,
        },
      })
  );
  revalidatePath("/admin/forms");
  return { ok: true as const, form: created };
}

export async function updateTicketForm(input: z.infer<typeof updateFormSchema>) {
  const session = await requireSession({ minRole: "ADMIN" });
  const data = updateFormSchema.parse(input);
  const updated = await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const existing = await tx.ticketForm.findFirst({
        where: { id: data.id, tenantId: session.tenantId },
        select: { id: true },
      });
      if (!existing) throw new Error("NOT_FOUND");
      return tx.ticketForm.update({
        where: { id: data.id },
        data: {
          ...(data.name !== undefined ? { name: data.name } : {}),
          ...(data.description !== undefined ? { description: data.description } : {}),
          ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
          ...(data.position !== undefined ? { position: data.position } : {}),
        },
      });
    }
  );
  revalidatePath("/admin/forms");
  return { ok: true as const, form: updated };
}

export async function addFieldToForm(input: z.infer<typeof addFieldSchema>) {
  const session = await requireSession({ minRole: "ADMIN" });
  const data = addFieldSchema.parse(input);
  try {
    const created = await withRls(
      { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
      async (tx) => {
        // Ensure the definition is TICKET-scoped — USER/ORG defs can't go on
        // a ticket form.
        const def = await tx.customFieldDefinition.findFirst({
          where: { id: data.fieldDefinitionId, tenantId: session.tenantId },
          select: { scope: true },
        });
        if (!def) throw new Error("NOT_FOUND");
        if (def.scope !== "TICKET")
          throw new Error("WRONG_SCOPE: only TICKET-scoped fields can be added to a ticket form");

        return tx.ticketFormField.create({
          data: {
            tenantId: session.tenantId,
            ticketFormId: data.ticketFormId,
            fieldDefinitionId: data.fieldDefinitionId,
            position: data.position ?? 0,
            isRequiredOverride: data.isRequiredOverride ?? null,
          },
        });
      }
    );
    revalidatePath("/admin/forms");
    return { ok: true as const, formField: created };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return { ok: false as const, error: "That field is already on this form." };
    }
    if (err instanceof Error && err.message.startsWith("WRONG_SCOPE")) {
      return { ok: false as const, error: err.message.split(": ").slice(1).join(": ") };
    }
    throw err;
  }
}

export async function removeFieldFromForm(id: string) {
  const session = await requireSession({ minRole: "ADMIN" });
  await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const existing = await tx.ticketFormField.findFirst({
        where: { id, tenantId: session.tenantId },
        select: { id: true },
      });
      if (!existing) throw new Error("NOT_FOUND");
      await tx.ticketFormField.delete({ where: { id } });
    }
  );
  revalidatePath("/admin/forms");
  return { ok: true as const };
}

export async function updateFormField(input: z.infer<typeof updateFormFieldSchema>) {
  const session = await requireSession({ minRole: "ADMIN" });
  const data = updateFormFieldSchema.parse(input);
  await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const existing = await tx.ticketFormField.findFirst({
        where: { id: data.id, tenantId: session.tenantId },
        select: { id: true, ticketFormId: true },
      });
      if (!existing) throw new Error("NOT_FOUND");
      // If a conditional-visibility field id is passed, validate it belongs
      // to the same form. Prevents pointing at a stray field from another
      // form (or another tenant — RLS covers that too).
      if (data.visibleWhenFieldId) {
        const sibling = await tx.ticketFormField.findFirst({
          where: {
            id: data.visibleWhenFieldId,
            ticketFormId: existing.ticketFormId,
            tenantId: session.tenantId,
          },
          select: { id: true },
        });
        if (!sibling) throw new Error("VISIBLE_WHEN_NOT_A_SIBLING");
      }
      await tx.ticketFormField.update({
        where: { id: data.id },
        data: {
          ...(data.position !== undefined ? { position: data.position } : {}),
          ...(data.isRequiredOverride !== undefined
            ? { isRequiredOverride: data.isRequiredOverride }
            : {}),
          ...(data.visibleWhenFieldId !== undefined
            ? { visibleWhenFieldId: data.visibleWhenFieldId }
            : {}),
          ...(data.visibleWhenValue !== undefined
            ? { visibleWhenValue: data.visibleWhenValue }
            : {}),
        },
      });
    }
  );
  revalidatePath("/admin/forms");
  return { ok: true as const };
}

export async function setFormCategories(input: z.infer<typeof setCategoriesSchema>) {
  const session = await requireSession({ minRole: "ADMIN" });
  const data = setCategoriesSchema.parse(input);
  await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const form = await tx.ticketForm.findFirst({
        where: { id: data.ticketFormId, tenantId: session.tenantId },
        select: { id: true },
      });
      if (!form) throw new Error("NOT_FOUND");
      // Naive replace: delete existing links, then insert the new set. Small
      // scale (a handful of categories per form) — no need for a diff.
      await tx.ticketFormCategory.deleteMany({
        where: { ticketFormId: data.ticketFormId, tenantId: session.tenantId },
      });
      if (data.categoryIds.length > 0) {
        await tx.ticketFormCategory.createMany({
          data: data.categoryIds.map((cid) => ({
            ticketFormId: data.ticketFormId,
            categoryId: cid,
            tenantId: session.tenantId,
          })),
          skipDuplicates: true,
        });
      }
    }
  );
  revalidatePath("/admin/forms");
  return { ok: true as const };
}
