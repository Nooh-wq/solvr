"use server";

import { revalidatePath } from "next/cache";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { withRls } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { sendAgentInviteEmail, sendRegistrationApprovedEmail, sendRegistrationRejectedEmail } from "@/lib/email/events";
import { contrastRatio } from "@/lib/color";
import { notify } from "@/lib/notifications";
import { uploadImage } from "@/lib/storage";
import {
  inviteUserSchema,
  updateUserSchema,
  userIdSchema,
  upsertCategorySchema,
  updateBrandingSchema,
  auditLogFilterSchema,
} from "@/lib/validation/admin";

function generateTempPassword() {
  return crypto.randomBytes(9).toString("base64").replace(/[+/=]/g, "");
}

// ---------------------------------------------------------------------------
// Team & roles
// ---------------------------------------------------------------------------

export async function listTeam() {
  const session = await requireSession({ minRole: "ADMIN" });
  return withRls({ tenantId: session.tenantId, userId: session.id, role: session.role }, (tx) =>
    tx.user.findMany({ where: { tenantId: session.tenantId }, orderBy: { createdAt: "asc" } })
  );
}

export async function listPendingUsers() {
  const session = await requireSession({ minRole: "ADMIN" });
  return withRls({ tenantId: session.tenantId, userId: session.id, role: session.role }, (tx) =>
    tx.user.findMany({ where: { tenantId: session.tenantId, status: "PENDING" }, orderBy: { createdAt: "asc" } })
  );
}

type InviteUserResult = { ok: true; tempPassword: string } | { ok: false; error: string };

/** Admin creates a user directly (no external invite-acceptance flow yet) with a generated temp password. Admin-invited users skip the registration approval gate — the admin creating them *is* the approval. */
export async function inviteUser(input: z.infer<typeof inviteUserSchema>): Promise<InviteUserResult> {
  const session = await requireSession({ minRole: "ADMIN" });

  // safeParse (not .parse) so a validation failure — e.g. the native <input
  // type="email"> lets through addresses like "te@e" that HTML5 accepts but
  // Zod rejects — returns a specific, user-facing message instead of
  // throwing. A thrown error from a Server Action gets its message redacted
  // by Next.js in production ("An error occurred in the Server Components
  // render..."), which is what was surfacing here.
  const parsed = inviteUserSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const data = parsed.data;

  const tempPassword = generateTempPassword();
  const passwordHash = await bcrypt.hash(tempPassword, 10);

  let user: { id: string; email: string };
  let branding: Awaited<ReturnType<typeof getBranding>>;
  try {
    ({ user, branding } = await withRls(
      { tenantId: session.tenantId, userId: session.id, role: session.role },
      async (tx) => {
        const existing = await tx.user.findUnique({
          where: { tenantId_email: { tenantId: session.tenantId, email: data.email } },
        });
        if (existing) throw new Error("EXISTS");

        const user = await tx.user.create({
          data: {
            tenantId: session.tenantId,
            name: data.name,
            email: data.email,
            role: data.role,
            company: data.company,
            passwordHash,
            status: "ACTIVE",
          },
        });
        await tx.auditLog.create({
          data: { tenantId: session.tenantId, actorId: session.id, action: "INVITE_USER", toValue: user.email },
        });
        const branding = await tx.tenantBranding.findUnique({ where: { tenantId: session.tenantId } });
        return { user, branding };
      }
    ));
  } catch (e) {
    if (e instanceof Error && e.message === "EXISTS") {
      return { ok: false, error: "An account with this email already exists." };
    }
    throw e;
  }

  await sendAgentInviteEmail(user.email, tempPassword, branding);

  revalidatePath("/admin/team");
  return { ok: true, tempPassword };
}

export async function updateUser(input: z.infer<typeof updateUserSchema>) {
  const session = await requireSession({ minRole: "ADMIN" });
  const data = updateUserSchema.parse(input);

  return withRls({ tenantId: session.tenantId, userId: session.id, role: session.role }, async (tx) => {
    const target = await tx.user.findFirst({ where: { id: data.userId, tenantId: session.tenantId } });
    if (!target) throw new Error("NOT_FOUND");
    if (target.id === session.id && data.role && data.role !== target.role) {
      throw new Error("Cannot change your own role.");
    }

    const updated = await tx.user.update({
      where: { id: target.id },
      data: { role: data.role, status: data.status },
    });

    if (data.role && data.role !== target.role) {
      await tx.auditLog.create({
        data: {
          tenantId: session.tenantId,
          actorId: session.id,
          action: "ROLE_CHANGE",
          fromValue: target.role,
          toValue: data.role,
        },
      });
    }
    if (data.status !== undefined && data.status !== target.status) {
      await tx.auditLog.create({
        data: {
          tenantId: session.tenantId,
          actorId: session.id,
          action: data.status === "ACTIVE" ? "REACTIVATE_USER" : "DEACTIVATE_USER",
          toValue: target.email,
        },
      });
    }

    revalidatePath("/admin/team");
    return { ok: true, user: updated };
  });
}

