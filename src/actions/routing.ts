"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withRls } from "@/lib/db";
import { requireSession } from "@/lib/auth";

// M3 — mutations for AgentProfile (skills / maxOpen / isAvailable).
// Kept in its own actions file so the routing surface has one obvious
// place to add future admin-facing mutations (e.g. bulk skill import).

const upsertProfileSchema = z.object({
  teamMemberId: z.string().min(1),
  skills: z.array(z.string().min(1).max(60)).max(30).optional(),
  maxOpen: z.number().int().min(0).max(500).optional(),
  isAvailable: z.boolean().optional(),
});

/**
 * Idempotent upsert of an AgentProfile row. Admin-only. A team member
 * can toggle their own availability via `setOwnAvailability` below —
 * that path skips the ADMIN requirement.
 */
export async function upsertAgentProfile(input: z.infer<typeof upsertProfileSchema>) {
  const session = await requireSession({ minRole: "ADMIN" });
  const { teamMemberId, skills, maxOpen, isAvailable } = upsertProfileSchema.parse(input);
  await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const existing = await tx.agentProfile.findFirst({
        where: { tenantId: session.tenantId, teamMemberId },
      });
      if (existing) {
        await tx.agentProfile.update({
          where: { id: existing.id },
          data: {
            ...(skills !== undefined && { skills }),
            ...(maxOpen !== undefined && { maxOpen }),
            ...(isAvailable !== undefined && { isAvailable }),
          },
        });
      } else {
        await tx.agentProfile.create({
          data: {
            tenantId: session.tenantId,
            teamMemberId,
            skills: skills ?? [],
            maxOpen: maxOpen ?? 0,
            isAvailable: isAvailable ?? true,
          },
        });
      }
    }
  );
  revalidatePath(`/admin/users/${teamMemberId}`);
  revalidatePath("/admin/routing");
  return { ok: true };
}

/**
 * Agent-controlled availability toggle. Called from the header
 * Available/Away chip. No admin gate — an agent can always mark
 * themselves away. Auto-creates the profile row so freshly-added
 * agents can toggle before an admin has touched their profile.
 */
export async function setOwnAvailability(input: { isAvailable: boolean }) {
  const session = await requireSession({ minRole: "AGENT" });
  if (!session.subjectId) throw new Error("No subject in session.");
  const teamMemberId = session.subjectId;
  await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const existing = await tx.agentProfile.findFirst({
        where: { tenantId: session.tenantId, teamMemberId },
      });
      if (existing) {
        await tx.agentProfile.update({
          where: { id: existing.id },
          data: { isAvailable: input.isAvailable },
        });
      } else {
        await tx.agentProfile.create({
          data: {
            tenantId: session.tenantId,
            teamMemberId,
            skills: [],
            maxOpen: 0,
            isAvailable: input.isAvailable,
          },
        });
      }
    }
  );
  revalidatePath("/agent");
  return { ok: true, isAvailable: input.isAvailable };
}
