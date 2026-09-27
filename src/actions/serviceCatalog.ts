"use server";

// M15.2 — Service Catalog CRUD + portal submission.
//
// The submit path is deliberately mundane: create a Ticket (same
// engine, no fork) with the caller as client, persist the dynamic
// form's answers as ordinary CustomFieldValue rows, and — if the
// catalog item requires approval — file an ApprovalRequest.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withRls } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { createWithReference } from "@/lib/ticket-number";
import { ticketClientCols, dualFkForUser, actorCols } from "@/lib/z1-dual-fk";

const CALLER_SCOPES = ["TICKET", "USER"] as const;

const upsertSchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().min(1).max(120),
  description: z.string().min(1).max(1000),
  iconEmoji: z.string().max(8).optional().nullable(),
  isActive: z.boolean(),
  requiresApproval: z.boolean(),
  approverSubjectIds: z.array(z.string().min(1)).max(10),
  approvalTimeoutHours: z.number().int().min(1).max(720),
  formFieldDefIds: z.array(z.string().min(1)).max(20),
  routingGroupId: z.string().min(1).optional().nullable(),
  position: z.number().int().min(0).max(999),
});

const submitSchema = z.object({
  catalogItemId: z.string().min(1),
  // Answers keyed by CustomFieldDefinition id → primitive value the
  // portal form collected. Persisted verbatim; the shared CF value
  // writer handles type coercion.
  answers: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
});

export type CatalogItemDto = {
  id: string;
  name: string;
  description: string;
  iconEmoji: string | null;
  isActive: boolean;
  requiresApproval: boolean;
  approverSubjectIds: string[];
  approvalTimeoutHours: number;
  formFieldDefIds: string[];
  routingGroupId: string | null;
  position: number;
  updatedAt: string;
};

export async function listCatalogItems(): Promise<CatalogItemDto[]> {
  const session = await requireSession({ minRole: "ADMIN" });
  return withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const rows = await tx.serviceCatalogItem.findMany({
        where: { tenantId: session.tenantId },
        orderBy: [{ position: "asc" }, { name: "asc" }],
      });
      return rows.map(toDto);
    }
  );
}

/** Portal-side lister — no ADMIN gate, only active items. */
export async function listActiveCatalogItems(): Promise<CatalogItemDto[]> {
  const session = await requireSession();
  return withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const rows = await tx.serviceCatalogItem.findMany({
        where: { tenantId: session.tenantId, isActive: true },
        orderBy: [{ position: "asc" }, { name: "asc" }],
      });
      return rows.map(toDto);
    }
  );
}

/** Portal-side single-item lookup, with the linked Z2 CF definitions inflated for the form. */
export async function getCatalogItemWithFields(itemId: string): Promise<{
  item: CatalogItemDto;
  fields: Array<{
    id: string;
    key: string;
    label: string;
    description: string | null;
    type: string;
    isRequired: boolean;
    options: Array<{ id: string; label: string; value: string }>;
  }>;
} | null> {
  const session = await requireSession();
  return withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const item = await tx.serviceCatalogItem.findFirst({
        where: { id: itemId, tenantId: session.tenantId, isActive: true },
      });
      if (!item) return null;
      const defIds = Array.isArray(item.formFieldDefIds)
        ? (item.formFieldDefIds as string[])
        : [];
      const defs = defIds.length
        ? await tx.customFieldDefinition.findMany({
            where: { tenantId: session.tenantId, id: { in: defIds }, isActive: true },
            include: {
              options: { orderBy: { position: "asc" } },
            },
          })
        : [];
      // Preserve the admin's chosen order.
      const byId = new Map(defs.map((d) => [d.id, d]));
      const orderedFields = defIds
        .map((id) => byId.get(id))
        .filter(
          (d): d is (typeof defs)[number] =>
            !!d && (CALLER_SCOPES as readonly string[]).includes(d.scope)
        )
        .map((d) => ({
          id: d.id,
          key: d.key,
          label: d.label,
          description: d.description,
          type: d.type,
          isRequired: d.isRequired,
          options: d.options.map((o) => ({
            id: o.id,
            label: o.label,
            value: o.value,
          })),
        }));
      return { item: toDto(item), fields: orderedFields };
    }
  );
}

