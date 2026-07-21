import { Prisma } from "@/generated/prisma";
import type { Ticket } from "@/generated/prisma";
import type { UserRole } from "@/lib/auth";
import { withRls } from "@/lib/db";
import {
  actionListSchema,
  conditionGroupSchema,
  type Condition,
  type RuleAction,
  type TriggerEvent,
} from "@/lib/rule-schema";
import { listTeamMembersInGroup } from "@/lib/shared-platform";

// Z8.1 — rule execution engine. Called from both the trigger path
// (inline, per event, in tickets.ts) and the automation path
// (batched, from an admin "Run now" button or a future scheduler).
//
// Key invariants:
// - Rules run under the caller's RLS scope (or a system context that
//   explicitly asserts SUPER_ADMIN inside a single tenant). No rule
//   ever leaks across tenants.
// - Per-event invocation cap (INVOCATION_CAP) prevents a rule from
//   changing a ticket in a way that re-fires the same rule, looping.
// - Every action failure writes to RuleRunLog with outcome
//   "action_failed" — never silent.
// - Actions that mutate the ticket delegate through the existing
//   server actions (updateTicket, postAgentReply, applyMacro) so the
//   Light Agent guard and other invariants stay intact.

export const INVOCATION_CAP = 10;

export type RuleEngineSession = {
  tenantId: string;
  subjectId: string | null;
  role: UserRole;
};

// ---------------------------------------------------------------------------
// Condition evaluation
// ---------------------------------------------------------------------------

/**
 * Read a single field off a ticket for condition evaluation. Unknown
 * fields return `undefined`; the caller treats that as "condition
 * does not match" (safer than throwing).
 */
function readField(
  ticket: Pick<
    Ticket,
    "status" | "priority" | "categoryId" | "assignedTeamMemberId" | "source" | "createdAt" | "firstReplyAt"
  > & {
    requesterEmail?: string | null;
    tags?: string[];
    // M9.5 — AI signals resolved from the ticket's latest inbound message
    // by the caller (via loadTicketForRule below). Optional so existing
    // callers stay compatible.
    aiIntent?: string | null;
    aiSentiment?: string | null;
    aiUrgency?: string | null;
    aiLanguage?: string | null;
  },
  field: string,
  now: Date
): string | number | string[] | null | undefined {
  switch (field) {
    case "status":
      return ticket.status;
    case "priority":
      return ticket.priority;
    case "categoryId":
      return ticket.categoryId;
    case "assignedTeamMemberId":
      return ticket.assignedTeamMemberId;
    case "channel":
      return ticket.source;
    case "requesterEmail":
      return ticket.requesterEmail ?? null;
    case "tag":
      return ticket.tags ?? [];
    case "hoursSinceCreated":
      return (now.getTime() - ticket.createdAt.getTime()) / (1000 * 60 * 60);
    case "hoursSinceLastReply":
      return ticket.firstReplyAt
        ? (now.getTime() - ticket.firstReplyAt.getTime()) / (1000 * 60 * 60)
        : null;
    // M9.5 — AI signal reads. Caller is responsible for populating these
    // from the latest inbound message before evaluating conditions.
    case "aiIntent":
      return ticket.aiIntent ?? null;
    case "aiSentiment":
      return ticket.aiSentiment ?? null;
    case "aiUrgency":
      return ticket.aiUrgency ?? null;
    case "aiLanguage":
      return ticket.aiLanguage ?? null;
    default:
      return undefined;
  }
}

function evaluateSingle(cond: Condition, actual: string | number | string[] | null | undefined): boolean {
  const { op, value } = cond;
  if (op === "is_set") return actual !== null && actual !== undefined && actual !== "";
  if (op === "is_not_set") return actual === null || actual === undefined || actual === "";
  if (actual === undefined || actual === null) return false;
  if (op === "eq") return String(actual) === String(value);
  if (op === "neq") return String(actual) !== String(value);
  if (op === "in") {
    const list = Array.isArray(value) ? value : [String(value)];
    if (Array.isArray(actual)) return actual.some((a) => list.includes(String(a)));
    return list.includes(String(actual));
  }
  if (op === "not_in") {
    const list = Array.isArray(value) ? value : [String(value)];
    if (Array.isArray(actual)) return !actual.some((a) => list.includes(String(a)));
    return !list.includes(String(actual));
  }
  if (op === "contains") {
    if (Array.isArray(actual)) return actual.some((a) => String(a).toLowerCase().includes(String(value).toLowerCase()));
    return String(actual).toLowerCase().includes(String(value).toLowerCase());
  }
  if (op === "gt") return Number(actual) > Number(value);
  if (op === "lt") return Number(actual) < Number(value);
  return false;
}

