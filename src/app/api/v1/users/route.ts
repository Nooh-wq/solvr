// M7.2 — GET /api/v1/users — scope `users:read`
// M7.3 — POST /api/v1/users — scope `users:write`

import { NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler, apiError } from "@/lib/api/request";
import { withApiRls } from "@/lib/api/auth";
import { endUserToDto, teamMemberToDto } from "@/lib/api/dto";
import { emitUserEvent } from "@/lib/webhooks";

export const GET = apiHandler({
  scope: "users:read",
  handler: async (ctx, req) => {
    const url = new URL(req.url);
    const page = Math.max(1, Number(url.searchParams.get("page") ?? "1"));
    const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get("pageSize") ?? "25")));
    const kind = url.searchParams.get("kind"); // "TEAM_MEMBER" | "END_USER" | null

    const { total, rows } = await withApiRls(ctx, async (tx) => {
      if (kind === "TEAM_MEMBER") {
        const [total, rows] = await Promise.all([
          tx.teamMember.count({ where: { tenantId: ctx.tenantId } }),
          tx.teamMember.findMany({
            where: { tenantId: ctx.tenantId },
            orderBy: { createdAt: "asc" },
            skip: (page - 1) * pageSize,
            take: pageSize,
          }),
        ]);
        return { total, rows: rows.map(teamMemberToDto) };
      }
      // Default: end users
      const [total, rows] = await Promise.all([
        tx.endUser.count({ where: { tenantId: ctx.tenantId } }),
        tx.endUser.findMany({
          where: { tenantId: ctx.tenantId },
          orderBy: { createdAt: "asc" },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
      ]);
      return { total, rows: rows.map(endUserToDto) };
    });

    return NextResponse.json({ data: rows, pagination: { page, pageSize, total } });
  },
});

const createUserSchema = z.object({
  email: z.string().email(),
  name: z.string().optional(),
  kind: z.enum(["END_USER", "TEAM_MEMBER"]).default("END_USER"),
  roleName: z.string().optional(), // required for TEAM_MEMBER
});

export const POST = apiHandler({
  scope: "users:write",
  handler: async (ctx, req) => {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return apiError(400, "invalid_body", "Body must be JSON");
    }
    const parsed = createUserSchema.safeParse(body);
    if (!parsed.success) return apiError(400, "invalid_body", parsed.error.issues[0]?.message ?? "Invalid body");

    const created = await withApiRls(ctx, async (tx) => {
      if (parsed.data.kind === "TEAM_MEMBER") {
        if (!parsed.data.roleName) return { err: "roleName is required for TEAM_MEMBER" as const };
        const role = await tx.role.findFirst({
          where: { tenantId: ctx.tenantId, name: parsed.data.roleName },
        });
        if (!role) return { err: `Role "${parsed.data.roleName}" not found` as const };
        const tm = await tx.teamMember.create({
          data: {
            tenantId: ctx.tenantId,
            email: parsed.data.email,
            name: parsed.data.name ?? null,
            roleId: role.id,
          },
        });
        await tx.teamMemberLifecycle.create({
          data: { subjectId: tm.id, tenantId: ctx.tenantId, status: "INVITED" },
        });
        await tx.authCredential.create({
          data: {
            tenantId: ctx.tenantId,
            subjectTeamMemberId: tm.id,
            passwordHash: "",
          },
        });
        return { dto: teamMemberToDto(tm) };
      }
      const eu = await tx.endUser.create({
        data: {
          tenantId: ctx.tenantId,
          email: parsed.data.email,
          name: parsed.data.name ?? null,
        },
      });
      await tx.endUserLifecycle.create({
        data: { subjectId: eu.id, tenantId: ctx.tenantId, status: "ACTIVE", approvedAt: new Date() },
      });
      return { dto: endUserToDto(eu) };
    });
    if ("err" in created) return apiError(400, "invalid_body", created.err ?? "Invalid input");

    void emitUserEvent(ctx.tenantId, "user.created", created.dto);
    return NextResponse.json(created.dto, { status: 201 });
  },
});
