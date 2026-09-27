"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@/generated/prisma";
import type { CustomFieldScope, CustomFieldType } from "@/generated/prisma";
import { withRls } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import {
  systemContext,
  getEndUsersByIds,
  getOrganizationsByIds,
  listEndUsers,
  listOrganizations,
} from "@/lib/shared-platform";

// ---------------------------------------------------------------------------
// Z2.1 — Custom Fields server actions
//
// Staff-only across the board: end users must not see or edit custom field
// definitions OR values (Z2 spec §3, enforced server-side, not just UI).
// Reads on a Ticket sidebar are staff-only in this pass — a later Enterprise
// tier will decide whether specific fields are end-user-visible.
// ---------------------------------------------------------------------------

const SCOPES = ["USER", "ORG", "TICKET"] as const;
const TYPES = [
  "TEXT",
  "NUMBER",
  "DATE",
  "CHECKBOX",
  "DROPDOWN",
  "MULTISELECT",
  "USER_LOOKUP",
  "ORG_LOOKUP",
] as const;

// DD/MS require an option list; other types must not carry options.
const OPTION_TYPES = new Set<CustomFieldType>(["DROPDOWN", "MULTISELECT"]);
// LOOKUP types need a target-entity picker instead of an options list.
const LOOKUP_TYPES = new Set<CustomFieldType>(["USER_LOOKUP", "ORG_LOOKUP"]);

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
  isPhi: z.boolean().optional(),
  position: z.number().int().min(0).optional(),
});

const updateDefinitionSchema = z.object({
  id: z.string().min(1),
  // key is deliberately absent — immutable after create (Z2 spec §3).
  label: z.string().min(1).max(120).optional(),
  description: z.string().max(500).nullable().optional(),
  isRequired: z.boolean().optional(),
  // isPhi is intentionally NOT patchable here — flipping PHI on/off
  // mid-life would need a re-encryption pass over every existing value
  // for this definition (a heavy migration). See M20 spec §3: "Do NOT
  // allow tenant-level [encryption mode] to be changed after provisioning
  // without a migration plan." — the same principle applies at field
  // level. Create a new PHI-marked field and migrate values manually.
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
        include: {
          _count: { select: { options: true } },
        },
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
            // M20.3 — PHI flag is set at create-time only (see
            // updateDefinitionSchema comment).
            isPhi: data.isPhi ?? false,
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
    valueOptionId: z.string().nullable().optional(),
    valueOptionIds: z.array(z.string()).nullable().optional(),
    valueLookupId: z.string().nullable().optional(),
  })
  .refine(
    (v) => {
      const filled = [
        v.valueText,
        v.valueNumber,
        v.valueDate,
        v.valueBoolean,
        v.valueOptionId,
        v.valueOptionIds && v.valueOptionIds.length > 0 ? "set" : null,
        v.valueLookupId,
      ].filter((x) => x !== undefined && x !== null).length;
      return filled === 1;
    },
    { message: "Exactly one value must be provided (matching the definition's type)." }
  );

type UpsertValueInput = z.infer<typeof upsertValueSchema>;