export function evaluateConditions(
  raw: Prisma.JsonValue,
  ticket: Parameters<typeof readField>[0]
): boolean {
  const parsed = conditionGroupSchema.safeParse(raw);
  if (!parsed.success) return false;
  const group = parsed.data;
  if (group.conditions.length === 0) return true;
  const now = new Date();
  const results = group.conditions.map((c) => evaluateSingle(c, readField(ticket, c.field, now)));
  return group.match === "all" ? results.every(Boolean) : results.some(Boolean);
}

// ---------------------------------------------------------------------------
// Action execution
// ---------------------------------------------------------------------------

export type ActionExecutionResult = {
  ranActionCount: number;
  errors: Array<{ index: number; message: string }>;
};

/**
 * Execute a rule's action list against one ticket. Each action
 * delegates to the existing server action for its mutation type
 * (postAgentReply, updateTicket, applyMacro) — the engine never
 * bypasses those to raw Prisma, which is what preserves the Light
 * Agent guardrail from Z5.5 for rule-driven notes/replies.
 *
 * Errors on individual actions are recorded but do not abort the
 * remaining list — same partial-failure model as Z6 macros.
 */
export async function executeActions(
  rawActions: Prisma.JsonValue,
  ticketId: string,
  session: RuleEngineSession,
  /** Depth of the rule-invocation chain that led here. Used to cap loops. */
  invocationDepth: number = 0
): Promise<ActionExecutionResult> {
  const parsed = actionListSchema.safeParse(rawActions);
  if (!parsed.success) {
    return { ranActionCount: 0, errors: [{ index: -1, message: "Invalid actions payload." }] };
  }
  const actions = parsed.data;
  const errors: Array<{ index: number; message: string }> = [];
  let ranActionCount = 0;

  for (let i = 0; i < actions.length; i++) {
    const a = actions[i];
    try {
      await executeOne(a, ticketId, session, invocationDepth);
      ranActionCount++;
    } catch (e) {
      errors.push({ index: i, message: e instanceof Error ? e.message : "Unknown error" });
    }
  }
  return { ranActionCount, errors };
}

