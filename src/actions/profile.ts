"use server";

import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { withRls } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { updateProfileSchema, changePasswordSchema } from "@/lib/validation/profile";
import { uploadImage } from "@/lib/storage";
import { createSessionCookie } from "@/lib/session";
import { roleToSubjectKind } from "@/lib/z1-dual-fk";

export async function getMyProfile() {
  const session = await requireSession();
  return withRls({ tenantId: session.tenantId, userId: session.subjectId, role: session.role }, (tx) =>
    tx.user.findUniqueOrThrow({
      where: { id: session.subjectId },
      select: { id: true, name: true, email: true, company: true, role: true, avatarUrl: true, createdAt: true },
    })
  );
}

/** Uploads a profile picture to Supabase Storage and saves the resulting public URL — see lib/storage.ts. */
export async function uploadProfilePicture(formData: FormData) {
  const session = await requireSession();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false as const, error: "No file provided." };

  const ext = file.name.split(".").pop()?.toLowerCase() || "png";
  const result = await uploadImage("avatars", `${session.subjectId}/avatar.${ext}`, file);
  if (!result.ok) return { ok: false as const, error: result.error };

  // Fixed storage path (upsert) means the public URL never changes, so a
  // cache-busting query param is needed or the old picture keeps showing.
  const url = `${result.url}?v=${Date.now()}`;

  await withRls({ tenantId: session.tenantId, userId: session.subjectId, role: session.role }, (tx) =>
    tx.user.update({ where: { id: session.subjectId }, data: { avatarUrl: url } })
  );

  revalidatePath("/", "layout");
  return { ok: true as const, url };
}

/** Self-service — name/company only. Email, role, and status are managed by admins (see actions/admin.ts). */
export async function updateProfile(input: z.infer<typeof updateProfileSchema>) {
  const session = await requireSession();
  const data = updateProfileSchema.parse(input);

  await withRls({ tenantId: session.tenantId, userId: session.subjectId, role: session.role }, (tx) =>
    tx.user.update({ where: { id: session.subjectId }, data: { name: data.name, company: data.company } })
  );

  revalidatePath("/", "layout");
  return { ok: true as const };
}

export async function changeMyPassword(input: z.infer<typeof changePasswordSchema>) {
  const session = await requireSession();
  const parsed = changePasswordSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const data = parsed.data;

  const result = await withRls({ tenantId: session.tenantId, userId: session.subjectId, role: session.role }, async (tx) => {
    const user = await tx.user.findUniqueOrThrow({ where: { id: session.subjectId } });
    const valid = await bcrypt.compare(data.currentPassword, user.passwordHash);
    if (!valid) return { error: "Current password is incorrect." as const };

    const passwordHash = await bcrypt.hash(data.newPassword, 10);
    const now = new Date();
    // Stamp the change so getSessionUser() invalidates every session issued
    // before now — this is what actually revokes other/stolen sessions.
    await tx.user.update({ where: { id: session.subjectId }, data: { passwordHash, passwordChangedAt: now } });
    // Z1.8a dual-write: mirror password change to auth_credentials.
    // Match by dual-FK, NOT by id (auth_credentials.id is fresh cuid; the
    // subject_* columns are preserved from Z1.3). See prisma/z1_8a_migration.sql
    // header for the id-preservation convention.
    const subjectField = session.role === "CLIENT" ? "subjectEndUserId" : "subjectTeamMemberId";
    await tx.authCredential.updateMany({
      where: { tenantId: session.tenantId, [subjectField]: session.subjectId },
      data: { passwordHash, passwordChangedAt: now },
    });
    return { ok: true as const };
  });

  if ("error" in result) return result;

  // Re-issue THIS session's cookie with a fresh iat (>= passwordChangedAt) so
  // the user who just changed their password stays logged in on this device,
  // while all their other sessions are invalidated. Done outside the tx —
  // cookies() is only writable in the action body, not mid-transaction.
  await createSessionCookie({
    subjectId: session.subjectId,
    subjectKind: roleToSubjectKind(session.role),
    tenantId: session.tenantId,
  });
  return result;
}
