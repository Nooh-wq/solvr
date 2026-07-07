"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@/generated/prisma";
import type { CustomFieldScope, CustomFieldType } from "@/generated/prisma";
import { withRls } from "@/lib/db";
import { requireSession } from "@/lib/auth";

// ---------------------------------------------------------------------------
// Z2.1 — Custom Fields server actions
//
// Staff-only across the board: end users must not see or edit custom field
// definitions OR values (Z2 spec §3, enforced server-side, not just UI).
// Reads on a Ticket sidebar are staff-only in this pass — a later Enterprise
// tier will decide whether specific fields are end-user-visible.
// ---------------------------------------------------------------------------

const SCOPES = ["USER", "ORG", "TICKET"] as const;
const TYPES = ["TEXT", "NUMBER", "DATE", "CHECKBOX"] as const;

// Lowercase snake_case, must start with a letter. Explicit anchors so an
// input like "foo bar" doesn't sneak through by matching a substring.
const KEY_RE = /^[a-z][a-z0-9_]*$/;

const createDefinitionSchema = z.object({
  scope: z.enum(SCOPES),
  type: z.enum(TYPES),
  key: z
    .string()
    .min(1)
    .max(64)
    .regex(KEY_RE, "Key must be lowercase snake_case and start with a letter."),
  label: z.string().min(1).max(120),
  description: z.string().max(500).optional().nullable(),
  isRequired: z.boolean().optional(),
  position: z.number().int().min(0).optional(),
});

const updateDefinitionSchema = z.object({
  id: z.string().min(1),
  // key is deliberately absent — immutable after create (Z2 spec §3).
  label: z.string().min(1).max(120).optional(),
  description: z.string().max(500).nullable().optional(),
  isRequired: z.boolean().optional(),
  position: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
});

/**
 * Anyone with staff rights can manage definitions in this pass. Once the
 * role-permission JSON (Role.permissions) is actually consumed, gate this
 * on `manageUserFields` / `manageOrgFields` / `manageTicketFields` per scope.
 */
export async function listDefinitions(scope: CustomFieldScope) {
  const session = await requireSession({ minRole: "AGENT" });
  return withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    (tx) =>
      tx.customFieldDefinition.findMany({
        where: { tenantId: session.tenantId, scope },
        orderBy: [{ isActive: "desc" }, { position: "asc" }, { createdAt: "asc" }],
      })
  );
}

export async function createDefinition(input: z.infer<typeof createDefinitionSchema>) {
  const session = await requireSession({ minRole: "ADMIN" });
  const data = createDefinitionSchema.parse(input);

  try {
    const created = await withRls(
      { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
      (tx) =>
        tx.customFieldDefinition.create({
          data: {
            tenantId: session.tenantId,
            scope: data.scope,
            type: data.type,
            key: data.key,
            label: data.label,
            description: data.description ?? null,
            isRequired: data.isRequired ?? false,
            position: data.position ?? 0,
          },
        })
    );
    revalidatePath("/admin/fields");
    return { ok: true as const, definition: created };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return { ok: false as const, error: `A ${data.scope.toLowerCase()} field with key "${data.key}" already exists.` };
    }
    throw err;
  }
}

export async function updateDefinition(input: z.infer<typeof updateDefinitionSchema>) {
  const session = await requireSession({ minRole: "ADMIN" });
  const data = updateDefinitionSchema.parse(input);

  const updated = await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      // Tenant scope check — RLS also enforces it, but the app-layer check
      // gives a clean "not found" instead of a Prisma record-not-found error.
      const existing = await tx.customFieldDefinition.findFirst({
        where: { id: data.id, tenantId: session.tenantId },
        select: { id: true },
      });
      if (!existing) throw new Error("NOT_FOUND");
      return tx.customFieldDefinition.update({
        where: { id: data.id },
        data: {
          ...(data.label !== undefined ? { label: data.label } : {}),
          ...(data.description !== undefined ? { description: data.description } : {}),
          ...(data.isRequired !== undefined ? { isRequired: data.isRequired } : {}),
          ...(data.position !== undefined ? { position: data.position } : {}),
          ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
        },
      });
    }
  );
  revalidatePath("/admin/fields");
  return { ok: true as const, definition: updated };
}

/**
 * Deactivation, not deletion — the Z2 spec is explicit: values must persist
 * for historical reporting. `updateDefinition({ isActive: false })` is the
 * same operation; this wrapper exists so the admin UI can present it as
 * "deactivate" without the caller having to know that.
 */
export async function deactivateDefinition(id: string) {
  return updateDefinition({ id, isActive: false });
}

// ---------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------

