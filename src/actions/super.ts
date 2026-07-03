"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { withRls } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { sendAgentInviteEmail } from "@/lib/email/events";
import { createTenantSchema } from "@/lib/validation/super";
import { createImpersonationCookie, destroyImpersonationCookie } from "@/lib/session";

const DEFAULT_CATEGORIES = ["Technical", "Billing", "General", "Other"];

/** Every super.* action requires SUPER_ADMIN role AND that the caller belongs to the INTERNAL host tenant — a client tenant's SUPER_ADMIN (if one ever existed) still couldn't provision tenants (TRD §2.5, §5.4). */
async function requireHostSuperAdmin() {
  const session = await requireSession({ minRole: "SUPER_ADMIN" });
  const tenant = await withRls({ tenantId: session.tenantId, userId: session.id, role: session.role }, (tx) =>
    tx.tenant.findUniqueOrThrow({ where: { id: session.tenantId } })
  );
  if (tenant.type !== "INTERNAL") throw new Error("FORBIDDEN");
  return session;
}

export async function listTenantsWithHealth() {
  const session = await requireHostSuperAdmin();

  return withRls({ tenantId: session.tenantId, userId: session.id, role: session.role }, async (tx) => {
    const tenants = await tx.tenant.findMany({ orderBy: { createdAt: "asc" } });
    const health = await Promise.all(
      tenants.map(async (t) => {
        const [userCount, ticketCount] = await Promise.all([
          tx.user.count({ where: { tenantId: t.id } }),
          tx.ticket.count({ where: { tenantId: t.id } }),
        ]);
        return { ...t, userCount, ticketCount };
      })
    );
    return health;
  });
}

/** Tenant provisioning (TRD §5.4): creates the tenant, default branding/chatbot config/categories, and its first admin user, then emails that admin a temp password. */
export async function createTenant(input: z.infer<typeof createTenantSchema>) {
  const session = await requireHostSuperAdmin();
  const data = createTenantSchema.parse(input);
  const tempPassword = crypto.randomBytes(9).toString("base64").replace(/[+/=]/g, "");
  const passwordHash = await bcrypt.hash(tempPassword, 10);

  const tenant = await withRls({ tenantId: session.tenantId, userId: session.id, role: session.role }, async (tx) => {
    const existing = await tx.tenant.findUnique({ where: { slug: data.slug } });
    if (existing) throw new Error("A tenant with this slug already exists.");

    const tenant = await tx.tenant.create({
      data: {
        name: data.name,
        slug: data.slug,
        type: "CLIENT",
        status: "TRIAL",
        branding: { create: { productName: data.name } },
        chatbotConfig: { create: {} },
      },
    });

    for (const name of DEFAULT_CATEGORIES) {
      await tx.category.create({ data: { tenantId: tenant.id, name } });
    }

    await tx.user.create({
      data: {
        tenantId: tenant.id,
        name: data.adminName,
        email: data.adminEmail,
        role: "ADMIN",
        passwordHash,
        status: "ACTIVE",
      },
    });

    return tenant;
  });

  // Sent using the new tenant's (just-created, default) branding.
  const branding = await withRls({ tenantId: tenant.id, userId: null, role: "SUPER_ADMIN" }, (tx) =>
    tx.tenantBranding.findUnique({ where: { tenantId: tenant.id } })
  );
  await sendAgentInviteEmail(data.adminEmail, tempPassword, branding);

  revalidatePath("/admin/super");
  return { ok: true, tenant, tempPassword };
}

export async function setTenantStatus(tenantId: string, status: "ACTIVE" | "SUSPENDED" | "TRIAL") {
  const session = await requireHostSuperAdmin();
  if (tenantId === session.tenantId) throw new Error("Cannot change the host tenant's own status.");

  return withRls({ tenantId: session.tenantId, userId: session.id, role: session.role }, async (tx) => {
    await tx.tenant.update({ where: { id: tenantId }, data: { status } });
    revalidatePath("/admin/super");
    return { ok: true };
  });
}

/**
 * Audited impersonation (TRD §5.4): a real SUPER_ADMIN at the host tenant
 * can step into a client tenant's admin view. This only requires the real
 * (non-impersonated) session to already be SUPER_ADMIN at the INTERNAL
 * tenant — see requireHostSuperAdmin(). While impersonating, every server
 * action's requireSession() sees role=ADMIN scoped to the target tenant
 * (src/lib/auth.ts's getSessionUser()), so this can't be nested and can't
 * be used to reach super.* actions again until stopImpersonation() runs.
 */
export async function startImpersonation(tenantId: string) {
  const session = await requireHostSuperAdmin();

  await withRls({ tenantId: session.tenantId, userId: session.id, role: session.role }, async (tx) => {
    const target = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    if (target.type !== "CLIENT") throw new Error("Can only impersonate a client tenant.");

    // toValue records the impersonator's name/email directly, not just
    // actorId — the audit_logs.actor relation can't be joined to a User row
    // in a *different* tenant once role has become ADMIN (impersonating),
    // since the users-table RLS policy only allows same-tenant reads (or a
    // real SUPER_ADMIN role, which this session no longer has once
    // impersonation starts). Without this the audit log would show
    // "System" for who did it, defeating the point of an audit trail.
    await tx.auditLog.create({
      data: { tenantId, actorId: session.id, action: "IMPERSONATION_START", toValue: `${session.name} <${session.email}>` },
    });
  });

  await createImpersonationCookie({ impersonatorUserId: session.id, targetTenantId: tenantId });
  redirect("/admin");
}

/** Ends impersonation. Runs with the *impersonated* view still active (role=ADMIN, tenantId=target) so the end-of-session audit entry lands on the same tenant's log as the start entry. */
export async function stopImpersonation() {
  const session = await requireSession();
  if (!session.isImpersonating) throw new Error("Not currently impersonating.");

  await withRls({ tenantId: session.tenantId, userId: session.id, role: session.role }, (tx) =>
    tx.auditLog.create({
      data: {
        tenantId: session.tenantId,
        actorId: session.id,
        action: "IMPERSONATION_END",
        toValue: `${session.name} <${session.email}>`,
      },
    })
  );

  await destroyImpersonationCookie();
  redirect("/admin/super");
}
