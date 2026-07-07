"use server";

import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { withRls } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { updateProfileSchema, changePasswordSchema } from "@/lib/validation/profile";
import { createSessionCookie } from "@/lib/session";
import { roleToSubjectKind } from "@/lib/z1-dual-fk";
import {
  systemContext,
  getEndUser,
  getTeamMember,
  updateEndUser,
  updateTeamMember,
} from "@/lib/shared-platform";

type ProfileDto = {
  id: string;
  name: string;
  email: string;
  company: string | null;
  role: "CLIENT" | "AGENT" | "ADMIN" | "SUPER_ADMIN";
  avatarUrl: string | null;
  createdAt: Date;
};

export async function getMyProfile(): Promise<ProfileDto> {
  const session = await requireSession();
  const ctx = systemContext(session.tenantId);

  // Z1.5b: identity read from wrapper (not legacy users). company is
  // deprecated free-text — returned as null until Z1.7 lands a proper
  // organization-name display path. avatarUrl null per boundary §7.10.
  if (session.role === "CLIENT") {
    const endUser = await getEndUser(ctx, session.subjectId);
    if (!endUser) throw new Error("PROFILE_NOT_FOUND");
    return {
      id: endUser.id,
      name: endUser.name ?? endUser.email,
      email: endUser.email,
      company: null,
      role: "CLIENT",
      avatarUrl: null,
      createdAt: endUser.createdAt,
    };
  }
  const teamMember = await getTeamMember(ctx, session.subjectId);
  if (!teamMember) throw new Error("PROFILE_NOT_FOUND");
  return {
    id: teamMember.id,
    name: teamMember.name ?? teamMember.email,
    email: teamMember.email,
    company: null,
    role: session.role,
    avatarUrl: null,
    createdAt: teamMember.createdAt,
  };
}

/**
 * Z1.5b: avatar upload is intentionally disabled between Z1.4b and Z1.7.
 * The legacy users.avatarUrl column is dropped by Z1.5; wrapper DTOs don't
 * expose avatarUrl yet. Z1.7 (post-Z1.5, cross-repo Shared Platform
 * migration) restores it. UI degrades to initials-only per §7.10.
 */
export async function uploadProfilePicture(
  _formData: FormData
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  await requireSession();
  return {
    ok: false,
    error: "Profile pictures are temporarily unavailable while Z1.7 is in flight. See boundary doc §7.10.",
  };
}

/** Self-service — name only. Email, role, and status are managed by admins (see actions/admin.ts). */
export async function updateProfile(input: z.infer<typeof updateProfileSchema>) {
  const session = await requireSession();
  const data = updateProfileSchema.parse(input);
  const ctx = systemContext(session.tenantId);

  // Z1.5b: name write goes to wrapper. company (legacy free-text) is
  // dropped — organization membership lives on wrapper's EndUserOrganization
  // and is not writable through the self-service profile form.
  if (session.role === "CLIENT") {
    await updateEndUser(ctx, session.subjectId, { name: data.name });
  } else {
    await updateTeamMember(ctx, session.subjectId, { name: data.name });
  }

  revalidatePath("/", "layout");
  return { ok: true as const };
}

export async function changeMyPassword(input: z.infer<typeof changePasswordSchema>) {
  const session = await requireSession();
  const parsed = changePasswordSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const data = parsed.data;

  const result = await withRls({ tenantId: session.tenantId, userId: session.subjectId, role: session.role }, async (tx) => {
    // Z1.5b: read passwordHash from auth_credentials (not legacy users).
    // Match by subject_* dual-FK; see prisma/z1_8a_migration.sql header
    // for the id-preservation convention.
    const subjectField = session.role === "CLIENT" ? "subjectEndUserId" : "subjectTeamMemberId";
    const cred = await tx.authCredential.findFirst({
      where: { tenantId: session.tenantId, [subjectField]: session.subjectId },
    });
    if (!cred) return { error: "Account not found." as const };

    const valid = await bcrypt.compare(data.currentPassword, cred.passwordHash);
    if (!valid) return { error: "Current password is incorrect." as const };

    const passwordHash = await bcrypt.hash(data.newPassword, 10);
    const now = new Date();
    await tx.authCredential.updateMany({
      where: { tenantId: session.tenantId, [subjectField]: session.subjectId },
      data: { passwordHash, passwordChangedAt: now },
    });
    return { ok: true as const };
  });

  if ("error" in result) return result;

  // Re-issue THIS session's cookie with a fresh iat (>= passwordChangedAt) so
  // the user who just changed their password stays logged in on this device,
  // while all their other sessions are invalidated.
  await createSessionCookie({
    subjectId: session.subjectId,
    subjectKind: roleToSubjectKind(session.role),
    tenantId: session.tenantId,
  });
  return result;
}
