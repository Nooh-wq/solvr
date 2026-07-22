"use server";

// Phase 4a — thin server-action layer on top of the shared-platform tag
// wrapper (src/lib/shared-platform/tags.ts). Admin-gated + revalidates
// the /admin/objects/tags page after each mutation.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { withRls } from "@/lib/db";
import { contextFromSession } from "@/lib/shared-platform/context";
import {
  createTag,
  deleteTag,
  listTags,
  updateTag,
} from "@/lib/shared-platform/tags";

const TAGS_PATH = "/admin/objects/tags";

const nameSchema = z.string().trim().min(1).max(48);
const colorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Must be a #RRGGBB hex color.");

export type AdminTagRow = {
  id: string;
  name: string;
  color: string;
  usage: number;
  usageByType: { END_USER: number; TEAM_MEMBER: number; ORGANIZATION: number; TICKET: number };
  createdAt: Date;
  updatedAt: Date;
};

export async function listTagsWithUsage(): Promise<AdminTagRow[]> {
  const session = await requireSession({ minRole: "ADMIN" });
  const ctx = await contextFromSession(session);
  const tags = await listTags(ctx);

  return withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const grouped = await tx.tagAssignment.groupBy({
        by: ["tagId", "targetType"],
        where: { tenantId: session.tenantId },
        _count: { _all: true },
      });
      const byTag = new Map<string, AdminTagRow["usageByType"]>();
      for (const row of grouped) {
        const bucket = byTag.get(row.tagId) ?? {
          END_USER: 0,
          TEAM_MEMBER: 0,
          ORGANIZATION: 0,
          TICKET: 0,
        };
        const kind = row.targetType as keyof AdminTagRow["usageByType"];
        bucket[kind] = row._count._all;
        byTag.set(row.tagId, bucket);
      }
      return tags
        .map((t) => {
          const usage = byTag.get(t.id) ?? {
            END_USER: 0,
            TEAM_MEMBER: 0,
            ORGANIZATION: 0,
            TICKET: 0,
          };
          const total = usage.END_USER + usage.TEAM_MEMBER + usage.ORGANIZATION + usage.TICKET;
          return {
            id: t.id,
            name: t.name,
            color: t.color,
            usage: total,
            usageByType: usage,
            createdAt: t.createdAt,
            updatedAt: t.updatedAt,
          };
        })
        .sort((a, b) => b.usage - a.usage || a.name.localeCompare(b.name));
    }
  );
}

const createSchema = z.object({ name: nameSchema, color: colorSchema.optional() });

export async function adminCreateTag(
  input: z.infer<typeof createSchema>
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const session = await requireSession({ minRole: "ADMIN" });
  const ctx = await contextFromSession(session);
  try {
    await createTag(ctx, parsed.data);
    revalidatePath(TAGS_PATH);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not create tag." };
  }
}

const updateSchema = z.object({
  id: z.string().min(1),
  name: nameSchema.optional(),
  color: colorSchema.optional(),
});

export async function adminUpdateTag(
  input: z.infer<typeof updateSchema>
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const session = await requireSession({ minRole: "ADMIN" });
  const ctx = await contextFromSession(session);
  try {
    await updateTag(ctx, parsed.data.id, { name: parsed.data.name, color: parsed.data.color });
    revalidatePath(TAGS_PATH);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not update tag." };
  }
}

export async function adminDeleteTag(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!id) return { ok: false, error: "Missing id." };
  const session = await requireSession({ minRole: "ADMIN" });
  const ctx = await contextFromSession(session);
  try {
    await deleteTag(ctx, id);
    revalidatePath(TAGS_PATH);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not delete tag." };
  }
}

const mergeSchema = z.object({ sourceIds: z.array(z.string().min(1)).min(1), targetId: z.string().min(1) });

/**
 * Merge one or more source tags into a target tag. Reassigns every
 * TagAssignment (skipping duplicates via the unique constraint) and
 * deletes the source rows. Idempotent from the caller's perspective.
 */
export async function adminMergeTags(
  input: z.infer<typeof mergeSchema>
): Promise<{ ok: true; merged: number } | { ok: false; error: string }> {
  const parsed = mergeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  if (parsed.data.sourceIds.includes(parsed.data.targetId)) {
    return { ok: false, error: "Target cannot also be a source." };
  }
  const session = await requireSession({ minRole: "ADMIN" });

  const merged = await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const target = await tx.tag.findFirst({ where: { id: parsed.data.targetId, tenantId: session.tenantId } });
      if (!target) throw new Error("Target tag not found.");
      const sources = await tx.tag.findMany({
        where: { id: { in: parsed.data.sourceIds }, tenantId: session.tenantId },
      });
      if (sources.length === 0) return 0;

      let moved = 0;
      for (const src of sources) {
        const assignments = await tx.tagAssignment.findMany({
          where: { tenantId: session.tenantId, tagId: src.id },
        });
        for (const a of assignments) {
          const existing = await tx.tagAssignment.findUnique({
            where: {
              tenantId_tagId_targetType_targetId: {
                tenantId: session.tenantId,
                tagId: target.id,
                targetType: a.targetType,
                targetId: a.targetId,
              },
            },
          });
          if (existing) {
            await tx.tagAssignment.delete({ where: { id: a.id } });
          } else {
            await tx.tagAssignment.update({ where: { id: a.id }, data: { tagId: target.id } });
            moved += 1;
          }
        }
        await tx.tag.delete({ where: { id: src.id } });
      }
      return moved;
    }
  );

  revalidatePath(TAGS_PATH);
  return { ok: true, merged };
}
