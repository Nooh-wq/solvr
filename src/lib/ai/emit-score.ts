// src/lib/ai/emit-score.ts
//
// M11 — fire-and-forget emitter for the QA scoring Inngest function.
// Called at every reply-send site (postAgentReply, postClientReply,
// chatbot BOT message finalisation). Awaiting inngest.send() takes
// low ms; wrapping in try/catch so a queue outage never fails a
// reply.

import { inngest } from "@/lib/inngest/client";

export async function emitScoreReplyEvent(tenantId: string, messageId: string): Promise<void> {
  try {
    await inngest.send({ name: "reply.score", data: { tenantId, messageId } });
  } catch {
    // Non-fatal — the reply itself was persisted successfully.
  }
}
