"use server";

// M9.4 — agent-facing override. When the AI misclassifies, an agent
// corrects the signal on the ticket header. Overridden values are the
// source of truth downstream (M9.5 rules, M9.6 routing).

import { z } from "zod";
import { withRls } from "@/lib/db";
import { requireSession } from "@/lib/auth";

const overrideSchema = z.object({
  messageId: z.string().min(1),
  intent: z.string().nullable().optional(),
  sentiment: z.string().nullable().optional(),
  urgency: z.string().nullable().optional(),
  language: z.string().nullable().optional(),
});

export async function overrideMessageSignals(
  input: z.infer<typeof overrideSchema>
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = overrideSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const session = await requireSession();
  if (session.role === "CLIENT") return { ok: false, error: "Only staff can override." };

  const data: Record<string, unknown> = {
    aiOverriddenBySubjectId: session.subjectId,
  };
  if (parsed.data.intent !== undefined) data.aiIntent = parsed.data.intent;
  if (parsed.data.sentiment !== undefined) data.aiSentiment = parsed.data.sentiment;
  if (parsed.data.urgency !== undefined) data.aiUrgency = parsed.data.urgency;
  if (parsed.data.language !== undefined) data.aiLanguage = parsed.data.language;
  // Override implies high confidence (human labeled).
  data.aiConfidence = 1.0;

  await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    (tx) =>
      tx.message.updateMany({
        where: { id: parsed.data.messageId, tenantId: session.tenantId },
        data,
      })
  );
  return { ok: true };
}
