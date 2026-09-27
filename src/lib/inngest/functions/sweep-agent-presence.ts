// M4.1 — presence sweep. Runs every minute; flips ONLINE/AWAY rows to
// OFFLINE when their lastHeartbeatAt is older than STALE_HEARTBEAT_MS.
// Keeps the live-chat handoff from routing to a browser tab someone
// closed 20 minutes ago.

import { inngest } from "../client";
import { sweepStalePresence } from "@/actions/agentPresence";

export const sweepAgentPresence = inngest.createFunction(
  { id: "sweep-agent-presence", triggers: { cron: "* * * * *" } }, // every minute
  async () => {
    const { swept } = await sweepStalePresence();
    return { swept };
  }
);
