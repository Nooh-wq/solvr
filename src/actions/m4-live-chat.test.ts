// src/actions/m4-live-chat.test.ts
//
// M4 pinning tests.

process.env.SESSION_SECRET = "test-secret-at-least-32-characters-long-please";
process.env.MFA_SECRET_KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { STALE_HEARTBEAT_MS } from "@/actions/agentPresence";

const SCHEMA_SRC = readFileSync("prisma/schema.prisma", "utf8");
const RLS_SRC = readFileSync("prisma/rls_policies.sql", "utf8");
const PRESENCE_SRC = readFileSync("src/actions/agentPresence.ts", "utf8");
const LIVE_SRC = readFileSync("src/actions/liveChat.ts", "utf8");
const CRON_SRC = readFileSync(
  "src/lib/inngest/functions/sweep-agent-presence.ts",
  "utf8"
);
const INNGEST_ROUTE_SRC = readFileSync("src/app/api/inngest/route.ts", "utf8");
const WIDGET_SRC = readFileSync("src/components/chat-widget.tsx", "utf8");
const CONSOLE_SRC = readFileSync(
  "src/app/(agent)/agent/live-chat/live-chat-console.tsx",
  "utf8"
);

// ---------------------------------------------------------------------
// Schema + RLS
// ---------------------------------------------------------------------
describe("M4 — schema + RLS", () => {
  it("AgentPresence has (tenantId, teamMemberId) unique — one row per agent per tenant", () => {
    assert.match(
      SCHEMA_SRC,
      /model AgentPresence[\s\S]*?@@unique\(\[tenantId,\s*teamMemberId\]\)/
    );
  });

  it("ChatConversation carries handoff / typing / assignedTeamMemberId columns", () => {
    for (const col of [
      "assignedTeamMemberId",
      "handoffRequestedAt",
      "handoffPickedUpAt",
      "clientTypingAt",
      "agentTypingAt",
    ]) {
      assert.match(SCHEMA_SRC, new RegExp(`model ChatConversation[\\s\\S]*?${col}`));
    }
  });

  it("agent_presence is RLS-enabled (spec §3 — no cross-tenant presence)", () => {
    assert.match(RLS_SRC, /'agent_presence'/);
    assert.match(RLS_SRC, /tenant_isolation on agent_presence/);
  });
});

// ---------------------------------------------------------------------
// Presence heartbeat + sweep
// ---------------------------------------------------------------------
describe("M4.1 — presence", () => {
  it("STALE_HEARTBEAT_MS is 90s (matches the ~30s heartbeat + margin)", () => {
    assert.equal(STALE_HEARTBEAT_MS, 90_000);
  });

  it("heartbeat + setPresenceStatus require AGENT+", () => {
    assert.match(PRESENCE_SRC, /heartbeat[\s\S]{0,200}requireSession\(\{\s*minRole:\s*"AGENT"\s*\}\)/);
    assert.match(PRESENCE_SRC, /setPresenceStatus[\s\S]{0,200}requireSession\(\{\s*minRole:\s*"AGENT"\s*\}\)/);
  });

  it("listOnlineAgentIds filters by tenantId + status ONLINE + fresh heartbeat", () => {
    assert.match(PRESENCE_SRC, /status:\s*"ONLINE"/);
    assert.match(PRESENCE_SRC, /lastHeartbeatAt:\s*\{\s*gte:\s*cutoff/);
  });

  it("sweep cron is registered every minute", () => {
    assert.match(CRON_SRC, /cron:\s*"\* \* \* \* \*"/);
    assert.match(INNGEST_ROUTE_SRC, /sweepAgentPresence/);
  });

  it("sweep flips ONLY ONLINE/AWAY rows past cutoff to OFFLINE (never reverses)", () => {
    assert.match(
      PRESENCE_SRC,
      /status:\s*\{\s*in:\s*\["ONLINE",\s*"AWAY"\]\s*\}/
    );
    assert.match(PRESENCE_SRC, /data:\s*\{\s*status:\s*"OFFLINE"\s*\}/);
  });
});

// ---------------------------------------------------------------------
// Handoff engine
// ---------------------------------------------------------------------
describe("M4.3 — handoff + console", () => {
  it("requestLiveAgent flips status to waiting and stamps handoffRequestedAt", () => {
    assert.match(LIVE_SRC, /status:\s*"waiting"/);
    assert.match(LIVE_SRC, /handoffRequestedAt:\s*new Date\(\)/);
  });

  it("pickUpLiveChat only claims 'waiting' rows and enforces assignedTeamMemberId", () => {
    assert.match(LIVE_SRC, /status:\s*"waiting"/);
    assert.match(LIVE_SRC, /assignedTeamMemberId:\s*session\.subjectId/);
  });

  it("postAgentChatReply refuses to write to a conversation not assigned to caller", () => {
    assert.match(LIVE_SRC, /Not your conversation/);
    assert.match(LIVE_SRC, /assignedTeamMemberId:\s*session\.subjectId/);
  });

  it("markTyping stamps only the correct side (never both)", () => {
    assert.match(
      LIVE_SRC,
      /side === "agent"[\s\S]{0,150}agentTypingAt:\s*new Date\(\)/
    );
  });
});

// ---------------------------------------------------------------------
// Offline fallback
// ---------------------------------------------------------------------
describe("M4.4 — offline fallback", () => {
  it("requestLiveAgent falls through to escalateChatToTicket when no ONLINE agents", () => {
    assert.match(
      LIVE_SRC,
      /online\.length === 0[\s\S]{0,300}escalateChatToTicket/
    );
    assert.match(LIVE_SRC, /kind:\s*"offline-ticket"/);
  });
});

// ---------------------------------------------------------------------
// Convert to ticket surface (M4.5)
// ---------------------------------------------------------------------
describe("M4.5 — convert to ticket", () => {
  it("convertLiveChatToTicket delegates to the existing escalate path (transcript preserved)", () => {
    assert.match(LIVE_SRC, /convertLiveChatToTicket[\s\S]{0,400}escalateChatToTicket/);
  });

  it("convert failure logs conversation id ONLY (spec §3 — no chat body in Sentry)", () => {
    assert.match(LIVE_SRC, /live-chat convert failed for conv/);
    assert.doesNotMatch(LIVE_SRC, /console\.(log|error)\([^)]*body/);
  });
});

// ---------------------------------------------------------------------
// UI wiring
// ---------------------------------------------------------------------
describe("M4 — UI wiring", () => {
  it("chat widget imports requestLiveAgent and exposes 'Talk to a person'", () => {
    assert.match(WIDGET_SRC, /requestLiveAgent/);
    assert.match(WIDGET_SRC, /Talk to a person/);
  });

  it("widget surfaces offline-ticket case as 'created a ticket instead'", () => {
    assert.match(WIDGET_SRC, /No agents online[\s\S]{0,80}created a ticket/);
  });

  it("agent console reuses the shared components (no bespoke composer rebuild — spec §3)", () => {
    // The console renders a plain Textarea (from @/components/ui/input)
    // rather than a forked MessageComposer. Grep for the imports.
    assert.match(CONSOLE_SRC, /from "@\/components\/ui\/input"/);
    assert.doesNotMatch(CONSOLE_SRC, /LiveChatComposer/);
  });

  it("agent console heartbeats + polls the detail on an interval", () => {
    assert.match(CONSOLE_SRC, /setInterval\(\(\) => void heartbeat\(\)/);
    assert.match(CONSOLE_SRC, /getLiveChatDetail/);
  });
});
