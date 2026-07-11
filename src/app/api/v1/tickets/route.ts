// M7.2 — GET /api/v1/tickets (list) — scope `tickets:read`
// M7.3 — POST /api/v1/tickets (create) — scope `tickets:write`

import { NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler, apiError } from "@/lib/api/request";
import { withApiRls } from "@/lib/api/auth";
import { ticketToDto } from "@/lib/api/dto";
import { emitTicketEvent } from "@/lib/webhooks";

export const GET = apiHandler({
  scope: "tickets:read",
  handler: async (ctx, req) => {
    const url = new URL(req.url);
    const page = Math.max(1, Number(url.searchParams.get("page") ?? "1"));
    const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get("pageSize") ?? "25")));

    const { total, rows } = await withApiRls(ctx, async (tx) => {
      const [total, rows] = await Promise.all([
        tx.ticket.count({ where: { tenantId: ctx.tenantId } }),
        tx.ticket.findMany({
          where: { tenantId: ctx.tenantId },
          orderBy: { createdAt: "desc" },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
      ]);
      return { total, rows };
    });

    return NextResponse.json({
      data: rows.map(ticketToDto),
      pagination: { page, pageSize, total },
    });
  },
});

const createTicketSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().min(1),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).optional(),
  requesterEmail: z.string().email(),
  requesterName: z.string().optional(),
});

export const POST = apiHandler({
  scope: "tickets:write",
  handler: async (ctx, req) => {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return apiError(400, "invalid_body", "Body must be JSON");
    }
    const parsed = createTicketSchema.safeParse(body);
    if (!parsed.success) {
      return apiError(400, "invalid_body", parsed.error.issues[0]?.message ?? "Invalid body");
    }

    const created = await withApiRls(ctx, async (tx) => {
      // Resolve requester as EndUser — create if missing.
      let endUser = await tx.endUser.findFirst({
        where: { tenantId: ctx.tenantId, email: parsed.data.requesterEmail },
      });
      if (!endUser) {
        endUser = await tx.endUser.create({
          data: {
            tenantId: ctx.tenantId,
            email: parsed.data.requesterEmail,
            name: parsed.data.requesterName ?? null,
          },
        });
        await tx.endUserLifecycle.create({
          data: { subjectId: endUser.id, tenantId: ctx.tenantId, status: "ACTIVE", approvedAt: new Date() },
        });
      }

      const ticket = await tx.ticket.create({
        data: {
          tenantId: ctx.tenantId,
          title: parsed.data.title,
          description: parsed.data.description,
          priority: parsed.data.priority ?? "MEDIUM",
          reference: `T-${Date.now().toString(36).toUpperCase()}`,
          ticketNumber: Date.now().toString(),
          clientEndUserId: endUser.id,
        },
      });
      return ticket;
    });

    // Fire the event (M7.4 will fan out to webhooks).
    void emitTicketEvent(ctx.tenantId, "ticket.created", ticketToDto(created));

    return NextResponse.json(ticketToDto(created), { status: 201 });
  },
});