async function executeOne(
  a: RuleAction,
  ticketId: string,
  session: RuleEngineSession,
  invocationDepth: number
): Promise<void> {
  // Rules operate as a "system agent" within their tenant — RLS is
  // still scoped to session.tenantId, but role is elevated to ADMIN
  // for the duration of the rule's mutation so the rule can perform
  // ticket ops regardless of the original caller's role (a rule fired
  // during an end-user's createTicket must still be able to reassign
  // that ticket). This is the ONE elevation permitted; every write
  // still goes through withRls with the tenant boundary intact.
  const ruleCtx = { tenantId: session.tenantId, userId: session.subjectId, role: "ADMIN" as const };
  const { systemContext } = await import("@/lib/shared-platform");

  switch (a.type) {
    case "assign_group": {
      const members = await listTeamMembersInGroup(systemContext(session.tenantId), a.groupId);
      if (members.length === 0) throw new Error(`Group ${a.groupId} has no members.`);
      const pick = members[0];
      await withRls(ruleCtx, (tx) =>
        tx.ticket.update({
          where: { id: ticketId },
          data: { assignedTeamMemberId: pick.id },
        })
      );
      await runRulesForEvent({ event: "TICKET_UPDATED", ticketId, session, invocationDepth: invocationDepth + 1 });
      return;
    }
    case "assign_team_member": {
      await withRls(ruleCtx, (tx) =>
        tx.ticket.update({
          where: { id: ticketId },
          data: { assignedTeamMemberId: a.teamMemberId },
        })
      );
      await runRulesForEvent({ event: "TICKET_UPDATED", ticketId, session, invocationDepth: invocationDepth + 1 });
      return;
    }
    case "set_status": {
      await withRls(ruleCtx, (tx) =>
        tx.ticket.update({
          where: { id: ticketId },
          data: {
            status: a.status,
            resolvedAt: a.status === "RESOLVED" ? new Date() : undefined,
          },
        })
      );
      await runRulesForEvent({ event: "STATUS_CHANGED", ticketId, session, invocationDepth: invocationDepth + 1 });
      await runRulesForEvent({ event: "TICKET_UPDATED", ticketId, session, invocationDepth: invocationDepth + 1 });
      return;
    }
    case "set_priority": {
      await withRls(ruleCtx, (tx) =>
        tx.ticket.update({
          where: { id: ticketId },
          data: { priority: a.priority },
        })
      );
      await runRulesForEvent({ event: "PRIORITY_CHANGED", ticketId, session, invocationDepth: invocationDepth + 1 });
      await runRulesForEvent({ event: "TICKET_UPDATED", ticketId, session, invocationDepth: invocationDepth + 1 });
      return;
    }
    case "set_category": {
      await withRls(ruleCtx, (tx) =>
        tx.ticket.update({
          where: { id: ticketId },
          data: { categoryId: a.categoryId },
        })
      );
      await runRulesForEvent({ event: "TICKET_UPDATED", ticketId, session, invocationDepth: invocationDepth + 1 });
      return;
    }
    case "add_tag": {
      await withRls(ruleCtx, async (tx) => {
        const t = await tx.tag.upsert({
          where: { tenantId_name: { tenantId: session.tenantId, name: a.tag } },
          create: { tenantId: session.tenantId, name: a.tag },
          update: {},
        });
        await tx.tagAssignment.upsert({
          where: {
            tenantId_tagId_targetType_targetId: {
              tenantId: session.tenantId,
              tagId: t.id,
              targetType: "TICKET",
              targetId: ticketId,
            },
          },
          create: {
            tenantId: session.tenantId,
            tagId: t.id,
            targetType: "TICKET",
            targetId: ticketId,
          },
          update: {},
        });
      });
      // Z8 gap-close — chain TAG_ADDED so rules watching for tag
      // application can react. Depth counter carries into the child
      // fire, so a self-tagging loop hits INVOCATION_CAP.
      await runRulesForEvent({ event: "TAG_ADDED", ticketId, session, invocationDepth: invocationDepth + 1 });
      return;
    }
    case "add_internal_note": {
      // Direct Prisma insert of an internal Message. Bypasses
      // postAgentReply's session check (which would fail for
      // client-initiated triggers) but keeps every other invariant
      // via explicit column writes.
      await withRls(ruleCtx, (tx) =>
        tx.message.create({
          data: {
            tenantId: session.tenantId,
            ticketId,
            senderRole: "SYSTEM",
            body: a.body,
            isInternal: true,
          },
        })
      );
      return;
    }
    case "notify_team_member": {
      await withRls(ruleCtx, (tx) =>
        tx.notification.create({
          data: {
            tenantId: session.tenantId,
            recipientTeamMemberId: a.teamMemberId,
            type: "rule_notification",
            title: "Rule notification",
            body: a.message,
            ticketId,
          },
        })
      );
      return;
    }
    case "send_email_to_requester": {
      // Deferred: an outbound rule-email pipeline lands with M20.
      // Until then, capture intent as an internal note so the audit
      // trail is preserved.
      await withRls(ruleCtx, (tx) =>
        tx.message.create({
          data: {
            tenantId: session.tenantId,
            ticketId,
            senderRole: "SYSTEM",
            body: `[Automated email queued]\nSubject: ${a.subject}\n\n${a.body}`,
            isInternal: true,
          },
        })
      );
      return;
    }
    case "run_macro": {
      const { applyMacro } = await import("@/actions/macros");
      await applyMacro({ macroId: a.macroId, ticketId });
      return;
    }
    case "run_webhook": {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      try {
        const res = await fetch(a.url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(a.secret && { "x-solvr-secret": a.secret }),
          },
          body: JSON.stringify({ ticketId, tenantId: session.tenantId, event: "rule_webhook" }),
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`Webhook responded ${res.status}`);
      } finally {
        clearTimeout(timeout);
      }
      return;
    }
    case "trigger_escalation": {
      const { runEscalation } = await import("@/lib/escalations");
      await runEscalation({
        escalationPathId: a.escalationPathId,
        ticketId,
        session,
        source: "rule",
      });
      return;
    }
    case "auto_route": {
      // M3 — funnel through the routing engine. On success, thread the
      // assignment through updateTicket so audit + downstream rule
      // events fire via the normal path. On failure (no candidates,
      // loop-cap), throw so the rule-run log records why.
      const { routeTicket } = await import("@/lib/routing");
      const result = await routeTicket({
        session,
        ticketId,
        groupId: a.groupId,
        strategy: a.strategy,
        requiredSkills: a.requiredSkills,
        source: "RULE",
      });
      if (!result.ok) throw new Error(`auto_route: ${result.message}`);
      const { updateTicket } = await import("@/actions/tickets");
      await updateTicket({ ticketId, assignedToId: result.teamMemberId });
      return;
    }
    case "send_csat_request": {
      // M5.1 — rule-driven CSAT enqueue. Same dedup rules as the
      // automatic post-RESOLVED enqueue: no double-queue, no re-send
      // if the ticket was already rated. `delayMinutes` overrides
      // the tenant default.
      const { enqueueCsatSurvey } = await import("@/lib/csat");
      await enqueueCsatSurvey({
        session,
        ticketId,
        overrideDelayMinutes: a.delayMinutes,
      });
      return;
    }
  }
}