export async function upsertCatalogItem(input: z.infer<typeof upsertSchema>) {
  const session = await requireSession({ minRole: "ADMIN" });
  const data = upsertSchema.parse(input);

  return withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      // Validate: form field defs must be TICKET or USER scope.
      if (data.formFieldDefIds.length > 0) {
        const defs = await tx.customFieldDefinition.findMany({
          where: {
            tenantId: session.tenantId,
            id: { in: data.formFieldDefIds },
          },
          select: { id: true, scope: true },
        });
        const badScope = defs.find((d) => !(CALLER_SCOPES as readonly string[]).includes(d.scope));
        if (badScope) {
          throw new Error(`Custom field ${badScope.id} is not TICKET/USER scope`);
        }
      }
      if (data.requiresApproval && data.approverSubjectIds.length === 0) {
        throw new Error("Approval requires at least one approver");
      }

      const row = data.id
        ? await tx.serviceCatalogItem.update({
            where: { id: data.id },
            data: {
              name: data.name,
              description: data.description,
              iconEmoji: data.iconEmoji ?? null,
              isActive: data.isActive,
              requiresApproval: data.requiresApproval,
              approverSubjectIds: data.approverSubjectIds as never,
              approvalTimeoutHours: data.approvalTimeoutHours,
              formFieldDefIds: data.formFieldDefIds as never,
              routingGroupId: data.routingGroupId ?? null,
              position: data.position,
            },
          })
        : await tx.serviceCatalogItem.create({
            data: {
              tenantId: session.tenantId,
              name: data.name,
              description: data.description,
              iconEmoji: data.iconEmoji ?? null,
              isActive: data.isActive,
              requiresApproval: data.requiresApproval,
              approverSubjectIds: data.approverSubjectIds as never,
              approvalTimeoutHours: data.approvalTimeoutHours,
              formFieldDefIds: data.formFieldDefIds as never,
              routingGroupId: data.routingGroupId ?? null,
              position: data.position,
            },
          });

      const dual = dualFkForUser(session.subjectId, session.role);
      await tx.auditLog.create({
        data: {
          tenantId: session.tenantId,
          ...actorCols(dual),
          action: data.id ? "CATALOG_ITEM_UPDATE" : "CATALOG_ITEM_CREATE",
          toValue: row.name,
        },
      });
      revalidatePath("/admin/service-catalog");
      revalidatePath("/portal");
      return { ok: true, id: row.id };
    }
  );
}

export async function deleteCatalogItem(id: string) {
  const session = await requireSession({ minRole: "ADMIN" });
  return withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const item = await tx.serviceCatalogItem.findFirst({
        where: { id, tenantId: session.tenantId },
      });
      if (!item) throw new Error("catalog item not found");
      await tx.serviceCatalogItem.delete({ where: { id: item.id } });
      const dual = dualFkForUser(session.subjectId, session.role);
      await tx.auditLog.create({
        data: {
          tenantId: session.tenantId,
          ...actorCols(dual),
          action: "CATALOG_ITEM_DELETE",
          fromValue: item.name,
        },
      });
      revalidatePath("/admin/service-catalog");
      return { ok: true };
    }
  );
}

/**
 * Portal-side submit — creates a Ticket + persists CF answers + files
 * an ApprovalRequest if the catalog item is approval-gated.
 */
