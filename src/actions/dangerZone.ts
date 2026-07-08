"use server";

// M21.6 — the three Danger Zone actions.
//
//   * requestDataExport         — creates a PENDING row and triggers the
//                                 build-data-export Inngest event; the job
//                                 fills payload + expiresAt + emails a link.
//   * selfDeactivateAccount     — flips lifecycle to SUSPENDED and deletes
//                                 every UserSession row for the caller so
//                                 they're signed out on next request. The
//                                 last-Super-Admin guard blocks it for the
//                                 sole SA on the tenant.
//   * requestAccountDeletion    — creates a PENDING AccountDeletionRequest
//                                 row for the admin queue. Same last-SA
//                                 preflight so a doomed request never lands.

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { withRls } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { inngest } from "@/lib/inngest/client";

// Kept in sync with the same constant in src/lib/shared-platform/team-members.ts —
// the wrapper module doesn't export it; the role name is stable enough that
// duplicating it here is fine (a rename would break both places at once).
const SUPER_ADMIN_ROLE_NAME = "Super Admin";

async function isLastSuperAdmin(tenantId: string, subjectId: string): Promise<boolean> {
  return withRls({ tenantId, userId: subjectId, role: "SUPER_ADMIN" }, async (tx) => {
    const superAdminRole = await tx.role.findFirst({
      where: { tenantId, name: SUPER_ADMIN_ROLE_NAME },
    });
    if (!superAdminRole) return false;
    const me = await tx.teamMember.findFirst({
      where: { id: subjectId, tenantId, roleId: superAdminRole.id },
    });
    if (!me) return false; // not a SA at all
    const count = await tx.teamMember.count({
      where: { tenantId, roleId: superAdminRole.id },
    });
    return count <= 1;
  });
}

export async function requestDataExport(): Promise<
  { ok: true; requestId: string } | { error: string }
> {
  const session = await requireSession();
  const request = await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    (tx) =>
      tx.dataExportRequest.create({
        data: {
          tenantId: session.tenantId,
          subjectId: session.subjectId,
          status: "PENDING",
        },
      })
  );
  // Fire the Inngest event so the job picks it up and does the work
  // (collect data, sign token, email link). Local dev needs
  // `npx inngest-cli dev` running for the event to actually fire — the
  // action still succeeds if it isn't (row stays PENDING; can be
  // re-drained manually or on next inngest-cli startup).
  try {
    await inngest.send({
      name: "danger-zone/data-export.requested",
      data: {
        requestId: request.id,
        tenantId: session.tenantId,
        subjectId: session.subjectId,
      },
    });
  } catch {
    // Non-fatal — the request row is already created; a follow-up drain
    // can pick it up.
  }
  revalidatePath("/", "layout");
  return { ok: true, requestId: request.id };
}

export async function selfDeactivateAccount(): Promise<{ ok: true } | { error: string }> {
  const session = await requireSession();
  if (session.role !== "CLIENT") {
    if (await isLastSuperAdmin(session.tenantId, session.subjectId)) {
      return {
        error:
          "You're the only Super Admin on this workspace. Promote another Super Admin before deactivating your own account.",
      };
    }
  }

  await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      if (session.role === "CLIENT") {
        await tx.endUserLifecycle.update({
          where: { subjectId: session.subjectId },
          data: { status: "SUSPENDED" },
        });
      } else {
        await tx.teamMemberLifecycle.update({
          where: { subjectId: session.subjectId },
          data: { status: "SUSPENDED" },
        });
      }
      // Kill every UserSession row so the getSessionUser lookup rejects
      // this cookie (and every other device's cookie) on the next request.
      await tx.userSession.deleteMany({
        where: { tenantId: session.tenantId, subjectId: session.subjectId },
      });
    }
  );
  revalidatePath("/", "layout");
  return { ok: true };
}

const deletionSchema = z.object({ reason: z.string().max(2000).optional() });

export async function requestAccountDeletion(input: z.infer<typeof deletionSchema>): Promise<
  { ok: true } | { error: string }
> {
  const session = await requireSession();
  const parsed = deletionSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input." };

  if (session.role !== "CLIENT") {
    if (await isLastSuperAdmin(session.tenantId, session.subjectId)) {
      return {
        error:
          "You're the only Super Admin on this workspace. Promote another Super Admin before requesting deletion.",
      };
    }
  }

  await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      // Coalesce: if the user already has a PENDING request, don't stack
      // duplicates. Admin sees one entry to approve/reject.
      const existing = await tx.accountDeletionRequest.findFirst({
        where: {
          tenantId: session.tenantId,
          subjectId: session.subjectId,
          status: "PENDING",
        },
      });
      if (existing) {
        if (parsed.data.reason !== undefined) {
          await tx.accountDeletionRequest.update({
            where: { id: existing.id },
            data: { reason: parsed.data.reason || null },
          });
        }
        return;
      }
      await tx.accountDeletionRequest.create({
        data: {
          tenantId: session.tenantId,
          subjectId: session.subjectId,
          reason: parsed.data.reason || null,
        },
      });
    }
  );
  revalidatePath("/admin/account-deletions");
  return { ok: true };
}

export type DataExportRequestSummary = {
  id: string;
  status: string;
  expiresAt: Date | null;
  createdAt: Date;
};

export async function listMyDataExports(): Promise<DataExportRequestSummary[]> {
  const session = await requireSession();
  return withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    (tx) =>
      tx.dataExportRequest.findMany({
        where: { tenantId: session.tenantId, subjectId: session.subjectId },
        orderBy: { createdAt: "desc" },
        take: 5,
        select: { id: true, status: true, expiresAt: true, createdAt: true },
      })
  );
}

export async function myPendingDeletionRequest(): Promise<
  { id: string; createdAt: Date } | null
> {
  const session = await requireSession();
  const row = await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    (tx) =>
      tx.accountDeletionRequest.findFirst({
        where: {
          tenantId: session.tenantId,
          subjectId: session.subjectId,
          status: "PENDING",
        },
        select: { id: true, createdAt: true },
      })
  );
  return row;
}
