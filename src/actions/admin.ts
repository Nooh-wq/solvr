"use server";

import { revalidatePath } from "next/cache";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { Prisma } from "@/generated/prisma";
import { withRls } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { sendUserInviteEmail, sendRegistrationApprovedEmail, sendRegistrationRejectedEmail } from "@/lib/email/events";
import { contrastRatio } from "@/lib/color";
import { notify } from "@/lib/notifications";
import { uploadImage } from "@/lib/storage";
import { signInviteToken } from "@/lib/session";
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

type InviteUserResult = { ok: true } | { ok: false; error: string };

/**
 * Admin creates a user directly with status INVITED — a placeholder password
 * hash goes in (random, never emailed, unusable) since the column can't be
 * null, but nobody can actually log in with it: login() rejects INVITED
 * accounts outright. Instead this emails an accept-invite link; the user
 * sets their own password there and verifies a one-time emailed code before
 * their first session is ever created (see acceptInvite()/verifyLoginOtp()
 * in actions/auth.ts). Admin-invited users skip the registration approval
 * gate — the admin creating them *is* the approval.
 */
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

  const placeholderHash = await bcrypt.hash(generateTempPassword(), 10);

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
            passwordHash: placeholderHash,
            status: "INVITED",
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

  const inviteToken = await signInviteToken({ userId: user.id, tenantId: session.tenantId });
  const acceptUrl = `${process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"}/auth/invite/accept?token=${encodeURIComponent(inviteToken)}`;
  await sendUserInviteEmail(user.email, acceptUrl, branding);

  revalidatePath("/admin/team");
  return { ok: true };
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

/**
 * Permanently removes a user. `tickets.clientId` is `ON DELETE RESTRICT`
 * (see prisma/migrations/20260701012236_init), so this fails cleanly with a
 * clear message for any CLIENT who has ever opened a ticket — deleting them
 * would either silently orphan that ticket's history or require deciding
 * what to do with it, neither of which "delete a person" should do
 * implicitly. Agents/admins delete cleanly even with history: their
 * `messages.senderId`/`audit_logs.actorId`/`tickets.assignedToId` references
 * are all `ON DELETE SET NULL`, the same "this person left" behavior the
 * schema already uses.
 */
export async function deleteUser(input: z.infer<typeof userIdSchema>): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await requireSession({ minRole: "ADMIN" });
  const data = userIdSchema.parse(input);
  if (data.userId === session.id) return { ok: false, error: "You can't delete your own account." };

  try {
    return await withRls({ tenantId: session.tenantId, userId: session.id, role: session.role }, async (tx) => {
      const target = await tx.user.findFirst({ where: { id: data.userId, tenantId: session.tenantId } });
      if (!target) return { ok: false, error: "User not found." };

      await tx.auditLog.create({
        data: { tenantId: session.tenantId, actorId: session.id, action: "DELETE_USER", toValue: target.email },
      });
      await tx.user.delete({ where: { id: target.id } });

      revalidatePath("/admin/team");
      return { ok: true };
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2003") {
      return { ok: false, error: "Can't delete — this person still has tickets on record. Deactivate them instead." };
    }
    throw e;
  }
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

/**
 * Uploads a tenant's logo image to Supabase Storage and returns its public
 * URL — WITHOUT persisting it to the branding record. Persisting only happens
 * when the admin clicks "Save branding" (updateBranding writes logoUrl), so
 * the returned URL is purely staged into the form's live preview until then.
 *
 * Two things make that "stage, don't apply" guarantee hold:
 *   1. No tenantBranding.update / revalidate here — the DB (and therefore the
 *      live platform) is untouched by an upload alone.
 *   2. A unique, timestamped object path per upload instead of a fixed
 *      "logo.<ext>" upsert path — otherwise the new file would overwrite the
 *      object the *currently-saved* logoUrl still points to, changing the live
 *      logo even without a DB write. (Previously both were violated, which is
 *      why a logo went live before Save was ever clicked.)
 */
export async function uploadBrandingLogo(formData: FormData) {
  const session = await requireSession({ minRole: "ADMIN" });
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false as const, error: "No file provided." };

  const ext = file.name.split(".").pop()?.toLowerCase() || "png";
  const result = await uploadImage("branding-logos", `${session.tenantId}/logo-${Date.now()}.${ext}`, file);
  if (!result.ok) return { ok: false as const, error: result.error };

  return { ok: true as const, url: result.url };
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

    // 30-day daily series for the "tickets over time" chart. Two lightweight
    // queries (created and resolved separately, since a ticket resolved in the
    // window may have been created before it) bucketed by local calendar day.
    const DAYS = 30;
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - (DAYS - 1));

    const createdRows = await tx.ticket.findMany({
      where: { tenantId, createdAt: { gte: start } },
      select: { createdAt: true },
    });
    const resolvedRows = await tx.ticket.findMany({
      where: { tenantId, resolvedAt: { gte: start } },
      select: { resolvedAt: true },
    });

    const dayKey = (d: Date) => {
      const x = new Date(d);
      x.setHours(0, 0, 0, 0);
      return x.toISOString().slice(0, 10);
    };
    const createdByDay = new Map<string, number>();
    for (const r of createdRows) createdByDay.set(dayKey(r.createdAt), (createdByDay.get(dayKey(r.createdAt)) ?? 0) + 1);
    const resolvedByDay = new Map<string, number>();
    for (const r of resolvedRows) {
      if (!r.resolvedAt) continue;
      resolvedByDay.set(dayKey(r.resolvedAt), (resolvedByDay.get(dayKey(r.resolvedAt)) ?? 0) + 1);
    }

    const dailySeries = Array.from({ length: DAYS }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const key = d.toISOString().slice(0, 10);
      return { date: key, created: createdByDay.get(key) ?? 0, resolved: resolvedByDay.get(key) ?? 0 };
    });

    return {
      total,
      unassigned,
      byStatus: Object.fromEntries(byStatus.map((s) => [s.status, s._count])),
      byPriority: Object.fromEntries(byPriority.map((p) => [p.priority, p._count])),
      avgFirstResponseHours,
      dailySeries,
    };
  });
}
