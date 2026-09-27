"use server";

// Phase 4f — narrow admin action for the Email channel page: sets the
// support inbound address, the display "from" name, and the sending
// domain. Everything else on TenantBranding stays in the branding
// editor.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { withRls } from "@/lib/db";
import { actorCols, dualFkForUser } from "@/lib/z1-dual-fk";

const schema = z.object({
  supportEmail: z.string().email().optional().or(z.literal("")),
  emailFromName: z.string().trim().max(80).optional().or(z.literal("")),
  emailDomain: z
    .string()
    .trim()
    .toLowerCase()
    .max(253)
    .optional()
    .or(z.literal("")),
});

export async function updateEmailChannel(
  input: z.infer<typeof schema>
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const session = await requireSession({ minRole: "ADMIN" });

  try {
    await withRls(
      { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
      async (tx) => {
        await tx.tenantBranding.upsert({
          where: { tenantId: session.tenantId },
          create: {
            tenantId: session.tenantId,
            supportEmail: parsed.data.supportEmail || null,
            emailFromName: parsed.data.emailFromName || null,
            emailDomain: parsed.data.emailDomain || null,
          },
          update: {
            supportEmail: parsed.data.supportEmail || null,
            emailFromName: parsed.data.emailFromName || null,
            emailDomain: parsed.data.emailDomain || null,
          },
        });
        await tx.auditLog.create({
          data: {
            tenantId: session.tenantId,
            ...actorCols(dualFkForUser(session.subjectId, session.role)),
            action: "EMAIL_CHANNEL_UPDATE",
            toValue: JSON.stringify(parsed.data),
          },
        });
      }
    );
  } catch (e) {
    if (e instanceof Error && e.message.includes("Unique")) {
      return { ok: false, error: "That inbound address is already claimed by another tenant." };
    }
    throw e;
  }
  revalidatePath("/admin/channels/email");
  return { ok: true };
}
