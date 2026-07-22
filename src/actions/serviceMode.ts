"use server";

// M15.1 — Service Mode toggle. Gated ADMIN+. Reversible per spec §3.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withRls } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { normalizeMode, type ServiceMode } from "@/lib/service-mode/labels";
import { actorCols, dualFkForUser } from "@/lib/z1-dual-fk";

export async function getTenantServiceMode(): Promise<ServiceMode> {
  const session = await requireSession();
  return withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const t = await tx.tenant.findUnique({
        where: { id: session.tenantId },
        select: { serviceMode: true },
      });
      return normalizeMode(t?.serviceMode);
    }
  );
}

const setSchema = z.object({
  mode: z.enum(["CUSTOMER", "EMPLOYEE"]),
});

export async function setTenantServiceMode(input: z.infer<typeof setSchema>) {
  const session = await requireSession({ minRole: "ADMIN" });
  const { mode } = setSchema.parse(input);
  return withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      await tx.tenant.update({
        where: { id: session.tenantId },
        data: { serviceMode: mode },
      });
      const dual = dualFkForUser(session.subjectId, session.role);
      await tx.auditLog.create({
        data: {
          tenantId: session.tenantId,
          ...actorCols(dual),
          action: "SERVICE_MODE_CHANGE",
          toValue: mode,
        },
      });
      revalidatePath("/admin/settings/service-mode");
      revalidatePath("/admin");
      revalidatePath("/portal");
      return { ok: true, mode };
    }
  );
}
