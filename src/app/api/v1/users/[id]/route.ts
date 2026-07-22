// M7.2 — GET /api/v1/users/{id} — scope `users:read`
// M7.3 — PATCH /api/v1/users/{id} — scope `users:write`

import { NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler, apiError } from "@/lib/api/request";
import { withApiRls } from "@/lib/api/auth";
import { endUserToDto, teamMemberToDto } from "@/lib/api/dto";
import { emitUserEvent } from "@/lib/webhooks";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return apiHandler({
    scope: "users:read",
    handler: async (ctx) => {
      const result = await withApiRls(ctx, async (tx) => {
        const tm = await tx.teamMember.findFirst({ where: { id, tenantId: ctx.tenantId } });
        if (tm) return teamMemberToDto(tm);
        const eu = await tx.endUser.findFirst({ where: { id, tenantId: ctx.tenantId } });
        return eu ? endUserToDto(eu) : null;
      });
      if (!result) return apiError(404, "not_found", `User ${id} not found`);
      return NextResponse.json(result);
    },
  })(req);
}

const patchSchema = z.object({
  name: z.string().optional(),
  email: z.string().email().optional(),
  roleName: z.string().optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return apiHandler({
    scope: "users:write",
    handler: async (ctx) => {
      let body: unknown;
      try { body = await req.json(); } catch { return apiError(400, "invalid_body", "Body must be JSON"); }
      const parsed = patchSchema.safeParse(body);
      if (!parsed.success) return apiError(400, "invalid_body", parsed.error.issues[0]?.message ?? "Invalid body");

      const result = await withApiRls(ctx, async (tx) => {
        const tm = await tx.teamMember.findFirst({ where: { id, tenantId: ctx.tenantId } });
        if (tm) {
          let roleId = tm.roleId;
          if (parsed.data.roleName) {
            const role = await tx.role.findFirst({ where: { tenantId: ctx.tenantId, name: parsed.data.roleName } });
            if (!role) return { err: `Role "${parsed.data.roleName}" not found` as const };
            roleId = role.id;
          }
          const updated = await tx.teamMember.update({
            where: { id },
            data: {
              ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
              ...(parsed.data.email !== undefined ? { email: parsed.data.email } : {}),
              roleId,
            },
          });
          return { dto: teamMemberToDto(updated) };
        }
        const eu = await tx.endUser.findFirst({ where: { id, tenantId: ctx.tenantId } });
        if (!eu) return null;
        const updated = await tx.endUser.update({
          where: { id },
          data: {
            ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
            ...(parsed.data.email !== undefined ? { email: parsed.data.email } : {}),
          },
        });
        return { dto: endUserToDto(updated) };
      });
      if (result === null) return apiError(404, "not_found", `User ${id} not found`);
      if ("err" in result) return apiError(400, "invalid_body", result.err ?? "Invalid input");

      void emitUserEvent(ctx.tenantId, "user.updated", result.dto);
      return NextResponse.json(result.dto);
    },
  })(req);
}
