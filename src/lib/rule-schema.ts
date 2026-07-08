import { z } from "zod";

// Z8.1 — condition + action vocabulary shared between Triggers and
// Automations. Kept in a lib (not an action module) because the schema
// is referenced by the engine (server-only) AND the admin editors
// (which need it client-side for form validation). Nothing here touches
// the DB.

// ---------------------------------------------------------------------------
// Conditions
// ---------------------------------------------------------------------------

/**
 * Fields the condition evaluator knows how to read off a ticket. Adding
 * a new one requires (a) adding it to CONDITION_FIELDS and (b) teaching
 * `readField()` in rule-engine.ts how to extract it — TS enforces this.
 */
export const CONDITION_FIELDS = [
  "status",
  "priority",
  "categoryId",
  "assignedGroupId",
  "assignedTeamMemberId",
  "channel",
  "requesterEmail",
  "tag",
  "customField",
  "hoursSinceCreated",
  "hoursSinceLastReply",
] as const;
export type ConditionField = (typeof CONDITION_FIELDS)[number];

export const CONDITION_OPS = [
  "eq",
  "neq",
  "in",
  "not_in",
  "contains",
  "gt",
  "lt",
  "is_set",
  "is_not_set",
] as const;
export type ConditionOp = (typeof CONDITION_OPS)[number];

export const conditionSchema = z.object({
  field: z.enum(CONDITION_FIELDS),
  op: z.enum(CONDITION_OPS),
  // Wide type: string | number | string[]. Zod's discriminated-union
  // machinery is overkill for a JSON blob that already lives loosely.
  value: z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]).optional(),
  // For customField only — the definition id whose value to read.
  customFieldDefinitionId: z.string().optional(),
});

export const conditionGroupSchema = z.object({
  match: z.enum(["all", "any"]),
  conditions: z.array(conditionSchema).max(20),
});

export type Condition = z.infer<typeof conditionSchema>;
export type ConditionGroup = z.infer<typeof conditionGroupSchema>;

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

const ticketStatus = z.enum(["OPEN", "IN_PROGRESS", "PENDING", "RESOLVED", "CLOSED"]);
const ticketPriority = z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]);

/**
 * Every action variant. New action types get a new branch here and a
 * new case in `executeActions()`. The discriminator is `type` so the
 * editor UI can key its field list off it.
 */
export const actionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("assign_group"),
    groupId: z.string().min(1),
  }),
  z.object({
    type: z.literal("assign_team_member"),
    teamMemberId: z.string().min(1),
  }),
  z.object({
    type: z.literal("set_status"),
    status: ticketStatus,
  }),
  z.object({
    type: z.literal("set_priority"),
    priority: ticketPriority,
  }),
  z.object({
    type: z.literal("set_category"),
    categoryId: z.string().min(1),
  }),
  z.object({
    type: z.literal("add_tag"),
    tag: z.string().min(1).max(60),
  }),
  z.object({
    type: z.literal("add_internal_note"),
    body: z.string().min(1).max(20_000),
  }),
  z.object({
    type: z.literal("notify_team_member"),
    teamMemberId: z.string().min(1),
    message: z.string().min(1).max(500),
  }),
  z.object({
    type: z.literal("send_email_to_requester"),
    subject: z.string().min(1).max(200),
    body: z.string().min(1).max(20_000),
  }),
  z.object({
    type: z.literal("run_macro"),
    macroId: z.string().min(1),
  }),
  z.object({
    type: z.literal("run_webhook"),
    url: z.string().url(),
    secret: z.string().optional(),
  }),
  z.object({
    type: z.literal("trigger_escalation"),
    escalationPathId: z.string().min(1),
  }),
  // M3 — Route the ticket through the routing engine and assign the
  // resulting agent. `strategy` picks the algorithm; `groupId` is the
  // candidate pool; `requiredSkills` narrows the pool for SKILLS_BASED.
  z.object({
    type: z.literal("auto_route"),
    strategy: z.enum(["ROUND_ROBIN", "LOAD_BASED", "SKILLS_BASED"]),
    groupId: z.string().min(1),
    requiredSkills: z.array(z.string().max(60)).max(10).optional(),
  }),
]);

export const actionListSchema = z.array(actionSchema).min(1).max(20);

export type RuleAction = z.infer<typeof actionSchema>;

