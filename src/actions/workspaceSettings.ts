"use server";

// Phase 4e — Workspace-level admin defaults + chat widget config.
// Small surface; touches ChatbotConfig + a few Tenant JSON columns.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { withRls } from "@/lib/db";

// -- Chat widget ------------------------------------------------------------

const chatSchema = z.object({
  isEnabled: z.boolean(),
  persona: z.string().min(1).max(200),
  systemPrompt: z.string().max(4000).nullable(),
  deflectFirst: z.boolean(),
  escalateAfter: z.number().int().min(1).max(20),
  allowedTopics: z.string().max(500).nullable(),
});

export type ChatbotConfigRow = z.infer<typeof chatSchema>;

export async function getChatbotConfig(): Promise<ChatbotConfigRow> {
  const session = await requireSession({ minRole: "ADMIN" });
  return withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const row = await tx.chatbotConfig.upsert({
        where: { tenantId: session.tenantId },
        create: { tenantId: session.tenantId },
        update: {},
      });
      return {
        isEnabled: row.isEnabled,
        persona: row.persona,
        systemPrompt: row.systemPrompt,
        deflectFirst: row.deflectFirst,
        escalateAfter: row.escalateAfter,
        allowedTopics: row.allowedTopics,
      };
    }
  );
}

export async function updateChatbotConfig(
  input: z.infer<typeof chatSchema>
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = chatSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const session = await requireSession({ minRole: "ADMIN" });
  await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    (tx) =>
      tx.chatbotConfig.upsert({
        where: { tenantId: session.tenantId },
        create: { tenantId: session.tenantId, ...parsed.data },
        update: parsed.data,
      })
  );
  revalidatePath("/admin/workspaces/chat");
  return { ok: true };
}

// -- Portal (serviceMode + Trust Center + branding link) --------------------

const portalSchema = z.object({
  serviceMode: z.enum(["CUSTOMER", "EMPLOYEE"]),
});

export async function updatePortalMode(
  input: z.infer<typeof portalSchema>
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = portalSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input." };
  const session = await requireSession({ minRole: "ADMIN" });
  await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    (tx) => tx.tenant.update({ where: { id: session.tenantId }, data: { serviceMode: parsed.data.serviceMode } })
  );
  revalidatePath("/admin/workspaces/portal");
  return { ok: true };
}

export async function getPortalSettings(): Promise<{
  serviceMode: string;
  customDomain: string | null;
  brandingLogoUrl: string | null;
}> {
  const session = await requireSession({ minRole: "ADMIN" });
  return withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const [tenant, branding] = await Promise.all([
        tx.tenant.findUniqueOrThrow({
          where: { id: session.tenantId },
          select: { serviceMode: true, customDomain: true },
        }),
        tx.tenantBranding.findUnique({
          where: { tenantId: session.tenantId },
          select: { logoUrl: true },
        }),
      ]);
      return {
        serviceMode: tenant.serviceMode,
        customDomain: tenant.customDomain,
        brandingLogoUrl: branding?.logoUrl ?? null,
      };
    }
  );
}

// -- Views admin surface ----------------------------------------------------

export type WorkspaceView = {
  id: string;
  name: string;
  isShared: boolean;
  isDefault: boolean;
  ownerName: string | null;
  ownerEmail: string | null;
  createdAt: Date;
};

export async function listAllViews(): Promise<WorkspaceView[]> {
  const session = await requireSession({ minRole: "ADMIN" });
  return withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const views = await tx.savedView.findMany({
        where: { tenantId: session.tenantId },
        orderBy: [{ ownerTeamMemberId: "asc" }, { name: "asc" }],
      });
      const ownerIds = Array.from(new Set(views.map((v) => v.ownerTeamMemberId).filter(Boolean))) as string[];
      const owners = ownerIds.length
        ? await tx.teamMember.findMany({
            where: { tenantId: session.tenantId, id: { in: ownerIds } },
            select: { id: true, name: true, email: true },
          })
        : [];
      const ownerById = new Map(owners.map((o) => [o.id, o]));
      return views.map((v) => {
        const o = v.ownerTeamMemberId ? ownerById.get(v.ownerTeamMemberId) : null;
        return {
          id: v.id,
          name: v.name,
          isShared: v.ownerTeamMemberId === null,
          isDefault: v.isDefault,
          ownerName: o?.name ?? null,
          ownerEmail: o?.email ?? null,
          createdAt: v.createdAt,
        };
      });
    }
  );
}
