// Z6.4 — macro action shapes + validation. Support-side, shared by
// server actions (apply) and admin UI (editor). Kept as a Zod discriminated
// union so an "unknown action type" is rejected structurally rather than
// depending on runtime branching in every consumer.

import { z } from "zod";

export const macroActionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("add_internal_note"),
    body: z.string().min(1).max(20000),
  }),
  z.object({
    type: z.literal("change_status"),
    status: z.enum(["OPEN", "IN_PROGRESS", "PENDING", "RESOLVED", "CLOSED"]),
  }),
  z.object({
    // "insert_reply_template" doesn't post a message — it drops the
    // expanded template into the composer so the agent can edit before
    // sending. That preserves the Z6 §3 rule "no silent mass mutations".
    type: z.literal("insert_reply_template"),
    body: z.string().min(1).max(20000),
  }),
]);

export type MacroAction = z.infer<typeof macroActionSchema>;

export const macroActionsSchema = z.array(macroActionSchema).min(1).max(20);

/** Human-readable summary used by the preview modal + audit log. */
export function describeAction(action: MacroAction): string {
  switch (action.type) {
    case "add_internal_note":
      return `Add internal note — "${truncate(action.body, 60)}"`;
    case "change_status":
      return `Change status to ${action.status.toLowerCase().replace(/_/g, " ")}`;
    case "insert_reply_template":
      return `Insert reply template — "${truncate(action.body, 60)}"`;
  }
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}
