// src/actions/m8-tools.test.ts
//
// M8 pinning tests. Every spec §3 invariant gets an anchor here so
// regressions surface as test failures rather than production incidents.

process.env.SESSION_SECRET = "test-secret-at-least-32-characters-long-please";
process.env.MFA_SECRET_KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateArgs, readSchema } from "@/lib/ai/tools/validate";
import {
  BUILTIN_HANDLERS,
  BUILTIN_DEFAULT_APPROVAL,
  BUILTIN_SCHEMAS,
} from "@/lib/ai/tools/builtins";
import { UnconfiguredAiProvider } from "@/lib/ai/provider";

const PROVIDER_SRC = readFileSync("src/lib/ai/provider.ts", "utf8");
const CLAUDE_SRC = readFileSync("src/lib/ai/claude-provider.ts", "utf8");
const OPENROUTER_SRC = readFileSync("src/lib/ai/openrouter-provider.ts", "utf8");
const EXEC_SRC = readFileSync("src/lib/ai/tools/executor.ts", "utf8");
const ACTIONS_SRC = readFileSync("src/actions/aiTools.ts", "utf8");
const QUEUE_SRC = readFileSync("src/actions/aiActionQueue.ts", "utf8");
const CHAT_SRC = readFileSync("src/actions/chat.ts", "utf8");
const SCHEMA_SRC = readFileSync("prisma/schema.prisma", "utf8");
const RLS_SRC = readFileSync("prisma/rls_policies.sql", "utf8");
const BUILTINS_SRC = readFileSync("src/lib/ai/tools/builtins.ts", "utf8");

// ---------------------------------------------------------------------
// Provider extension
// ---------------------------------------------------------------------
describe("M8 — AiProvider.proposeToolCall", () => {
  it("provider.ts declares ToolSpec + ToolProposal + proposeToolCall", () => {
    assert.match(PROVIDER_SRC, /export type ToolSpec/);
    assert.match(PROVIDER_SRC, /export type ToolProposal/);
    assert.match(PROVIDER_SRC, /proposeToolCall\(input: ToolProposalInput\)/);
  });

  it("UnconfiguredAiProvider throws NOT_CONFIGURED on proposeToolCall", async () => {
    const p = new UnconfiguredAiProvider();
    await assert.rejects(
      () => p.proposeToolCall({ systemPrompt: "x", turns: [], tools: [] }),
      /NOT_CONFIGURED/
    );
  });

  it("Claude + OpenRouter providers implement proposeToolCall", () => {
    assert.match(CLAUDE_SRC, /async proposeToolCall\(input: ToolProposalInput\)/);
    assert.match(OPENROUTER_SRC, /async proposeToolCall\(input: ToolProposalInput\)/);
  });

  it("Provider prompt forbids inventing tool names outside the allowed list", () => {
    assert.match(CLAUDE_SRC, /Never invent a tool name that isn't listed/);
    assert.match(OPENROUTER_SRC, /Never invent a tool name that isn't listed/);
  });
});

// ---------------------------------------------------------------------
// JSON-Schema-lite validator — spec §3 "arguments validated"
// ---------------------------------------------------------------------
describe("M8 — validateArgs", () => {
  const schema = {
    type: "object" as const,
    properties: {
      reference: { type: "string" as const, minLength: 3, maxLength: 40 },
      count: { type: "integer" as const, minimum: 1, maximum: 5 },
      urgent: { type: "boolean" as const },
    },
    required: ["reference"],
  };

  it("passes a valid object", () => {
    const r = validateArgs(schema, { reference: "TKT-0001", count: 2, urgent: true });
    assert.equal(r.ok, true);
  });

  it("rejects missing required field", () => {
    const r = validateArgs(schema, { count: 1 });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /missing required/);
  });

  it("rejects unknown field", () => {
    const r = validateArgs(schema, { reference: "TKT-0001", evil: "yes" });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /unknown argument/);
  });

  it("rejects wrong type", () => {
    const r = validateArgs(schema, { reference: 123 });
    assert.equal(r.ok, false);
  });

  it("rejects out-of-range integer", () => {
    const r = validateArgs(schema, { reference: "TKT-0001", count: 100 });
    assert.equal(r.ok, false);
  });

  it("rejects too-short string", () => {
    const r = validateArgs(schema, { reference: "ab" });
    assert.equal(r.ok, false);
  });

  it("readSchema returns null on malformed input", () => {
    assert.equal(readSchema(null), null);
    assert.equal(readSchema({ type: "array", properties: {} }), null);
    assert.equal(readSchema({ type: "object" }), null);
    assert.ok(readSchema({ type: "object", properties: {} }));
  });
});

// ---------------------------------------------------------------------
// Built-in defaults — spec §3: sensitive tools require approval by default
// ---------------------------------------------------------------------
describe("M8 — builtins safe defaults", () => {
  it("mutating builtins default requiresApproval=true (create_ticket, add_internal_note)", () => {
    assert.equal(BUILTIN_DEFAULT_APPROVAL.create_ticket, true);
    assert.equal(BUILTIN_DEFAULT_APPROVAL.add_internal_note, true);
  });

  it("read-only builtins can auto-execute (get_ticket_status, get_recent_tickets_for_me)", () => {
    assert.equal(BUILTIN_DEFAULT_APPROVAL.get_ticket_status, false);
    assert.equal(BUILTIN_DEFAULT_APPROVAL.get_recent_tickets_for_me, false);
  });

  it("every built-in name maps to both a handler and a schema", () => {
    for (const name of Object.keys(BUILTIN_HANDLERS)) {
      assert.ok(BUILTIN_SCHEMAS[name], `missing schema for ${name}`);
      assert.ok(BUILTIN_DEFAULT_APPROVAL[name] !== undefined, `missing approval default for ${name}`);
    }
  });

  it("builtins never accept credential-like arg names (spec §3 pin)", () => {
    for (const [name, schema] of Object.entries(BUILTIN_SCHEMAS)) {
      for (const key of Object.keys(schema.properties)) {
        assert.doesNotMatch(
          key,
          /token|apikey|api_key|secret|bearer|authorization/i,
          `${name}.${key} looks like a credential`
        );
      }
    }
  });
});