function columnForType(
  t: CustomFieldType
):
  | "valueText"
  | "valueNumber"
  | "valueDate"
  | "valueBoolean"
  | "valueOptionId"
  | "valueOptionIds"
  | "valueLookupId" {
  switch (t) {
    case "TEXT":
      return "valueText";
    case "NUMBER":
      return "valueNumber";
    case "DATE":
      return "valueDate";
    case "CHECKBOX":
      return "valueBoolean";
    case "DROPDOWN":
      return "valueOptionId";
    case "MULTISELECT":
      return "valueOptionIds";
    case "USER_LOOKUP":
    case "ORG_LOOKUP":
      return "valueLookupId";
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
      const incoming = data[expected];
      const isSet =
        expected === "valueOptionIds"
          ? Array.isArray(incoming) && incoming.length > 0
          : incoming !== undefined && incoming !== null;
      if (!isSet) {
        throw new Error(`VALUE_TYPE_MISMATCH: expected ${expected} for ${def.type} field`);
      }

      // For DD/MS validate that the incoming option id(s) belong to this
      // definition. Prevents smuggling a stray id from another tenant's
      // field (RLS would still block cross-tenant, but the "wrong field's
      // option" case has to be caught here).
      if (def.type === "DROPDOWN" && data.valueOptionId) {
        const opt = await tx.customFieldOption.findFirst({
          where: { id: data.valueOptionId, fieldDefinitionId: def.id, tenantId: session.tenantId },
          select: { id: true },
        });
        if (!opt) throw new Error("UNKNOWN_OPTION");
      }
      if (def.type === "MULTISELECT" && data.valueOptionIds && data.valueOptionIds.length > 0) {
        const opts = await tx.customFieldOption.findMany({
          where: {
            id: { in: data.valueOptionIds },
            fieldDefinitionId: def.id,
            tenantId: session.tenantId,
          },
          select: { id: true },
        });
        if (opts.length !== data.valueOptionIds.length) throw new Error("UNKNOWN_OPTION");
      }

      // M20.4 — PHI fields: envelope-encrypt the typed value under the
      // tenant DEK and store the ciphertext in valueEnc; leave the typed
      // columns null so a stolen DB dump reveals nothing. Callers with
      // phiRead permission get the plaintext back via listValuesForTarget.
      let valueEnc: string | null = null;
      if (def.isPhi) {
        const { envelopeEncrypt } = await import("@/core/auth/envelope-crypto");
        const plainForEnc: Record<string, unknown> = {};
        if (expected === "valueText") plainForEnc.valueText = data.valueText;
        else if (expected === "valueNumber") plainForEnc.valueNumber = data.valueNumber;
        else if (expected === "valueDate")
          plainForEnc.valueDate = data.valueDate ? data.valueDate.toISOString() : null;
        else if (expected === "valueBoolean") plainForEnc.valueBoolean = data.valueBoolean;
        else if (expected === "valueOptionId") plainForEnc.valueOptionId = data.valueOptionId;
        else if (expected === "valueOptionIds") plainForEnc.valueOptionIds = data.valueOptionIds ?? [];
        else if (expected === "valueLookupId") plainForEnc.valueLookupId = data.valueLookupId;
        valueEnc = await envelopeEncrypt(tx, session.tenantId, JSON.stringify(plainForEnc));
      }

      const payload = {
        tenantId: session.tenantId,
        fieldDefinitionId: def.id,
        targetType: def.scope,
        targetId: data.targetId,
        valueText: def.isPhi ? null : (expected === "valueText" ? (data.valueText ?? null) : null),
        valueNumber: def.isPhi
          ? null
          : expected === "valueNumber" && data.valueNumber != null
            ? new Prisma.Decimal(data.valueNumber)
            : null,
        valueDate: def.isPhi ? null : (expected === "valueDate" ? (data.valueDate ?? null) : null),
        valueBoolean: def.isPhi ? null : (expected === "valueBoolean" ? (data.valueBoolean ?? null) : null),
        valueOptionId: def.isPhi ? null : (expected === "valueOptionId" ? (data.valueOptionId ?? null) : null),
        valueOptionIds: def.isPhi ? [] : (expected === "valueOptionIds" ? (data.valueOptionIds ?? []) : []),
        valueLookupId: def.isPhi ? null : (expected === "valueLookupId" ? (data.valueLookupId ?? null) : null),
        valueEnc,
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
          valueOptionId: payload.valueOptionId,
          valueOptionIds: payload.valueOptionIds,
          valueLookupId: payload.valueLookupId,
          valueEnc: payload.valueEnc,
        },
      });
    }
  );
  return { ok: true as const, value: result };
}

// ---------------------------------------------------------------------------
// Z2.2 — Options
// ---------------------------------------------------------------------------

const OPTION_VALUE_RE = /^[a-z0-9][a-z0-9_-]*$/;

const upsertOptionSchema = z.object({
  fieldDefinitionId: z.string().min(1),
  id: z.string().optional(),
  // Value is immutable after create (like the definition's key). Editing an
  // existing option's `value` is a hard error at the DB level (unique index
  // key) — the UI hides the field entirely on edit.
  value: z
    .string()
    .min(1)
    .max(64)
    .regex(OPTION_VALUE_RE, "Option value must be lowercase alphanumeric with _ or -."),
  label: z.string().min(1).max(120),
  position: z.number().int().min(0).optional(),
  implicitTag: z.string().max(120).nullable().optional(),
});

