"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@/generated/prisma";
import { withRls } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { roleAtLeast } from "@/lib/auth";

// Z6.3 — canned responses. Personal or tenant-shared (Z6.5 uses the
// same table with ownerTeamMemberId = null). Personal writes any agent;
// shared writes require ADMIN+ until the Z5 permission catalog gate
// lands. RLS mirrors both invariants; app-layer checks here surface
// friendlier errors than a raw RLS insert failure.

const shortcutSchema = z
  .string()
  .min(1)
  .max(40)
  .regex(/^[a-z0-9-]+$/, "Shortcut must be lowercase letters, numbers, or dashes.");

const createSchema = z.object({
  name: z.string().min(1).max(80),
  shortcut: shortcutSchema,
  body: z.string().min(1).max(20000),
  shared: z.boolean().default(false),
});

const updateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(80).optional(),
  shortcut: shortcutSchema.optional(),
  body: z.string().min(1).max(20000).optional(),
});

export type CannedResponseRow = {
  id: string;
  ownerTeamMemberId: string | null;
  name: string;
  shortcut: string;
  body: string;
  isShared: boolean;
  createdAt: Date;
  updatedAt: Date;
};

/** Personal + shared responses visible to the acting session. */
export async function listCannedResponses(): Promise<CannedResponseRow[]> {
  const session = await requireSession({ minRole: "AGENT" });
  return withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const rows = await tx.cannedResponse.findMany({
        where: {
          tenantId: session.tenantId,
          OR: [
            { ownerTeamMemberId: session.subjectId },
            { ownerTeamMemberId: null },
          ],
        },
        orderBy: [{ ownerTeamMemberId: "asc" }, { name: "asc" }],
      });
      return rows.map((r) => ({
        id: r.id,
        ownerTeamMemberId: r.ownerTeamMemberId,
        name: r.name,
        shortcut: r.shortcut,
        body: r.body,
        isShared: r.ownerTeamMemberId === null,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      }));
    }
  );
}

export async function createCannedResponse(input: z.infer<typeof createSchema>) {
  const session = await requireSession({ minRole: "AGENT" });
  const data = createSchema.parse(input);

  if (data.shared && !roleAtLeast(session.role, "ADMIN")) {
    throw new Error("Only admins can create shared canned responses.");
  }

  const ownerTeamMemberId = data.shared ? null : session.subjectId;

  try {
    const row = await withRls(
      { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
      (tx) =>
        tx.cannedResponse.create({
          data: {
            tenantId: session.tenantId,
            ownerTeamMemberId,
            name: data.name,
            shortcut: data.shortcut,
            body: data.body,
          },
        })
    );
    revalidatePath("/admin/canned-responses");
    return { id: row.id };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw new Error(`A canned response with shortcut "${data.shortcut}" already exists.`);
    }
    throw e;
  }
}

export async function updateCannedResponse(input: z.infer<typeof updateSchema>) {
  const session = await requireSession({ minRole: "AGENT" });
  const data = updateSchema.parse(input);

  try {
    await withRls(
      { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
      async (tx) => {
        const existing = await tx.cannedResponse.findFirst({
          where: { id: data.id, tenantId: session.tenantId },
        });
        if (!existing) throw new Error("Canned response not found.");
        const isShared = existing.ownerTeamMemberId === null;
        if (isShared && !roleAtLeast(session.role, "ADMIN")) {
          throw new Error("Only admins can edit shared canned responses.");
        }
        if (!isShared && existing.ownerTeamMemberId !== session.subjectId) {
          throw new Error("You can only edit your own canned responses.");
        }
        await tx.cannedResponse.update({
          where: { id: data.id },
          data: {
            ...(data.name !== undefined && { name: data.name }),
            ...(data.shortcut !== undefined && { shortcut: data.shortcut }),
            ...(data.body !== undefined && { body: data.body }),
          },
        });
      }
    );
    revalidatePath("/admin/canned-responses");
    return { ok: true as const };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw new Error(`Shortcut already in use.`);
    }
    throw e;
  }
}

export async function deleteCannedResponse(id: string) {
  const session = await requireSession({ minRole: "AGENT" });
  await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const existing = await tx.cannedResponse.findFirst({
        where: { id, tenantId: session.tenantId },
      });
      if (!existing) throw new Error("Canned response not found.");
      const isShared = existing.ownerTeamMemberId === null;
      if (isShared && !roleAtLeast(session.role, "ADMIN")) {
        throw new Error("Only admins can delete shared canned responses.");
      }
      if (!isShared && existing.ownerTeamMemberId !== session.subjectId) {
        throw new Error("You can only delete your own canned responses.");
      }
      await tx.cannedResponse.delete({ where: { id } });
    }
  );
  revalidatePath("/admin/canned-responses");
  return { ok: true as const };
}
