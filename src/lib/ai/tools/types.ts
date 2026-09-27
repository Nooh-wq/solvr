// src/lib/ai/tools/types.ts
//
// M8 — shared types for the agentic-AI tool loop. Kept here (not in
// executor.ts) so type imports stay side-effect free — the executor
// pulls in Prisma and the AI provider, which we don't want dragged
// into unit tests.

/**
 * JSON-Schema-lite. Enough for tool arg validation without pulling in
 * a full JSON Schema library. Supported at the top level: `object`
 * with `properties` + `required`. Nested `object` allowed one level
 * deep. Property types: string, number, integer, boolean, array
 * (with `items` type), enum (via `enum` on any type).
 *
 * Any richer schema (oneOf, $ref, patternProperties) is deliberately
 * out of scope — the intent is "the model can't pass garbage args",
 * not "we re-implement OpenAPI."
 */
export type JsonSchemaPrimitiveType = "string" | "number" | "integer" | "boolean";
export type JsonSchemaType = JsonSchemaPrimitiveType | "array" | "object";

export type JsonSchemaProp = {
  type: JsonSchemaType;
  description?: string;
  enum?: Array<string | number | boolean>;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  items?: JsonSchemaProp;
  properties?: Record<string, JsonSchemaProp>;
  required?: string[];
};

export type JsonSchemaObject = {
  type: "object";
  properties: Record<string, JsonSchemaProp>;
  required?: string[];
};

/** Caller roles known to the executor's allow-list check. */
export type ToolCallerRole =
  | "CLIENT"
  | "GUEST"
  | "AGENT"
  | "ADMIN"
  | "SUPER_ADMIN"
  | "SYSTEM";

/** What the model proposes. Names constrained to the tenant's tool registry — the executor rejects unknown names. */
export type ProposedToolCall = {
  name: string;
  args: Record<string, unknown>;
};

/** Result of running a tool — becomes the `tool_result` turn given back to the model for its final composed reply. */
export type ToolExecutionResult =
  | { ok: true; data: unknown }
  | { ok: false; error: string };

/** Everything the executor needs to run one tool call. */
export type ExecutorInput = {
  tenantId: string;
  callerRole: ToolCallerRole;
  callerSubjectId: string | null;
  ticketId: string | null;
  conversationId: string | null;
  proposal: ProposedToolCall;
};

/** Outcome the caller (chat loop) needs. Always paired with an AiActionLog row already written. */
export type ExecutorOutcome =
  | { kind: "executed"; result: unknown; actionLogId: string }
  | { kind: "queued-for-approval"; actionLogId: string }
  | { kind: "rejected"; reason: string; actionLogId: string | null }
  | { kind: "failed"; error: string; actionLogId: string };