export async function listOptions(fieldDefinitionId: string) {
  const session = await requireSession({ minRole: "AGENT" });
  return withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    (tx) =>
      tx.customFieldOption.findMany({
        where: { fieldDefinitionId, tenantId: session.tenantId },
        orderBy: [{ position: "asc" }, { createdAt: "asc" }],
      })
  );
}

export async function upsertOption(input: z.infer<typeof upsertOptionSchema>) {
  const session = await requireSession({ minRole: "ADMIN" });
  const data = upsertOptionSchema.parse(input);

  try {
    const result = await withRls(
      { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
      async (tx) => {
        const def = await tx.customFieldDefinition.findFirst({
          where: { id: data.fieldDefinitionId, tenantId: session.tenantId },
          select: { id: true, type: true },
        });
        if (!def) throw new Error("NOT_FOUND");
        if (!OPTION_TYPES.has(def.type)) {
          throw new Error(`OPTIONS_NOT_ALLOWED: ${def.type} fields don't have options`);
        }

        if (data.id) {
          // Edit path — value is immutable; only label/position/implicitTag change.
          const existing = await tx.customFieldOption.findFirst({
            where: { id: data.id, fieldDefinitionId: def.id, tenantId: session.tenantId },
            select: { id: true, value: true },
          });
          if (!existing) throw new Error("NOT_FOUND");
          return tx.customFieldOption.update({
            where: { id: data.id },
            data: {
              label: data.label,
              ...(data.position !== undefined ? { position: data.position } : {}),
              implicitTag: data.implicitTag ?? null,
            },
          });
        }
        return tx.customFieldOption.create({
          data: {
            tenantId: session.tenantId,
            fieldDefinitionId: def.id,
            value: data.value,
            label: data.label,
            position: data.position ?? 0,
            implicitTag: data.implicitTag ?? null,
          },
        });
      }
    );
    revalidatePath("/admin/fields");
    return { ok: true as const, option: result };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return { ok: false as const, error: `An option with value "${data.value}" already exists.` };
    }
    if (err instanceof Error && err.message.startsWith("OPTIONS_NOT_ALLOWED")) {
      return { ok: false as const, error: err.message.split(": ").slice(1).join(": ") };
    }
    throw err;
  }
}

export async function deleteOption(id: string) {
  const session = await requireSession({ minRole: "ADMIN" });
  await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      // Clear any references from values before the FK-less scalar deletes.
      // Prisma has no FK for valueOptionId/valueOptionIds — the option might
      // still be referenced from valueOptionId rows. Reset those rows so the
      // CHECK constraint doesn't fire (a value with all-null columns).
      // The Z2 spec says definitions can only be deactivated, not deleted;
      // options DO allow hard-delete (Zendesk parity), so we do the cleanup.
      await tx.customFieldValue.deleteMany({
        where: { tenantId: session.tenantId, valueOptionId: id },
      });
      // For MULTISELECT, splice the option id out of any valueOptionIds
      // arrays. If splicing empties the array the row still fails CHECK, so
      // just delete those rows too — treating removal as "the user's pick is
      // gone" is the least surprising behavior.
      await tx.$executeRawUnsafe(
        `DELETE FROM "custom_field_values"
         WHERE "tenantId" = $1
           AND $2 = ANY("valueOptionIds")
           AND cardinality(array_remove("valueOptionIds", $2)) = 0`,
        session.tenantId,
        id
      );
      await tx.$executeRawUnsafe(
        `UPDATE "custom_field_values"
           SET "valueOptionIds" = array_remove("valueOptionIds", $2)
         WHERE "tenantId" = $1
           AND $2 = ANY("valueOptionIds")`,
        session.tenantId,
        id
      );
      await tx.customFieldOption.delete({
        where: { id },
      });
    }
  );
  revalidatePath("/admin/fields");
  return { ok: true as const };
}

/**
 * Batch fetch definitions + values for a single target (one ticket, one user,
 * one org). Callers zip these together for display; a definition without a
 * value renders as "—" and an inactive definition still renders IF a value
 * exists (historical data). Missing definitions never render.
 */