const upsertValueSchema = z
  .object({
    fieldDefinitionId: z.string().min(1),
    targetId: z.string().min(1),
    valueText: z.string().nullable().optional(),
    valueNumber: z.number().nullable().optional(),
    valueDate: z
      .union([z.string(), z.date()])
      .nullable()
      .optional()
      .transform((v) => (v == null ? null : typeof v === "string" ? new Date(v) : v)),
    valueBoolean: z.boolean().nullable().optional(),
  })
  .refine(
    (v) => {
      const filled = [v.valueText, v.valueNumber, v.valueDate, v.valueBoolean].filter(
        (x) => x !== undefined && x !== null
      ).length;
      return filled === 1;
    },
    { message: "Exactly one value field must be provided (matching the definition's type)." }
  );

type UpsertValueInput = z.infer<typeof upsertValueSchema>;

function columnForType(t: CustomFieldType): keyof UpsertValueInput {
  switch (t) {
    case "TEXT":
      return "valueText";
    case "NUMBER":
      return "valueNumber";
    case "DATE":
      return "valueDate";
    case "CHECKBOX":
      return "valueBoolean";
  }
}

export async function upsertValue(input: UpsertValueInput) {
  const session = await requireSession({ minRole: "AGENT" });
  const data = upsertValueSchema.parse(input);

  const result = await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const def = await tx.customFieldDefinition.findFirst({
        where: { id: data.fieldDefinitionId, tenantId: session.tenantId },
      });
      if (!def) throw new Error("NOT_FOUND");
      if (!def.isActive) throw new Error("DEFINITION_INACTIVE");

      const expected = columnForType(def.type);
      if (data[expected] === undefined || data[expected] === null) {
        throw new Error(`VALUE_TYPE_MISMATCH: expected ${expected} for ${def.type} field`);
      }

      const payload = {
        tenantId: session.tenantId,
        fieldDefinitionId: def.id,
        targetType: def.scope,
        targetId: data.targetId,
        valueText: expected === "valueText" ? (data.valueText ?? null) : null,
        valueNumber:
          expected === "valueNumber" && data.valueNumber != null
            ? new Prisma.Decimal(data.valueNumber)
            : null,
        valueDate: expected === "valueDate" ? (data.valueDate ?? null) : null,
        valueBoolean: expected === "valueBoolean" ? (data.valueBoolean ?? null) : null,
      };

      return tx.customFieldValue.upsert({
        where: {
          fieldDefinitionId_targetId: {
            fieldDefinitionId: def.id,
            targetId: data.targetId,
          },
        },
        create: payload,
        update: {
          valueText: payload.valueText,
          valueNumber: payload.valueNumber,
          valueDate: payload.valueDate,
          valueBoolean: payload.valueBoolean,
        },
      });
    }
  );
  return { ok: true as const, value: result };
}

/**
 * Batch fetch definitions + values for a single target (one ticket, one user,
 * one org). Callers zip these together for display; a definition without a
 * value renders as "—" and an inactive definition still renders IF a value
 * exists (historical data). Missing definitions never render.
 */
export async function listValuesForTarget(
  scope: CustomFieldScope,
  targetId: string
): Promise<
  Array<{
    definition: {
      id: string;
      key: string;
      label: string;
      type: CustomFieldType;
      isActive: boolean;
      isRequired: boolean;
      position: number;
    };
    value: {
      valueText: string | null;
      valueNumber: string | null; // Decimal serialized
      valueDate: Date | null;
      valueBoolean: boolean | null;
    } | null;
  }>
> {
  const session = await requireSession({ minRole: "AGENT" });
  return withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const [defs, values] = await Promise.all([
        tx.customFieldDefinition.findMany({
          where: { tenantId: session.tenantId, scope },
          orderBy: [{ position: "asc" }, { createdAt: "asc" }],
        }),
        tx.customFieldValue.findMany({
          where: { tenantId: session.tenantId, targetType: scope, targetId },
        }),
      ]);
      const valueByDef = new Map(values.map((v) => [v.fieldDefinitionId, v]));
      // Active + any-inactive-with-a-value, so historical data still renders.
      return defs
        .filter((d) => d.isActive || valueByDef.has(d.id))
        .map((d) => {
          const v = valueByDef.get(d.id) ?? null;
          return {
            definition: {
              id: d.id,
              key: d.key,
              label: d.label,
              type: d.type,
              isActive: d.isActive,
              isRequired: d.isRequired,
              position: d.position,
            },
            value: v
              ? {
                  valueText: v.valueText,
                  valueNumber: v.valueNumber ? v.valueNumber.toString() : null,
                  valueDate: v.valueDate,
                  valueBoolean: v.valueBoolean,
                }
              : null,
          };
        });
    }
  );
}
