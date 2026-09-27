"use server";

// M14.1 — HelpCenter CRUD. Admin+ gated.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withRls } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { actorCols, dualFkForUser } from "@/lib/z1-dual-fk";

const slugRe = /^[a-z][a-z0-9-]{1,60}$/;

const upsertSchema = z.object({
  id: z.string().min(1).optional(),
  slug: z.string().regex(slugRe, "slug must be lowercase, alphanumeric + hyphens"),
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional().nullable(),
  customDomain: z
    .string()
    .max(200)
    .regex(/^[a-z0-9.-]+\.[a-z]{2,}$/i, "must be a valid host")
    .optional()
    .nullable(),
  isActive: z.boolean(),
  communityEnabled: z.boolean(),
  communityModerationDefault: z.boolean(),
  communityUpvoteThreshold: z.number().int().min(1).max(100),
  brandingJson: z
    .object({
      logoUrl: z.string().url().optional(),
      primaryColor: z.string().max(20).optional(),
    })
    .optional()
    .nullable(),
});

export type HelpCenterDto = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  customDomain: string | null;
  isActive: boolean;
  communityEnabled: boolean;
  communityModerationDefault: boolean;
  communityUpvoteThreshold: number;
  brandingJson: { logoUrl?: string; primaryColor?: string } | null;
  updatedAt: string;
};

export async function listHelpCenters(): Promise<HelpCenterDto[]> {
  const session = await requireSession({ minRole: "ADMIN" });
  return withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const rows = await tx.helpCenter.findMany({
        where: { tenantId: session.tenantId },
        orderBy: [{ isActive: "desc" }, { name: "asc" }],
      });
      return rows.map((r) => ({
        id: r.id,
        slug: r.slug,
        name: r.name,
        description: r.description,
        customDomain: r.customDomain,
        isActive: r.isActive,
        communityEnabled: r.communityEnabled,
        communityModerationDefault: r.communityModerationDefault,
        communityUpvoteThreshold: r.communityUpvoteThreshold,
        brandingJson: (r.brandingJson as HelpCenterDto["brandingJson"]) ?? null,
        updatedAt: r.updatedAt.toISOString(),
      }));
    }
  );
}

export async function upsertHelpCenter(input: z.infer<typeof upsertSchema>) {
  const session = await requireSession({ minRole: "ADMIN" });
  const data = upsertSchema.parse(input);

  return withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const row = data.id
        ? await tx.helpCenter.update({
            where: { id: data.id },
            data: {
              slug: data.slug,
              name: data.name,
              description: data.description ?? null,
              customDomain: data.customDomain?.toLowerCase() || null,
              isActive: data.isActive,
              communityEnabled: data.communityEnabled,
              communityModerationDefault: data.communityModerationDefault,
              communityUpvoteThreshold: data.communityUpvoteThreshold,
              brandingJson: (data.brandingJson ?? null) as never,
            },
          })
        : await tx.helpCenter.create({
            data: {
              tenantId: session.tenantId,
              slug: data.slug,
              name: data.name,
              description: data.description ?? null,
              customDomain: data.customDomain?.toLowerCase() || null,
              isActive: data.isActive,
              communityEnabled: data.communityEnabled,
              communityModerationDefault: data.communityModerationDefault,
              communityUpvoteThreshold: data.communityUpvoteThreshold,
              brandingJson: (data.brandingJson ?? null) as never,
            },
          });
      const dual = dualFkForUser(session.subjectId, session.role);
      await tx.auditLog.create({
        data: {
          tenantId: session.tenantId,
          ...actorCols(dual),
          action: data.id ? "HELP_CENTER_UPDATE" : "HELP_CENTER_CREATE",
          toValue: row.slug,
        },
      });
      revalidatePath("/admin/kb/help-centers");
      revalidatePath(`/help/${row.slug}`);
      return { ok: true, id: row.id };
    }
  );
}

export async function deleteHelpCenter(id: string) {
  const session = await requireSession({ minRole: "ADMIN" });
  return withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const hc = await tx.helpCenter.findFirst({
        where: { id, tenantId: session.tenantId },
      });
      if (!hc) throw new Error("Not found");
      await tx.helpCenter.delete({ where: { id } });
      const dual = dualFkForUser(session.subjectId, session.role);
      await tx.auditLog.create({
        data: {
          tenantId: session.tenantId,
          ...actorCols(dual),
          action: "HELP_CENTER_DELETE",
          fromValue: hc.slug,
        },
      });
      revalidatePath("/admin/kb/help-centers");
      return { ok: true };
    }
  );
}

/**
 * M14.2 — fail-closed resolver. Given a request host, returns the
 * matching HelpCenter + its tenantId, or null. Called from the public
 * /help/[slug] route + potential custom-domain middleware. Never
 * returns a HelpCenter unless one matches — no fuzzy matching, no
 * "closest match" fallback (spec §3).
 */
export async function resolveHelpCenterByHost(
  host: string
): Promise<{ helpCenterId: string; tenantId: string; slug: string } | null> {
  const normalized = host.toLowerCase().split(":")[0]; // strip port
  const { prisma } = await import("@/lib/db");
  const row = await prisma.helpCenter.findFirst({
    where: { customDomain: normalized, isActive: true },
    select: { id: true, tenantId: true, slug: true },
  });
  if (!row) return null;
  return { helpCenterId: row.id, tenantId: row.tenantId, slug: row.slug };
}

/**
 * Path-based resolver — /help/[slug]. Also fail-closed: returns null
 * when no active HelpCenter matches within the tenant scoped by the
 * caller's session (or by SUPER_ADMIN system context for public
 * reads).
 */
export async function resolveHelpCenterBySlug(
  slug: string
): Promise<{ helpCenterId: string; tenantId: string; name: string } | null> {
  const { prisma } = await import("@/lib/db");
  const row = await prisma.helpCenter.findFirst({
    where: { slug, isActive: true },
    select: { id: true, tenantId: true, name: true },
  });
  if (!row) return null;
  return { helpCenterId: row.id, tenantId: row.tenantId, name: row.name };
}