/** Approves a PENDING registration (email flow design §"Registration Approval Gate"). */
export async function approveUser(input: z.infer<typeof userIdSchema>) {
  const session = await requireSession({ minRole: "ADMIN" });
  const data = userIdSchema.parse(input);

  const { user, branding } = await withRls(
    { tenantId: session.tenantId, userId: session.id, role: session.role },
    async (tx) => {
      const target = await tx.user.findFirst({ where: { id: data.userId, tenantId: session.tenantId, status: "PENDING" } });
      if (!target) throw new Error("NOT_FOUND");

      const user = await tx.user.update({ where: { id: target.id }, data: { status: "ACTIVE" } });
      await tx.auditLog.create({
        data: { tenantId: session.tenantId, actorId: session.id, action: "APPROVE_USER", toValue: user.email },
      });
      await notify(tx, {
        tenantId: session.tenantId,
        userId: user.id,
        type: "REGISTRATION_APPROVED",
        title: "Your account was approved",
        body: "You can now log in.",
      });
      const branding = await tx.tenantBranding.findUnique({ where: { tenantId: session.tenantId } });
      return { user, branding };
    }
  );

  await sendRegistrationApprovedEmail(user.email, branding);

  revalidatePath("/admin/team");
  return { ok: true };
}

/** Rejects a PENDING registration. */
export async function rejectUser(input: z.infer<typeof userIdSchema>) {
  const session = await requireSession({ minRole: "ADMIN" });
  const data = userIdSchema.parse(input);

  const { user, branding } = await withRls(
    { tenantId: session.tenantId, userId: session.id, role: session.role },
    async (tx) => {
      const target = await tx.user.findFirst({ where: { id: data.userId, tenantId: session.tenantId, status: "PENDING" } });
      if (!target) throw new Error("NOT_FOUND");

      const user = await tx.user.update({ where: { id: target.id }, data: { status: "REJECTED" } });
      await tx.auditLog.create({
        data: { tenantId: session.tenantId, actorId: session.id, action: "REJECT_USER", toValue: user.email },
      });
      const branding = await tx.tenantBranding.findUnique({ where: { tenantId: session.tenantId } });
      return { user, branding };
    }
  );

  await sendRegistrationRejectedEmail(user.email, branding);

  revalidatePath("/admin/team");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export async function listAllCategories() {
  const session = await requireSession({ minRole: "ADMIN" });
  return withRls({ tenantId: session.tenantId, userId: session.id, role: session.role }, (tx) =>
    tx.category.findMany({ where: { tenantId: session.tenantId }, orderBy: { name: "asc" } })
  );
}

export async function upsertCategory(
  input: z.infer<typeof upsertCategorySchema>
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await requireSession({ minRole: "ADMIN" });

  // safeParse: a rejected name (garbage/symbols-only, wrong charset, etc.)
  // needs to reach the client as a specific message — a thrown ZodError gets
  // redacted by Next.js in production into a generic, useless message.
  const parsed = upsertCategorySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid category name." };
  const data = parsed.data;

  return withRls({ tenantId: session.tenantId, userId: session.id, role: session.role }, async (tx) => {
    if (data.id) {
      const category = await tx.category.updateMany({
        where: { id: data.id, tenantId: session.tenantId },
        data: { name: data.name, isActive: data.isActive },
      });
      if (category.count === 0) return { ok: false, error: "Category not found." };
    } else {
      await tx.category.create({
        data: { tenantId: session.tenantId, name: data.name, isActive: data.isActive },
      });
    }
    revalidatePath("/admin/categories");
    return { ok: true };
  });
}

// ---------------------------------------------------------------------------
// Branding
// ---------------------------------------------------------------------------

export async function getBranding() {
  const session = await requireSession({ minRole: "ADMIN" });
  return withRls({ tenantId: session.tenantId, userId: session.id, role: session.role }, (tx) =>
    tx.tenantBranding.findUnique({ where: { tenantId: session.tenantId } })
  );
}

export async function updateBranding(input: z.infer<typeof updateBrandingSchema>) {
  const session = await requireSession({ minRole: "ADMIN" });
  const data = updateBrandingSchema.parse(input);

  // Warn (don't block) if the primary color would fail WCAG AA against
  // white — brand guidelines already flag orange-on-white as large-text-only.
  const contrastWarning =
    contrastRatio(data.primaryColor, "#FFFFFF") < 3
      ? "This primary color has low contrast on white — use it for large/bold elements only, not body text."
      : null;

  await withRls({ tenantId: session.tenantId, userId: session.id, role: session.role }, async (tx) => {
    await tx.tenantBranding.update({
      where: { tenantId: session.tenantId },
      data: {
        productName: data.productName,
        primaryColor: data.primaryColor,
        accentColor: data.accentColor,
        logoUrl: data.logoUrl || null,
        supportEmail: data.supportEmail || null,
        emailFromName: data.emailFromName || null,
      },
    });
    await tx.auditLog.create({
      data: { tenantId: session.tenantId, actorId: session.id, action: "UPDATE_BRANDING" },
    });
  });

  revalidatePath("/admin/branding");
  revalidatePath("/", "layout");
  return { ok: true, contrastWarning };
}

/** Uploads a tenant's logo to Supabase Storage and saves the resulting public URL — see lib/storage.ts. */
export async function uploadBrandingLogo(formData: FormData) {
  const session = await requireSession({ minRole: "ADMIN" });
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false as const, error: "No file provided." };

  const ext = file.name.split(".").pop()?.toLowerCase() || "png";
  const result = await uploadImage("branding-logos", `${session.tenantId}/logo.${ext}`, file);
  if (!result.ok) return { ok: false as const, error: result.error };

  // Fixed storage path (upsert) means the public URL never changes, so a
  // cache-busting query param is needed or browsers keep showing the old
  // logo after a re-upload.
  const url = `${result.url}?v=${Date.now()}`;

  await withRls({ tenantId: session.tenantId, userId: session.id, role: session.role }, (tx) =>
    tx.tenantBranding.update({ where: { tenantId: session.tenantId }, data: { logoUrl: url } })
  );

  revalidatePath("/admin/branding");
  revalidatePath("/", "layout");
  return { ok: true as const, url };
}

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------

