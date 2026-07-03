"use server";

import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { withRls } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { updateProfileSchema, changePasswordSchema } from "@/lib/validation/profile";
import { uploadImage } from "@/lib/storage";
import { createSessionCookie } from "@/lib/session";

export async function getMyProfile() {
  const session = await requireSession();
  return withRls({ tenantId: session.tenantId, userId: session.id, role: session.role }, (tx) =>
    tx.user.findUniqueOrThrow({
      where: { id: session.id },
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
  const result = await uploadImage("avatars", `${session.id}/avatar.${ext}`, file);
  if (!result.ok) return { ok: false as const, error: result.error };

  // Fixed storage path (upsert) means the public URL never changes, so a
  // cache-busting query param is needed or the old picture keeps showing.
  const url = `${result.url}?v=${Date.now()}`;

  await withRls({ tenantId: session.tenantId, userId: session.id, role: session.role }, (tx) =>
    tx.user.update({ where: { id: session.id }, data: { avatarUrl: url } })
  );

  revalidatePath("/", "layout");
  return { ok: true as const, url };
}

/** Self-service — name/company only. Email, role, and status are managed by admins (see actions/admin.ts). */
export async function updateProfile(input: z.infer<typeof updateProfileSchema>) {
  const session = await requireSession();
  const data = updateProfileSchema.parse(input);

  await withRls({ tenantId: session.tenantId, userId: session.id, role: session.role }, (tx) =>
    tx.user.update({ where: { id: session.id }, data: { name: data.name, company: data.company } })
  );

  revalidatePath("/", "layout");
  return { ok: true as const };
}

export async function changeMyPassword(input: z.infer<typeof changePasswordSchema>) {
  const session = await requireSession();
  const data = changePasswordSchema.parse(input);

  const result = await withRls({ tenantId: session.tenantId, userId: session.id, role: session.role }, async (tx) => {
    const user = await tx.user.findUniqueOrThrow({ where: { id: session.id } });
    const valid = await bcrypt.compare(data.currentPassword, user.passwordHash);
    if (!valid) return { error: "Current password is incorrect." as const };

    const passwordHash = await bcrypt.hash(data.newPassword, 10);
    // Stamp the change so getSessionUser() invalidates every session issued
    // before now — this is what actually revokes other/stolen sessions.
    await tx.user.update({ where: { id: session.id }, data: { passwordHash, passwordChangedAt: new Date() } });
    return { ok: true as const };
  });

  if ("error" in result) return result;

  // Re-issue THIS session's cookie with a fresh iat (>= passwordChangedAt) so
  // the user who just changed their password stays logged in on this device,
  // while all their other sessions are invalidated. Done outside the tx —
  // cookies() is only writable in the action body, not mid-transaction.
  await createSessionCookie({ userId: session.id, tenantId: session.tenantId });
  return result;
}