export type CustomFieldTargetRow = {
  definition: {
    id: string;
    key: string;
    label: string;
    type: CustomFieldType;
    isActive: boolean;
    isRequired: boolean;
    // M20.3 — PHI marker surfaced to the UI so the sidebar can badge
    // the field. Read-side masking happens in the value block below.
    isPhi: boolean;
    position: number;
    // Available options for DD/MS (empty array for other types). The full
    // list is included so a value editor doesn't need a second round-trip.
    options: Array<{ id: string; value: string; label: string }>;
  };
  value: {
    valueText: string | null;
    valueNumber: string | null;
    valueDate: Date | null;
    valueBoolean: boolean | null;
    valueOptionId: string | null;
    valueOptionIds: string[];
    // Pre-resolved labels of the picked option(s), for display without a
    // second lookup pass. Order matches valueOptionIds.
    valueOptionLabels: string[];
    // Z2.5: id + resolved display label of the referenced wrapper entity
    // (EndUser/Organization). `valueLookupLabel` is null when the lookup
    // target has been deleted from the wrapper — sidebar renders a fallback.
    valueLookupId: string | null;
    valueLookupLabel: string | null;
    // M20.4 — true when this row's value was PHI-masked because the
    // caller lacks `phiRead`. Sidebar renders "•••" in that case.
    phiMasked?: boolean;
  } | null;
};

