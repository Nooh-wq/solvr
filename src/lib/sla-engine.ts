import { Prisma } from "@/generated/prisma";
import type { Priority } from "@/generated/prisma";
import { withRls } from "@/lib/db";
import type { UserRole } from "@/lib/auth";
import { computeDueAt } from "@/lib/business-hours";
import {
  slaTargetsSchema,
  weeklyHoursSchema,
  holidaysSchema,
  type SlaTargets,
  type WeeklyHours,
} from "@/lib/sla-schema";

// M2.2/2.4 — SLA engine. All write paths for TicketSla go through here
// so the graceful-degradation contract in the spec's §3 is enforced
// centrally: if no policy or calendar can be resolved for a ticket, we
// write nothing — the read paths render nothing, no placeholder.
//
// The functions are pure w.r.t. side effects: each opens its own
// withRls transaction under the caller's session. Callers are ticket
// mutation actions (createTicket, updateTicket, postClientReply,
// postAgentReply) plus the sla.tick cron in inngest.

// ---------------------------------------------------------------------------
// Policy + calendar resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the SlaPolicy that applies to a ticket. Priority order:
 *  1. Organization override (if the ticket has an org and its
 *     OrganizationSettings.slaPolicyId is set)
 *  2. Tenant default policy (isDefault=true, active=true)
 *  3. First active policy
 *  4. null — spec §3: graceful degradation.
 */
export async function resolveSlaPolicy(
  tx: Prisma.TransactionClient,
  params: { tenantId: string; ticket: { organizationId: string | null } }
): Promise<{
  id: string;
  targets: SlaTargets;
} | null> {
  if (params.ticket.organizationId) {
    const settings = await tx.organizationSettings.findFirst({
      where: { organizationId: params.ticket.organizationId, tenantId: params.tenantId },
      select: { slaPolicyId: true },
    });
    if (settings?.slaPolicyId) {
      const policy = await tx.slaPolicy.findFirst({
        where: { id: settings.slaPolicyId, tenantId: params.tenantId, active: true },
        select: { id: true, targets: true },
      });
      const parsed = policy ? slaTargetsSchema.safeParse(policy.targets) : null;
      if (policy && parsed?.success) return { id: policy.id, targets: parsed.data };
    }
  }
  const def = await tx.slaPolicy.findFirst({
    where: { tenantId: params.tenantId, active: true, isDefault: true },
    select: { id: true, targets: true },
  });
  if (def) {
    const parsed = slaTargetsSchema.safeParse(def.targets);
    if (parsed.success) return { id: def.id, targets: parsed.data };
  }
  const any = await tx.slaPolicy.findFirst({
    where: { tenantId: params.tenantId, active: true },
    select: { id: true, targets: true },
    orderBy: { createdAt: "asc" },
  });
  if (any) {
    const parsed = slaTargetsSchema.safeParse(any.targets);
    if (parsed.success) return { id: any.id, targets: parsed.data };
  }
  return null;
}

/**
 * Resolve the BusinessCalendar to use for a ticket. Same priority
 * order as policies: org override → tenant default → first → null.
 */
export async function resolveBusinessCalendar(
  tx: Prisma.TransactionClient,
  params: { tenantId: string; ticket: { organizationId: string | null } }
): Promise<{
  timezone: string;
  weeklyHours: WeeklyHours;
  holidays: string[];
} | null> {
  const shape = (c: {
    timezone: string;
    weeklyHours: Prisma.JsonValue;
    holidays: Prisma.JsonValue;
  }) => {
    const wh = weeklyHoursSchema.safeParse(c.weeklyHours);
    const hol = holidaysSchema.safeParse(c.holidays);
    if (!wh.success || !hol.success) return null;
    return { timezone: c.timezone, weeklyHours: wh.data, holidays: hol.data };
  };
  if (params.ticket.organizationId) {
    const settings = await tx.organizationSettings.findFirst({
      where: { organizationId: params.ticket.organizationId, tenantId: params.tenantId },
      select: { businessHoursId: true },
    });
    if (settings?.businessHoursId) {
      const cal = await tx.businessCalendar.findFirst({
        where: { id: settings.businessHoursId, tenantId: params.tenantId },
        select: { timezone: true, weeklyHours: true, holidays: true },
      });
      const s = cal ? shape(cal) : null;
      if (s) return s;
    }
  }
  const def = await tx.businessCalendar.findFirst({
    where: { tenantId: params.tenantId, isDefault: true },
    select: { timezone: true, weeklyHours: true, holidays: true },
  });
  const defShape = def ? shape(def) : null;
  if (defShape) return defShape;
  const any = await tx.businessCalendar.findFirst({
    where: { tenantId: params.tenantId },
    select: { timezone: true, weeklyHours: true, holidays: true },
    orderBy: { createdAt: "asc" },
  });
  return any ? shape(any) : null;
}

// ---------------------------------------------------------------------------
// Write TicketSla rows on ticket creation
// ---------------------------------------------------------------------------

export type SlaEngineSession = {
  tenantId: string;
  subjectId: string | null;
  role: UserRole;
};

/**
 * Called after a ticket is created. Idempotent — safe to call again if
 * the SLA config changes and admins want to re-materialize (though we
 * currently don't wire that path).
 */
