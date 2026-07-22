// M6.5/M6.6 — SCIM /Users/{id}: PATCH updates, DELETE deprovisions.
//
// PATCH body per RFC 7644 §3.5.2:
//   { schemas: [...], Operations: [{ op, path, value }] }
// Supports the common "active: false" deactivation path.
//
// DELETE per spec §3.6 sets active=false (equivalent to soft-delete).
// Semantically: sets lifecycle to DEACTIVATED and revokes all sessions.

import { NextResponse } from "next/server";
import { withRls } from "@/lib/db";
import { verifyScimBearer } from "@/lib/auth/scim-auth";
import { checkRateLimitWithIp } from "@/lib/rate-limit";

function scimError(status: number, detail: string) {
  return NextResponse.json(
    {
      schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
      detail,
      status: String(status),
    },
    { status, headers: { "content-type": "application/scim+json" } }
  );
}

async function deactivateSubject(tenantId: string, subjectId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  return withRls(
    { tenantId, userId: null, role: "SUPER_ADMIN" },
    async (tx) => {
      const target = await tx.teamMember.findFirst({
        where: { id: subjectId, tenantId },
        include: { role: { select: { name: true } } },
      });
      if (!target) return { ok: false as const, error: "User not found" };

      // M6 §3 spec: "Do NOT allow a Super Admin's SCIM-provisioned account
      // to override the last-Super-Admin lockout guard. Deprovisioning the
      // last Super Admin via SCIM must fail with a clear error, not
      // silently delete the tenant's admin access."
      if (target.role.name === "Super Admin") {
        // Find every OTHER Super Admin in this tenant, then filter to
        // ACTIVE via TeamMemberLifecycle (no schema relation).
        const otherSuperAdmins = await tx.teamMember.findMany({
          where: {
            tenantId,
            role: { name: "Super Admin" },
            id: { not: subjectId },
          },
          select: { id: true },
        });
        const activeLifecycles = await tx.teamMemberLifecycle.count({
          where: {
            subjectId: { in: otherSuperAdmins.map((t) => t.id) },
            status: "ACTIVE",
          },
        });
        if (activeLifecycles === 0) {
          return {
            ok: false as const,
            error: "Refusing to deprovision the last active Super Admin — the tenant would lose all admin access.",
          };
        }
      }

      // Deactivate lifecycle.
      await tx.teamMemberLifecycle.upsert({
        where: { subjectId: target.id },
        create: { subjectId: target.id, tenantId, status: "SUSPENDED" },
        update: { status: "SUSPENDED" },
      });

      // Revoke every UserSession for this subject.
      await tx.userSession.deleteMany({
        where: { subjectId: target.id, tenantId },
      });
      return { ok: true as const };
    }
  );
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const auth = await verifyScimBearer(req.headers.get("authorization"));
  if (!auth.ok) return scimError(auth.status, auth.error);
  const rate = await checkRateLimitWithIp(`scim:${auth.tokenId}`, 60, 10, 10_000);
  if (!rate.allowed) return scimError(429, "Too many requests");

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return scimError(400, "Invalid JSON body");
  }
  const ops = body.Operations as Array<{ op?: string; path?: string; value?: unknown }> | undefined;
  if (!Array.isArray(ops) || ops.length === 0) {
    return scimError(400, "Missing or empty Operations array");
  }

  // Interpret the common shapes: {op:"replace", path:"active", value:false}
  // and {op:"replace", value:{active:false}}.
  for (const op of ops) {
    if (op.op?.toLowerCase() !== "replace") continue;
    let active: boolean | undefined;
    if (op.path === "active") active = op.value === false || op.value === "False" || op.value === "false" ? false : true;
    else if (op.value && typeof op.value === "object" && "active" in (op.value as Record<string, unknown>)) {
      active = (op.value as { active: boolean }).active;
    }
    if (active === false) {
      const r = await deactivateSubject(auth.tenantId, id);
      if (!r.ok) return scimError(400, r.error);
    }
    if (active === true) {
      await withRls(
        { tenantId: auth.tenantId, userId: null, role: "SUPER_ADMIN" },
        (tx) =>
          tx.teamMemberLifecycle.upsert({
            where: { subjectId: id },
            create: { subjectId: id, tenantId: auth.tenantId, status: "ACTIVE", approvedAt: new Date() },
            update: { status: "ACTIVE", approvedAt: new Date() },
          })
      );
    }
  }

  return new NextResponse(null, { status: 204 });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const auth = await verifyScimBearer(req.headers.get("authorization"));
  if (!auth.ok) return scimError(auth.status, auth.error);
  const rate = await checkRateLimitWithIp(`scim:${auth.tokenId}`, 60, 10, 10_000);
  if (!rate.allowed) return scimError(429, "Too many requests");

  const r = await deactivateSubject(auth.tenantId, id);
  if (!r.ok) return scimError(400, r.error);

  return new NextResponse(null, { status: 204 });
}