// ---------------------------------------------------------------------
// Executor — every guardrail pinned by source substring
// ---------------------------------------------------------------------
describe("M8 — executor guardrails", () => {
  it("looks up the tool by (tenantId, name, isEnabled=true) under caller RLS", () => {
    assert.match(EXEC_SRC, /tenantId,\s*name:\s*proposal\.name,\s*isEnabled:\s*true/);
  });

  it("rejects unknown/disabled tools without executing", () => {
    assert.match(EXEC_SRC, /unknown or disabled tool/);
  });

  it("enforces the role allow-list before validating args", () => {
    assert.match(EXEC_SRC, /allowlist\.includes\(callerRole\)/);
    assert.match(EXEC_SRC, /not in allow-list/);
  });

  it("validates args against the tool schema", () => {
    assert.match(EXEC_SRC, /validateArgs\(schema,\s*proposal\.args\)/);
  });

  it("approval-gated tools land in PROPOSED state, not executed", () => {
    assert.match(EXEC_SRC, /if \(tool\.requiresApproval\)/);
    assert.match(EXEC_SRC, /queued-for-approval/);
  });

  it("retries are capped at tool.retryLimit + 1", () => {
    assert.match(EXEC_SRC, /Math\.max\(1,\s*args\.tool\.retryLimit\s*\+\s*1\)/);
    assert.match(EXEC_SRC, /attempts:\s*attempt/);
  });

  it("writes AiActionLog on rejection AND execution paths (never silent)", () => {
    // both writeActionLog and the final update() must exist
    assert.match(EXEC_SRC, /writeActionLog\(/);
    assert.match(EXEC_SRC, /status:\s*"EXECUTED"/);
    assert.match(EXEC_SRC, /status:\s*"FAILED"/);
  });

  it("HTTP tool executor never sends tool credentials back to the model", () => {
    // The executor pulls headers server-side and never returns them.
    assert.match(EXEC_SRC, /httpHeaders/);
    assert.doesNotMatch(EXEC_SRC, /return.*httpHeaders/);
  });

  it("HTTP calls carry a bounded timeout", () => {
    assert.match(EXEC_SRC, /HTTP_TIMEOUT_MS/);
    assert.match(EXEC_SRC, /AbortController/);
  });

  it("execution audits back to the ticket-level AuditLog when a ticketId is in context", () => {
    assert.match(EXEC_SRC, /action:\s*"AI_TOOL_EXECUTED"/);
  });
});

// ---------------------------------------------------------------------
// Actions gates
// ---------------------------------------------------------------------
describe("M8 — action gates", () => {
  it("upsertAiTool and deleteAiTool require ADMIN+", () => {
    assert.match(ACTIONS_SRC, /requireSession\(\{\s*minRole:\s*"ADMIN"\s*\}\)/);
  });

  it("approve/rejectAiAction require AGENT+", () => {
    assert.match(QUEUE_SRC, /requireSession\(\{\s*minRole:\s*"AGENT"\s*\}\)/);
  });

  it("approve path routes through executor.executeApprovedAction", () => {
    assert.match(QUEUE_SRC, /executeApprovedAction\(/);
  });
});

// ---------------------------------------------------------------------
// Chat loop wiring
// ---------------------------------------------------------------------
describe("M8 — chat loop integration", () => {
  it("chat.ts loads tools scoped to the caller role before proposing", () => {
    assert.match(CHAT_SRC, /loadToolsForCaller\(/);
  });

  it("chat.ts runs proposed tools through the executor", () => {
    assert.match(CHAT_SRC, /runProposedTool\(/);
  });

  it("chat.ts surfaces queued-for-approval to the caller (never silent)", () => {
    assert.match(CHAT_SRC, /queued-for-approval/);
    assert.match(CHAT_SRC, /flagged your request/);
  });
});

// ---------------------------------------------------------------------
// Schema + RLS pins
// ---------------------------------------------------------------------
describe("M8 — schema + RLS", () => {
  it("AiTool default is safe: requiresApproval=true", () => {
    assert.match(SCHEMA_SRC, /requiresApproval\s+Boolean\s+@default\(true\)/);
  });

  it("AiTool has a per-tenant unique name", () => {
    assert.match(SCHEMA_SRC, /@@unique\(\[tenantId,\s*name\]\)/);
  });

  it("AiActionLog carries denormalised toolName so audit survives tool deletion", () => {
    assert.match(SCHEMA_SRC, /toolName\s+String/);
  });

  it("ai_tools and ai_action_logs are RLS-enabled", () => {
    assert.match(RLS_SRC, /'ai_tools','ai_action_logs'/);
    assert.match(RLS_SRC, /tenant_isolation on ai_tools/);
    assert.match(RLS_SRC, /tenant_isolation on ai_action_logs/);
  });

  it("BUILTIN_HANDLERS exists for every declared built-in name", () => {
    // Simple structural pin — builtins.ts exports the map used by executor.
    assert.match(BUILTINS_SRC, /BUILTIN_HANDLERS/);
    assert.ok(Object.keys(BUILTIN_HANDLERS).length >= 4);
  });
});