export async function applySlaToNewTicket(params: {
  session: SlaEngineSession;
  ticketId: string;
}): Promise<void> {
  const { session, ticketId } = params;
  await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const ticket = await tx.ticket.findFirst({
        where: { id: ticketId, tenantId: session.tenantId },
        select: { id: true, priority: true, organizationId: true, createdAt: true },
      });
      if (!ticket) return;
      const policy = await resolveSlaPolicy(tx, {
        tenantId: session.tenantId,
        ticket: { organizationId: ticket.organizationId },
      });
      if (!policy) return; // Graceful degradation — spec §3.
      const cal = await resolveBusinessCalendar(tx, {
        tenantId: session.tenantId,
        ticket: { organizationId: ticket.organizationId },
      });
      const targets = policy.targets[ticket.priority as Priority];
      // Use `new Date()` — the current UTC instant — as start rather
      // than `ticket.createdAt`. applySlaToNewTicket runs
      // milliseconds after the ticket insert, so the two are
      // effectively the same moment. This dodges a Prisma quirk
      // where DateTime columns on non-timestamptz Postgres types
      // pick up the connection's timezone offset on read (see:
      // Ticket.createdAt is `timestamp(3)`, not `timestamptz(3)`),
      // which was shifting the walker's start by the server's
      // system tz and producing next-day dueAt values.
      const start = new Date();
      const rows: Array<{
        kind: "FIRST_RESPONSE" | "RESOLUTION";
        targetMins: number;
        dueAt: Date;
      }> = [];
      if (targets.firstResponseMins) {
        const due = cal
          ? computeDueAt({ start, targetMins: targets.firstResponseMins, calendar: cal })
          : new Date(start.getTime() + targets.firstResponseMins * 60_000);
        rows.push({ kind: "FIRST_RESPONSE", targetMins: targets.firstResponseMins, dueAt: due });
      }
      if (targets.resolutionMins) {
        const due = cal
          ? computeDueAt({ start, targetMins: targets.resolutionMins, calendar: cal })
          : new Date(start.getTime() + targets.resolutionMins * 60_000);
        rows.push({ kind: "RESOLUTION", targetMins: targets.resolutionMins, dueAt: due });
      }
      for (const r of rows) {
        await tx.ticketSla.upsert({
          where: { ticketId_kind: { ticketId, kind: r.kind } },
          create: {
            tenantId: session.tenantId,
            ticketId,
            slaPolicyId: policy.id,
            kind: r.kind,
            targetMins: r.targetMins,
            startedAt: start,
            dueAt: r.dueAt,
          },
          update: {},
        });
      }
    }
  );
}

// ---------------------------------------------------------------------------
// Pause / resume (M2.4)
// ---------------------------------------------------------------------------

/**
 * Called when a ticket transitions INTO PENDING. Marks every open
 * (unsatisfied) TicketSla row with `pauseStartedAt = now`. If the row
 * already has a pause open (double-transition, shouldn't happen but
 * safe), we leave it.
 */
export async function pauseSlaClocks(params: { session: SlaEngineSession; ticketId: string }): Promise<void> {
  const { session, ticketId } = params;
  await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    (tx) =>
      tx.ticketSla.updateMany({
        where: {
          ticketId,
          tenantId: session.tenantId,
          satisfiedAt: null,
          pauseStartedAt: null,
        },
        data: { pauseStartedAt: new Date() },
      })
  );
}

/**
 * Called when a ticket leaves PENDING (client reply or manual agent
 * status change). Accumulates the elapsed pause into `pausedMs` and
 * clears `pauseStartedAt`. Also extends `dueAt` by the paused
 * duration — the spec's stated clock semantics.
 */
export async function resumeSlaClocks(params: { session: SlaEngineSession; ticketId: string }): Promise<void> {
  const { session, ticketId } = params;
  await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const rows = await tx.ticketSla.findMany({
        where: {
          ticketId,
          tenantId: session.tenantId,
          satisfiedAt: null,
          pauseStartedAt: { not: null },
        },
      });
      const now = Date.now();
      for (const r of rows) {
        const pausedFor = now - r.pauseStartedAt!.getTime();
        await tx.ticketSla.update({
          where: { id: r.id },
          data: {
            pausedMs: r.pausedMs + pausedFor,
            pauseStartedAt: null,
            dueAt: new Date(r.dueAt.getTime() + pausedFor),
          },
        });
      }
    }
  );
}

// ---------------------------------------------------------------------------
// Satisfy (M2.2 / spec §3)
// ---------------------------------------------------------------------------

export async function markFirstResponseSatisfied(params: {
  session: SlaEngineSession;
  ticketId: string;
  at: Date;
}): Promise<void> {
  const { session, ticketId, at } = params;
  await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    (tx) =>
      tx.ticketSla.updateMany({
        where: { ticketId, tenantId: session.tenantId, kind: "FIRST_RESPONSE", satisfiedAt: null },
        data: { satisfiedAt: at },
      })
  );
}

export async function markResolutionSatisfied(params: {
  session: SlaEngineSession;
  ticketId: string;
  at: Date;
}): Promise<void> {
  const { session, ticketId, at } = params;
  await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    (tx) =>
      tx.ticketSla.updateMany({
        where: { ticketId, tenantId: session.tenantId, kind: "RESOLUTION", satisfiedAt: null },
        data: { satisfiedAt: at },
      })
  );
}