// ---------------------------------------------------------------------------
// Rule surface
// ---------------------------------------------------------------------------

export const triggerEventSchema = z.enum([
  "TICKET_CREATED",
  "TICKET_UPDATED",
  "TICKET_REPLIED",
  "STATUS_CHANGED",
  "PRIORITY_CHANGED",
  "SLA_WARNING",
  "SLA_BREACH",
  "TAG_ADDED",
]);
export type TriggerEvent = z.infer<typeof triggerEventSchema>;

export const createTriggerSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  triggerEvent: triggerEventSchema,
  conditions: conditionGroupSchema,
  actions: actionListSchema,
  active: z.boolean().default(true),
});

export const createAutomationSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  intervalHours: z.number().int().min(1).max(720),
  conditions: conditionGroupSchema,
  actions: actionListSchema,
  active: z.boolean().default(true),
});

export const updateRuleSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(500).optional(),
  triggerEvent: triggerEventSchema.optional(),
  intervalHours: z.number().int().min(1).max(720).optional(),
  conditions: conditionGroupSchema.optional(),
  actions: actionListSchema.optional(),
  active: z.boolean().optional(),
});

// ---------------------------------------------------------------------------
// Human labels — used by the editor UI dropdowns AND by `describeAction`
// so admin lists don't have to reinvent them.
// ---------------------------------------------------------------------------

export const CONDITION_FIELD_LABELS: Record<ConditionField, string> = {
  status: "Status",
  priority: "Priority",
  categoryId: "Category",
  assignedGroupId: "Assigned group",
  assignedTeamMemberId: "Assignee",
  channel: "Channel",
  requesterEmail: "Requester email",
  tag: "Tag",
  customField: "Custom field",
  hoursSinceCreated: "Hours since created",
  hoursSinceLastReply: "Hours since last reply",
};

export const CONDITION_OP_LABELS: Record<ConditionOp, string> = {
  eq: "equals",
  neq: "does not equal",
  in: "is one of",
  not_in: "is not one of",
  contains: "contains",
  gt: "greater than",
  lt: "less than",
  is_set: "is set",
  is_not_set: "is not set",
};

export const TRIGGER_EVENT_LABELS: Record<TriggerEvent, string> = {
  TICKET_CREATED: "Ticket created",
  TICKET_UPDATED: "Ticket updated",
  TICKET_REPLIED: "Reply posted",
  STATUS_CHANGED: "Status changed",
  PRIORITY_CHANGED: "Priority changed",
  SLA_WARNING: "SLA warning",
  SLA_BREACH: "SLA breached",
  TAG_ADDED: "Tag added",
};

export const ACTION_LABELS: Record<RuleAction["type"], string> = {
  assign_group: "Assign to group",
  assign_team_member: "Assign to team member",
  set_status: "Set status",
  set_priority: "Set priority",
  set_category: "Set category",
  add_tag: "Add tag",
  add_internal_note: "Add internal note",
  notify_team_member: "Notify team member",
  send_email_to_requester: "Send email to requester",
  run_macro: "Run macro",
  run_webhook: "Call webhook",
  trigger_escalation: "Trigger escalation",
  auto_route: "Auto-route to agent",
};

export function describeAction(a: RuleAction): string {
  switch (a.type) {
    case "assign_group":
      return `Assign to group ${a.groupId}`;
    case "assign_team_member":
      return `Assign to team member ${a.teamMemberId}`;
    case "set_status":
      return `Set status → ${a.status}`;
    case "set_priority":
      return `Set priority → ${a.priority}`;
    case "set_category":
      return `Set category ${a.categoryId}`;
    case "add_tag":
      return `Add tag "${a.tag}"`;
    case "add_internal_note":
      return `Add internal note`;
    case "notify_team_member":
      return `Notify team member ${a.teamMemberId}`;
    case "send_email_to_requester":
      return `Email requester: "${a.subject}"`;
    case "run_macro":
      return `Run macro ${a.macroId}`;
    case "run_webhook":
      return `Call webhook ${new URL(a.url).host}`;
    case "trigger_escalation":
      return `Trigger escalation ${a.escalationPathId}`;
    case "auto_route":
      return `Auto-route (${a.strategy.toLowerCase().replace("_", " ")}) within group ${a.groupId}`;
  }
}
