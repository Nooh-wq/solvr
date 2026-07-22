// M7.2 — GET /api/v1/tickets/{reference} — scope `tickets:read`
// M7.3 — PATCH /api/v1/tickets/{reference} — scope `tickets:write`

import { NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler, apiError } from "@/lib/api/request";
import { withApiRls } from "@/lib/api/auth";
import { ticketToDto } from "@/lib/api/dto";
import { emitTicketEvent } from "@/lib/webhooks";

async function findByRef(ctx: Parameters<Parameters<typeof apiHandler>[0]["handler"]>[0], reference: string) {
  return withApiRls(ctx, (tx) =>
    tx.ticket.findFirst({ where: { tenantId: ctx.tenantId, reference } })
  );
}

// Route-handler signature workaround: Next 16's typed handlers with params
// vs the apiHandler wrapper. We hand-inline the param extraction from the
// URL rather than fight the type plumbing.
export async function GET(req: Request, { params }: { params: Promise<{ reference: string }> }) {
  const { reference } = await params;
  return apiHandler({
    scope: "tickets:read",
    handler: async (ctx) => {
      const t = await findByRef(ctx, reference);
      if (!t) return apiError(404, "not_found", `Ticket ${reference} not found`);
      return NextResponse.json(ticketToDto(t));
    },
  })(req);
}

const patchSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().min(1).optional(),
  status: z.enum(["OPEN", "IN_PROGRESS", "PENDING", "RESOLVED", "CLOSED"]).optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ reference: string }> }) {
  const { reference } = await params;
  return apiHandler({
    scope: "tickets:write",
    handler: async (ctx) => {
      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return apiError(400, "invalid_body", "Body must be JSON");
      }
      const parsed = patchSchema.safeParse(body);
      if (!parsed.success) return apiError(400, "invalid_body", parsed.error.issues[0]?.message ?? "Invalid body");

      const updated = await withApiRls(ctx, async (tx) => {
        const existing = await tx.ticket.findFirst({
          where: { tenantId: ctx.tenantId, reference },
        });
        if (!existing) return null;
        const wasResolved = existing.status === "RESOLVED";
        const nextStatus = parsed.data.status ?? existing.status;
        return tx.ticket.update({
          where: { id: existing.id },
          data: {
            ...(parsed.data.title !== undefined ? { title: parsed.data.title } : {}),
            ...(parsed.data.description !== undefined ? { description: parsed.data.description } : {}),
            ...(parsed.data.status !== undefined ? { status: parsed.data.status } : {}),
            ...(parsed.data.priority !== undefined ? { priority: parsed.data.priority } : {}),
            ...(parsed.data.status === "RESOLVED" && !wasResolved ? { resolvedAt: new Date() } : {}),
            ...(parsed.data.status && parsed.data.status !== "RESOLVED" && wasResolved ? { resolvedAt: null } : {}),
            updatedAt: new Date(),
          },
        });
      });
      if (!updated) return apiError(404, "not_found", `Ticket ${reference} not found`);

      // Fire status-transition events.
      if (parsed.data.status === "RESOLVED") {
        void emitTicketEvent(ctx.tenantId, "ticket.resolved", ticketToDto(updated));
      } else if (parsed.data.status) {
        void emitTicketEvent(ctx.tenantId, "ticket.updated", ticketToDto(updated));
      }
      return NextResponse.json(ticketToDto(updated));
    },
  })(req);
}
