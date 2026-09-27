"use server";

// M7.4 — WebhookSubscription CRUD. Secrets envelope-encrypted.

import { z } from "zod";
import crypto from "node:crypto";
import { withRls } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { envelopeEncrypt } from "@/core/auth/envelope-crypto";

const EVENT_TYPES = [
  "ticket.created",
  "ticket.updated",
  "ticket.resolved",
  "ticket.reopened",
  "user.created",
  "user.updated",
] as const;

const createSchema = z.object({
  url: z.string().url(),
  events: z.array(z.enum(EVENT_TYPES)).min(1),
});

export async function createWebhookSubscription(
  input: z.infer<typeof createSchema>
): Promise<{ ok: true; id: string; secret: string } | { ok: false; error: string }> {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const session = await requireSession();

  // Fresh shared secret. Shown to the admin exactly once; only the
  // envelope-encrypted form persists.
  const rawSecret = `whsec_${crypto.randomBytes(32).toString("base64url")}`;

  const row = await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const encrypted = await envelopeEncrypt(tx, session.tenantId, rawSecret);
      return tx.webhookSubscription.create({
        data: {
          tenantId: session.tenantId,
          url: parsed.data.url,
          events: parsed.data.events,
          secret: encrypted,
          createdBySubjectId: session.subjectId,
        },
      });
    }
  );
  return { ok: true, id: row.id, secret: rawSecret };
}

export async function deleteWebhookSubscription(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await requireSession();
  await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    (tx) => tx.webhookSubscription.deleteMany({ where: { id, tenantId: session.tenantId } })
  );
  return { ok: true };
}

export async function listWebhookSubscriptions(): Promise<
  Array<{
    id: string;
    url: string;
    events: string[];
    isActive: boolean;
    failCount: number;
    disabledAt: Date | null;
    disabledReason: string | null;
    lastDeliveredAt: Date | null;
    createdAt: Date;
  }>
> {
  const session = await requireSession();
  const rows = await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    (tx) =>
      tx.webhookSubscription.findMany({
        where: { tenantId: session.tenantId },
        orderBy: { createdAt: "desc" },
        select: {
          id: true, url: true, events: true, isActive: true, failCount: true,
          disabledAt: true, disabledReason: true, lastDeliveredAt: true, createdAt: true,
        },
      })
  );
  return rows.map((r) => ({
    ...r,
    events: (r.events as string[]) ?? [],
  }));
}

export const WEBHOOK_EVENT_TYPES = EVENT_TYPES;