export async function listValuesForTarget(
  scope: CustomFieldScope,
  targetId: string
): Promise<CustomFieldTargetRow[]> {
  const session = await requireSession({ minRole: "AGENT" });
  return withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const [defs, values] = await Promise.all([
        tx.customFieldDefinition.findMany({
          where: { tenantId: session.tenantId, scope },
          orderBy: [{ position: "asc" }, { createdAt: "asc" }],
          include: {
            options: {
              orderBy: [{ position: "asc" }, { createdAt: "asc" }],
              select: { id: true, value: true, label: true },
            },
          },
        }),
        tx.customFieldValue.findMany({
          where: { tenantId: session.tenantId, targetType: scope, targetId },
        }),
      ]);
      const valueByDef = new Map(values.map((v) => [v.fieldDefinitionId, v]));

      // Z2.5: batch-resolve lookup targets. Group by scope so we hit each
      // wrapper endpoint at most once per list. Skip when there's nothing
      // to resolve.
      const userLookupIds = new Set<string>();
      const orgLookupIds = new Set<string>();
      for (const d of defs) {
        const v = valueByDef.get(d.id);
        if (!v?.valueLookupId) continue;
        if (d.type === "USER_LOOKUP") userLookupIds.add(v.valueLookupId);
        if (d.type === "ORG_LOOKUP") orgLookupIds.add(v.valueLookupId);
      }
      const ctx = systemContext(session.tenantId);
      const [userMap, orgMap] = await Promise.all([
        userLookupIds.size > 0
          ? getEndUsersByIds(ctx, [...userLookupIds])
          : Promise.resolve(new Map<string, { name: string | null; email: string }>()),
        orgLookupIds.size > 0
          ? getOrganizationsByIds(ctx, [...orgLookupIds])
          : Promise.resolve(new Map<string, { name: string }>()),
      ]);

      // M20.4 — PHI read gate. ADMIN+ inherits; other roles require
      // the phiRead permission bit on their Role.permissions JSON.
      // Load the caller's Role.permissions once and cache the decision.
      const { canReadPhi } = await import("@/lib/compliance/phi");
      const rolePermissions =
        session.role === "ADMIN" || session.role === "SUPER_ADMIN"
          ? { phiRead: true }
          : await (async () => {
              // Non-admin: consult wrapper Role.permissions. If we can't
              // resolve the role, close by default (no PHI read).
              const tm = await tx.$queryRawUnsafe<{ permissions: unknown }[]>(
                `SELECT r."permissions" FROM team_members tm
                   JOIN roles r ON r.id = tm."roleId"
                  WHERE tm.id = $1 AND tm."tenantId" = $2 LIMIT 1`,
                session.subjectId,
                session.tenantId
              );
              return (tm[0]?.permissions ?? {}) as { phiRead?: boolean };
            })();
      const phiRead = canReadPhi(session, rolePermissions);

      // Decrypt PHI-marked values eagerly for authorised callers so the
      // rest of the render path stays synchronous. Non-authorised
      // callers never see the ciphertext.
      const { envelopeDecrypt } = await import("@/core/auth/envelope-crypto");
      const decryptedByDefId = new Map<string, Record<string, unknown> | null>();
      if (phiRead) {
        await Promise.all(
          defs
            .filter((d) => d.isPhi && valueByDef.get(d.id)?.valueEnc)
            .map(async (d) => {
              const v = valueByDef.get(d.id)!;
              const plain = v.valueEnc
                ? await envelopeDecrypt(tx, session.tenantId, v.valueEnc)
                : null;
              decryptedByDefId.set(
                d.id,
                plain ? (JSON.parse(plain) as Record<string, unknown>) : null
              );
            })
        );
      }

      return defs
        .filter((d) => d.isActive || valueByDef.has(d.id))
        .map((d) => {
          const v = valueByDef.get(d.id) ?? null;
          const optionLabelById = new Map(d.options.map((o) => [o.id, o.label]));
          let lookupLabel: string | null = null;
          if (v?.valueLookupId) {
            if (d.type === "USER_LOOKUP") {
              const u = userMap.get(v.valueLookupId);
              lookupLabel = u ? (u.name ?? u.email) : null;
            } else if (d.type === "ORG_LOOKUP") {
              const o = orgMap.get(v.valueLookupId);
              lookupLabel = o?.name ?? null;
            }
          }
          // PHI read/mask.
          let phiMasked = false;
          let valueText = v?.valueText ?? null;
          let valueNumber = v?.valueNumber ? v.valueNumber.toString() : null;
          let valueDate = v?.valueDate ?? null;
          let valueBoolean = v?.valueBoolean ?? null;
          let valueOptionId = v?.valueOptionId ?? null;
          let valueOptionIds = v?.valueOptionIds ?? [];
          let valueLookupId = v?.valueLookupId ?? null;
          if (v && d.isPhi) {
            if (!phiRead) {
              phiMasked = true;
              valueText = null;
              valueNumber = null;
              valueDate = null;
              valueBoolean = null;
              valueOptionId = null;
              valueOptionIds = [];
              valueLookupId = null;
            } else {
              const p = decryptedByDefId.get(d.id) ?? null;
              if (p) {
                valueText = typeof p.valueText === "string" ? p.valueText : null;
                valueNumber = typeof p.valueNumber === "number" ? String(p.valueNumber) : null;
                valueDate = typeof p.valueDate === "string" ? new Date(p.valueDate) : null;
                valueBoolean = typeof p.valueBoolean === "boolean" ? p.valueBoolean : null;
                valueOptionId = typeof p.valueOptionId === "string" ? p.valueOptionId : null;
                valueOptionIds = Array.isArray(p.valueOptionIds) ? (p.valueOptionIds as string[]) : [];
                valueLookupId = typeof p.valueLookupId === "string" ? p.valueLookupId : null;
              }
            }
          }
          return {
            definition: {
              id: d.id,
              key: d.key,
              label: d.label,
              type: d.type,
              isActive: d.isActive,
              isRequired: d.isRequired,
              isPhi: d.isPhi,
              position: d.position,
              options: d.options,
            },
            value: v
              ? {
                  valueText,
                  valueNumber,
                  valueDate,
                  valueBoolean,
                  valueOptionId,
                  valueOptionIds,
                  valueOptionLabels: (valueOptionId ? [valueOptionId] : valueOptionIds)
                    .map((id) => optionLabelById.get(id))
                    .filter((l): l is string => Boolean(l)),
                  valueLookupId,
                  valueLookupLabel: lookupLabel,
                  phiMasked,
                }
              : null,
          };
        });
    }
  );
}

// ---------------------------------------------------------------------------
// Z2.5 — Lookup search
//
// Autocomplete backing for USER_LOOKUP / ORG_LOOKUP value pickers. Staff-only
// (same AGENT gate as everything else in this file). Returns up to 20 rows.
// ---------------------------------------------------------------------------

export async function searchLookupTargets(
  scope: "USER" | "ORG",
  query: string
): Promise<Array<{ id: string; label: string; sublabel?: string }>> {
  const session = await requireSession({ minRole: "AGENT" });
  const ctx = systemContext(session.tenantId);
  const q = query.trim();
  if (scope === "USER") {
    const page = await listEndUsers(ctx, { search: q || undefined, limit: 20 });
    return page.items.map((u) => ({
      id: u.id,
      label: u.name ?? u.email,
      sublabel: u.name ? u.email : undefined,
    }));
  }
  const page = await listOrganizations(ctx, { search: q || undefined, limit: 20 });
  return page.items.map((o) => ({ id: o.id, label: o.name }));
}