export async function submitCatalogRequest(input: z.infer<typeof submitSchema>) {
  const session = await requireSession();
  const data = submitSchema.parse(input);

  return withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const item = await tx.serviceCatalogItem.findFirst({
        where: { id: data.catalogItemId, tenantId: session.tenantId, isActive: true },
      });
      if (!item) throw new Error("Catalog item not found");

      const tenant = await tx.tenant.findUniqueOrThrow({
        where: { id: session.tenantId },
        select: { name: true },
      });

      // session.role is UserRole (no GUEST) — guests hit dedicated
      // routes, not this action.
      const clientDual = dualFkForUser(session.subjectId, session.role);

      const ticket = await createWithReference(tenant.name, ({ reference, ticketNumber }) =>
        tx.ticket.create({
          data: {
            tenantId: session.tenantId,
            reference,
            ticketNumber,
            title: item.name,
            description: `Service catalog request: ${item.name}\n\n${item.description}`,
            ...ticketClientCols(clientDual),
            priority: "MEDIUM",
            status: item.requiresApproval ? "PENDING" : "OPEN",
            source: "service_catalog",
            // Auto-routing by group happens through the M1 rule engine
            // (auto_route action) rather than a Ticket column here —
            // catalog items just carry the group id as a hint.
          },
        })
      );

      // Persist CF answers. Only defs actually attached to this item
      // are accepted — reject stray keys.
      const defIds = Array.isArray(item.formFieldDefIds)
        ? (item.formFieldDefIds as string[])
        : [];
      const allowed = new Set(defIds);
      const defs = defIds.length
        ? await tx.customFieldDefinition.findMany({
            where: { tenantId: session.tenantId, id: { in: defIds } },
            select: { id: true, type: true, scope: true, isRequired: true, label: true },
          })
        : [];
      const defById = new Map(defs.map((d) => [d.id, d]));
      for (const d of defs) {
        if (d.isRequired && (data.answers[d.id] === null || data.answers[d.id] === undefined || data.answers[d.id] === "")) {
          throw new Error(`Required field missing: ${d.label}`);
        }
      }
      for (const [defId, raw] of Object.entries(data.answers)) {
        if (!allowed.has(defId)) continue;
        const def = defById.get(defId);
        if (!def) continue;
        if (raw === null || raw === undefined || raw === "") continue;
        // Only TICKET-scoped values persist against the new ticket —
        // USER-scoped fields belong to the subject's profile, not the
        // request, so persisting one from the form would silently
        // mutate profile data. Drop them; admins can capture profile
        // fields via other flows.
        if (def.scope !== "TICKET") continue;
        await tx.customFieldValue.create({
          data: {
            tenantId: session.tenantId,
            fieldDefinitionId: def.id,
            targetType: "TICKET",
            targetId: ticket.id,
            valueText:
              def.type === "TEXT" ||
              def.type === "DROPDOWN" ||
              def.type === "USER_LOOKUP" ||
              def.type === "ORG_LOOKUP"
                ? String(raw)
                : null,
            valueNumber: def.type === "NUMBER" && typeof raw === "number" ? raw : null,
            valueBoolean: def.type === "CHECKBOX" && typeof raw === "boolean" ? raw : null,
          },
        });
      }

      // File the approval if needed.
      let approvalId: string | null = null;
      if (item.requiresApproval) {
        const approvers = Array.isArray(item.approverSubjectIds)
          ? (item.approverSubjectIds as string[])
          : [];
        if (approvers.length === 0) {
          throw new Error("Catalog item requires approval but has no approvers configured");
        }
        const approval = await tx.approvalRequest.create({
          data: {
            tenantId: session.tenantId,
            ticketId: ticket.id,
            catalogItemId: item.id,
            approverSubjectIds: approvers as never,
            currentStep: 0,
            totalSteps: approvers.length,
            expiresAt: new Date(
              Date.now() + item.approvalTimeoutHours * 60 * 60 * 1000
            ),
          },
        });
        approvalId = approval.id;
      }

      await tx.auditLog.create({
        data: {
          tenantId: session.tenantId,
          ticketId: ticket.id,
          ...actorCols(clientDual),
          action: "CATALOG_SUBMIT",
          toValue: item.name,
        },
      });
      revalidatePath("/portal");
      return {
        ok: true,
        ticketId: ticket.id,
        ticketReference: ticket.reference,
        approvalId,
      };
    }
  );
}

function toDto(row: {
  id: string;
  name: string;
  description: string;
  iconEmoji: string | null;
  isActive: boolean;
  requiresApproval: boolean;
  approverSubjectIds: unknown;
  approvalTimeoutHours: number;
  formFieldDefIds: unknown;
  routingGroupId: string | null;
  position: number;
  updatedAt: Date;
}): CatalogItemDto {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    iconEmoji: row.iconEmoji,
    isActive: row.isActive,
    requiresApproval: row.requiresApproval,
    approverSubjectIds: Array.isArray(row.approverSubjectIds)
      ? (row.approverSubjectIds as string[])
      : [],
    approvalTimeoutHours: row.approvalTimeoutHours,
    formFieldDefIds: Array.isArray(row.formFieldDefIds)
      ? (row.formFieldDefIds as string[])
      : [],
    routingGroupId: row.routingGroupId,
    position: row.position,
    updatedAt: row.updatedAt.toISOString(),
  };
}