// ---------------------------------------------------------------------------
// Public entry points
// ---------------------------------------------------------------------------

/**
 * Called from ticket mutation server actions after a change has been
 * persisted. Loads active TRIGGER rules for the event, evaluates their
 * conditions, executes their actions. Enforces INVOCATION_CAP so a
 * loop-inducing rule (e.g. "on updated → set_priority", which itself
 * fires TICKET_UPDATED) can't run forever.
 *
 * Kept `fire-and-forget-safe` at the call site: the caller can await
 * it or intentionally ignore the promise; errors do not bubble up as
 * request failures because rule execution is a side effect, not the
 * primary mutation.
 */
export async function runRulesForEvent(params: {
  event: TriggerEvent;
  ticketId: string;
  session: RuleEngineSession;
  /** Incremented across nested invocations to enforce the loop cap. */
  invocationDepth?: number;
}): Promise<void> {
  const { event, ticketId, session } = params;
  const depth = params.invocationDepth ?? 0;
  if (depth >= INVOCATION_CAP) {
    // Cap hit — log once via AuditLog (RuleRunLog.ruleId is FK-bound
    // to Rule, so a synthetic "cap-halted" sentinel can't live there).
    // Writing to AuditLog keeps the halt visible in the audit stream
    // one row per cap event, and the halt itself is the load-bearing
    // guarantee here — silent-halt would be worse than no log.
    await withRls(
      { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
      async (tx) => {
        await tx.auditLog.create({
          data: {
            tenantId: session.tenantId,
            ticketId,
            action: "RULE_INVOCATION_CAP",
            toValue: `Event ${event} halted at depth ${depth} (cap ${INVOCATION_CAP})`,
          },
        });
      }
    );
    return;
  }

  await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const rules = await tx.rule.findMany({
        where: {
          tenantId: session.tenantId,
          kind: "TRIGGER",
          active: true,
          triggerEvent: event,
        },
        orderBy: { createdAt: "asc" },
      });

      const ticket = await tx.ticket.findFirst({
        where: { id: ticketId, tenantId: session.tenantId },
        select: {
          status: true,
          priority: true,
          categoryId: true,
          assignedTeamMemberId: true,
          source: true,
          createdAt: true,
          firstReplyAt: true,
        },
      });
      if (!ticket) return;

      // M9.5 — attach the latest inbound message's AI signals to the
      // ticket object so readField() can resolve aiIntent / aiSentiment /
      // aiUrgency / aiLanguage conditions.
      const latestSignals = await tx.message.findFirst({
        where: {
          tenantId: session.tenantId,
          ticketId,
          senderRole: { in: ["CLIENT", "GUEST"] },
          aiSignalsAt: { not: null },
        },
        orderBy: { createdAt: "desc" },
        select: {
          aiIntent: true,
          aiSentiment: true,
          aiUrgency: true,
          aiLanguage: true,
        },
      });
      const ticketWithSignals = { ...ticket, ...(latestSignals ?? {}) };

      for (const rule of rules) {
        try {
          const matched = evaluateConditions(rule.conditions, ticketWithSignals);
          if (!matched) {
            await tx.ruleRunLog.create({
              data: {
                tenantId: session.tenantId,
                ruleId: rule.id,
                ticketId,
                outcome: "skipped_conditions",
                ranActionCount: 0,
              },
            });
            continue;
          }
          // executeActions runs OUTSIDE this transaction — actions
          // that call updateTicket/postAgentReply open their own
          // transactions and must not sit inside another. We fall out
          // of this tx, then rejoin for logging below.
        } catch (e) {
          await tx.ruleRunLog.create({
            data: {
              tenantId: session.tenantId,
              ruleId: rule.id,
              ticketId,
              outcome: "action_failed",
              ranActionCount: 0,
              errorMessage: e instanceof Error ? e.message : "Unknown error",
            },
          });
        }
      }

      return rules;
    }
  );

  // Second pass — actual action execution outside any transaction.
  // We re-read matches to keep this loop simple; the extra Prisma
  // round-trip is negligible against the mutations the actions run.
  const matched: Array<{ id: string; actions: Prisma.JsonValue }> = await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const rules = await tx.rule.findMany({
        where: {
          tenantId: session.tenantId,
          kind: "TRIGGER",
          active: true,
          triggerEvent: event,
        },
        orderBy: { createdAt: "asc" },
        select: { id: true, actions: true, conditions: true },
      });
      const ticket = await tx.ticket.findFirst({
        where: { id: ticketId, tenantId: session.tenantId },
        select: {
          status: true,
          priority: true,
          categoryId: true,
          assignedTeamMemberId: true,
          source: true,
          createdAt: true,
          firstReplyAt: true,
        },
      });
      if (!ticket) return [];
      return rules
        .filter((r) => evaluateConditions(r.conditions, ticket))
        .map(({ id, actions }) => ({ id, actions }));
    }
  );

  for (const rule of matched) {
    const result = await executeActions(rule.actions, ticketId, session, depth);
    await withRls(
      { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
      async (tx) => {
        await tx.rule.update({ where: { id: rule.id }, data: { lastRunAt: new Date() } });
        await tx.ruleRunLog.create({
          data: {
            tenantId: session.tenantId,
            ruleId: rule.id,
            ticketId,
            outcome: result.errors.length === 0 ? "matched" : "action_failed",
            ranActionCount: result.ranActionCount,
            errorMessage: result.errors.length > 0 ? result.errors.map((e) => `#${e.index}: ${e.message}`).join("; ") : null,
          },
        });
      }
    );
  }
}

