"use server";

import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { z } from "zod";
import crypto from "node:crypto";
import { withRls } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { updateProfileSchema, changePasswordSchema } from "@/lib/validation/profile";
import { createSessionCookie } from "@/lib/session";
import { roleToSubjectKind } from "@/lib/z1-dual-fk";
import { uploadImage } from "@/lib/storage";
import { getAvatarUrl } from "@/lib/avatars";
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

  // Identity from wrapper; avatar from Support-owned SubjectAvatar
  // (Z1.7). Organization-name display path is separate work; `company`
  // stays null on the DTO for now.
  const avatarUrl = await getAvatarUrl(session.tenantId, session.subjectId);
  if (session.role === "CLIENT") {
    const endUser = await getEndUser(ctx, session.subjectId);
    if (!endUser) throw new Error("PROFILE_NOT_FOUND");
    return {
      id: endUser.id,
      name: endUser.name ?? endUser.email,
      email: endUser.email,
      company: null,
      role: "CLIENT",
      avatarUrl,
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
    avatarUrl,
    createdAt: teamMember.createdAt,
  };
}

const AVATAR_BUCKET = "profile-avatars";

/**
 * Uploads the acting session's own profile picture to the public
 * avatar bucket and upserts the SubjectAvatar row (Z1.7). Wrapper
 * DTOs stay identity-only; avatars live Support-side.
 */
export async function uploadProfilePicture(
  formData: FormData
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const session = await requireSession();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "No file provided." };
  }

  const ext = file.name.includes(".") ? file.name.split(".").pop()!.toLowerCase() : "png";
  const path = `${session.tenantId}/${session.subjectId}/${crypto.randomUUID()}.${ext}`;
  const upload = await uploadImage(AVATAR_BUCKET, path, file);
  if (!upload.ok) return upload;

  await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    (tx) =>
      tx.subjectAvatar.upsert({
        where: { subjectId: session.subjectId },
        create: {
          subjectId: session.subjectId,
          tenantId: session.tenantId,
          avatarUrl: upload.url,
        },
        update: { avatarUrl: upload.url },
      })
  );

  return { ok: true, url: upload.url };
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
