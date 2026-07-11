// src/lib/ai/emit-classify.ts
//
// M9 — helper called by every inbound-message-create action. Fires an
// Inngest event; classification lands asynchronously so the write path
// isn't held up by an LLM round-trip.
//
// Never throws — Inngest send failures are non-fatal for the domain
// mutation.

import { inngest } from "@/lib/inngest/client";

export async function emitClassifyEvent(tenantId: string, messageId: string): Promise<void> {
  try {
    await inngest.send({
      name: "message.classify",
      data: { tenantId, messageId },
    });
  } catch {
    // Silent — classification will just not run; the message stays in
    // "signals not yet available" state which the agent UI handles.
  }
}