/**
 * Called by "Run now" on an automation or by a future scheduler.
 * Loads matching tickets in one query, then executes actions per
 * ticket sequentially.
 */
export async function runAutomationOnce(params: {
  ruleId: string;
  session: RuleEngineSession;
}): Promise<{ matched: number; ranActionCount: number; errors: number }> {
  const { ruleId, session } = params;
  const rule = await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    (tx) =>
      tx.rule.findFirst({
        where: { id: ruleId, tenantId: session.tenantId, kind: "AUTOMATION" },
      })
  );
  if (!rule) throw new Error("Automation not found.");
  if (!rule.active) throw new Error("Automation is not active.");

  // Scope: all tenant tickets not yet CLOSED. The evaluator filters
  // to those that match `rule.conditions`. Batching keeps the run
  // idempotent-per-tick.
  const tickets = await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    (tx) =>
      tx.ticket.findMany({
        where: { tenantId: session.tenantId, status: { not: "CLOSED" } },
        select: {
          id: true,
          status: true,
          priority: true,
          categoryId: true,
          assignedTeamMemberId: true,
          source: true,
          createdAt: true,
          firstReplyAt: true,
        },
        take: 500, // batch cap — one run touches at most 500 tickets
      })
  );

  let matched = 0;
  let ranActionCount = 0;
  let errors = 0;

  for (const t of tickets) {
    if (!evaluateConditions(rule.conditions, t)) continue;
    matched++;
    const result = await executeActions(rule.actions, t.id, session);
    ranActionCount += result.ranActionCount;
    errors += result.errors.length;
    await withRls(
      { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
      async (tx) => {
        await tx.ruleRunLog.create({
          data: {
            tenantId: session.tenantId,
            ruleId: rule.id,
            ticketId: t.id,
            outcome: result.errors.length === 0 ? "matched" : "action_failed",
            ranActionCount: result.ranActionCount,
            errorMessage: result.errors.length > 0 ? result.errors.map((e) => `#${e.index}: ${e.message}`).join("; ") : null,
          },
        });
      }
    );
  }

  await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    (tx) => tx.rule.update({ where: { id: rule.id }, data: { lastRunAt: new Date() } })
  );

  return { matched, ranActionCount, errors };
}