export async function listAuditLog(filter: Partial<z.infer<typeof auditLogFilterSchema>> = {}) {
  const session = await requireSession({ minRole: "ADMIN" });
  const f = auditLogFilterSchema.parse(filter);
  const PAGE_SIZE = 50;

  return withRls({ tenantId: session.tenantId, userId: session.id, role: session.role }, (tx) =>
    tx.auditLog.findMany({
      where: { tenantId: session.tenantId, action: f.action },
      include: { actor: true, ticket: true },
      orderBy: { createdAt: "desc" },
      skip: (f.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    })
  );
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

export async function getReportStats() {
  const session = await requireSession({ minRole: "ADMIN" });

  return withRls({ tenantId: session.tenantId, userId: session.id, role: session.role }, async (tx) => {
    const tenantId = session.tenantId;
    // Sequential, not Promise.all: these all run on this one interactive-tx
    // connection, so concurrent issue is unsupported by Prisma (and gives no
    // real parallelism anyway — a single connection serializes them regardless).
    const byStatus = await tx.ticket.groupBy({ by: ["status"], where: { tenantId }, _count: true });
    const byPriority = await tx.ticket.groupBy({ by: ["priority"], where: { tenantId }, _count: true });
    const total = await tx.ticket.count({ where: { tenantId } });
    const unassigned = await tx.ticket.count({
      where: { tenantId, assignedToId: null, status: { notIn: ["RESOLVED", "CLOSED"] } },
    });
    const tickets = await tx.ticket.findMany({
      where: { tenantId, firstReplyAt: { not: null } },
      select: { createdAt: true, firstReplyAt: true },
    });

    const avgFirstResponseHours =
      tickets.length > 0
        ? Math.max(
            0,
            tickets.reduce((sum, t) => sum + (t.firstReplyAt!.getTime() - t.createdAt.getTime()), 0) /
              tickets.length /
              (1000 * 60 * 60)
          )
        : null;

    return {
      total,
      unassigned,
      byStatus: Object.fromEntries(byStatus.map((s) => [s.status, s._count])),
      byPriority: Object.fromEntries(byPriority.map((p) => [p.priority, p._count])),
      avgFirstResponseHours,
    };
  });
}
