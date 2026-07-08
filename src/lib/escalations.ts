import { z } from "zod";
import { withRls } from "@/lib/db";
import type { RuleEngineSession } from "@/lib/rule-engine";
import { listTeamMembersInGroup, systemContext } from "@/lib/shared-platform";
import { routeTicket, ROUTING_STRATEGIES } from "@/lib/routing";

// Z8.4 — escalation path executor. Called from the ticket-detail
// "Escalate to X" button and from the rule engine's
// `trigger_escalation` action. Each destination type is a self-
// contained handler; failures write EscalationLog with FAILED and
// re-throw so the caller can surface the error (never silent).

export const TEAM_DEST_CONFIG = z.object({
  groupId: z.string().min(1),
  // M3 — routing strategy applied when picking an assignee from the group.
  // Default keeps back-compat with pre-M3 escalations: first member of the
  // group, no rotation.
  strategy: z.enum(ROUTING_STRATEGIES).optional(),
  requiredSkills: z.array(z.string().max(60)).max(10).optional(),
  alsoSetPriority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).optional(),
  alsoAddTag: z.string().max(60).optional(),
});
export const WEBHOOK_DEST_CONFIG = z.object({
  url: z.string().url(),
  secret: z.string().optional(),
});
export const EMAIL_DEST_CONFIG = z.object({
  toEmails: z.array(z.string().email()).min(1).max(10),
  subject: z.string().max(200).optional(),
  template: z.string().max(20_000).optional(),
});
export const INTEGRATION_DEST_CONFIG = z.object({
  kind: z.enum(["jira", "github", "linear"]),
});

export const escalationDestConfigSchema = z.union([
  TEAM_DEST_CONFIG,
  WEBHOOK_DEST_CONFIG,
  EMAIL_DEST_CONFIG,
  INTEGRATION_DEST_CONFIG,
]);

export const createEscalationPathSchema = z.object({
  label: z.string().min(1).max(80),
  icon: z.string().max(40).optional(),
  categoryIds: z.array(z.string()).max(50),
  destKind: z.enum(["TEAM", "WEBHOOK", "EMAIL", "INTEGRATION"]),
  destConfig: z.unknown(),
  active: z.boolean().default(true),
});

export const updateEscalationPathSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1).max(80).optional(),
  icon: z.string().max(40).optional(),
  categoryIds: z.array(z.string()).max(50).optional(),
  destKind: z.enum(["TEAM", "WEBHOOK", "EMAIL", "INTEGRATION"]).optional(),
  destConfig: z.unknown().optional(),
  active: z.boolean().optional(),
});

export const ESCALATION_ICON_KEYS = ["alertTriangle", "shield", "flame", "arrowUp", "megaphone"] as const;

/**
 * The runtime executor for an escalation path. Both the agent-clicked
 * `triggerEscalation` action and a rule's `trigger_escalation` action
 * funnel through here.
 *
 * Never silent: on failure it writes EscalationLog { FAILED,
 * errorMessage } AND rethrows. The caller (UI or rule engine) surfaces
 * the error to the user or the rule-run log.
 */
export async function runEscalation(params: {
  escalationPathId: string;
  ticketId: string;
  session: RuleEngineSession;
  /** Where the escalation was invoked from — audit-log context only. */
  source: "button" | "rule";
}): Promise<void> {
  const { escalationPathId, ticketId, session, source } = params;

  const path = await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    (tx) =>
      tx.escalationPath.findFirst({
        where: { id: escalationPathId, tenantId: session.tenantId, active: true },
      })
  );
  if (!path) throw new Error("Escalation path not found or inactive.");

  const logFailure = async (message: string) => {
    await withRls(
      { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
      async (tx) => {
        await tx.escalationLog.create({
          data: {
            tenantId: session.tenantId,
            escalationPathId: path.id,
            ticketId,
            actorTeamMemberId: session.subjectId,
            status: "FAILED",
            errorMessage: message,
          },
        });
      }
    );
  };

  try {
    if (path.destKind === "TEAM") {
      const cfg = TEAM_DEST_CONFIG.parse(path.destConfig);
      // M3 — if a strategy is configured, route through the engine
      // (scope + availability + capacity + loop cap). Otherwise fall
      // back to the pre-M3 shape (first member of the group) so
      // existing paths stay identical until an admin opts in.
      let pickedId: string;
      if (cfg.strategy) {
        const result = await routeTicket({
          session,
          ticketId,
          groupId: cfg.groupId,
          strategy: cfg.strategy,
          requiredSkills: cfg.requiredSkills,
          source: "ESCALATION",
        });
        if (!result.ok) throw new Error(`Routing failed: ${result.message}`);
        pickedId = result.teamMemberId;
      } else {
        const members = await listTeamMembersInGroup(systemContext(session.tenantId), cfg.groupId);
        if (members.length === 0) throw new Error(`Group ${cfg.groupId} has no members.`);
        pickedId = members[0].id;
      }
      const { updateTicket } = await import("@/actions/tickets");
      await updateTicket({
        ticketId,
        assignedToId: pickedId,
        ...(cfg.alsoSetPriority && { priority: cfg.alsoSetPriority }),
      });
      if (cfg.alsoAddTag) {
        // Same tag path as rule-engine.ts's add_tag branch — kept
        // inline here to avoid a circular import.
        await withRls(
          { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
          async (tx) => {
            const t = await tx.tag.upsert({
              where: { tenantId_name: { tenantId: session.tenantId, name: cfg.alsoAddTag! } },
              create: { tenantId: session.tenantId, name: cfg.alsoAddTag! },
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
          }
        );
      }
    } else if (path.destKind === "WEBHOOK") {
      const cfg = WEBHOOK_DEST_CONFIG.parse(path.destConfig);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      try {
        const res = await fetch(cfg.url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(cfg.secret && { "x-solvr-secret": cfg.secret }),
          },
          body: JSON.stringify({
            event: "escalation",
            escalationPathId: path.id,
            escalationLabel: path.label,
            ticketId,
            tenantId: session.tenantId,
            source,
          }),
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`Webhook responded ${res.status}`);
      } finally {
        clearTimeout(timeout);
      }
    } else if (path.destKind === "EMAIL") {
      const cfg = EMAIL_DEST_CONFIG.parse(path.destConfig);
      // Same limitation as rule engine's send_email_to_requester: an
      // internal note captures intent + audit trail. M20's outbound
      // pipeline turns this into a real Resend send. Concrete recipient
      // list gets recorded so future backfill can replay.
      const { postAgentReply } = await import("@/actions/tickets");
      await postAgentReply({
        ticketId,
        body: `[Escalation "${path.label}" queued for email]\nTo: ${cfg.toEmails.join(", ")}\nSubject: ${
          cfg.subject ?? "Escalation"
        }\n\n${cfg.template ?? "(no template)"}`,
        isInternal: true,
      });
    } else if (path.destKind === "INTEGRATION") {
      throw new Error("Integration destinations require the Marketplace (M19), which isn't shipped yet.");
    }

    await withRls(
      { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
      async (tx) => {
        await tx.escalationLog.create({
          data: {
            tenantId: session.tenantId,
            escalationPathId: path.id,
            ticketId,
            actorTeamMemberId: session.subjectId,
            status: "SUCCESS",
          },
        });
      }
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    await logFailure(msg);
    throw e;
  }
}
