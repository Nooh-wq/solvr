"use server";

// M12 — admin CRUD for ChannelConfig. Credentials are envelope-
// encrypted at write time and NEVER round-tripped to the client for
// display (spec §3 pin). The admin form shows placeholders and only
// re-writes creds when the user retypes them.

import crypto from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withRls } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { envelopeEncrypt } from "@/core/auth/envelope-crypto";
import { actorCols, dualFkForUser } from "@/lib/z1-dual-fk";

const CHANNELS = ["SMS", "WHATSAPP", "MESSENGER", "INSTAGRAM"] as const;

const upsertSchema = z.object({
  id: z.string().min(1).optional(),
  channel: z.enum(CHANNELS),
  phoneOrHandle: z.string().min(1).max(120),
  isActive: z.boolean(),
  // Cred map — key → value. Empty values mean "leave existing" on
  // update; the action skips re-encryption if all values are empty.
  credentials: z.record(z.string(), z.string().max(1000)),
});

export type ChannelConfigDto = {
  id: string;
  channel: string;
  phoneOrHandle: string;
  isActive: boolean;
  webhookSlug: string;
  webhookUrl: string;
  lastInboundAt: string | null;
  lastOutboundAt: string | null;
  updatedAt: string;
};

function siteUrl() {
  return process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
}

export async function listChannelConfigs(): Promise<ChannelConfigDto[]> {
  const session = await requireSession({ minRole: "ADMIN" });
  return withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const rows = await tx.channelConfig.findMany({
        where: { tenantId: session.tenantId },
        orderBy: { channel: "asc" },
      });
      return rows.map((r) => ({
        id: r.id,
        channel: r.channel,
        phoneOrHandle: r.phoneOrHandle,
        isActive: r.isActive,
        webhookSlug: r.webhookSlug,
        webhookUrl: `${siteUrl()}/api/webhooks/channels/${r.webhookSlug}`,
        lastInboundAt: r.lastInboundAt?.toISOString() ?? null,
        lastOutboundAt: r.lastOutboundAt?.toISOString() ?? null,
        updatedAt: r.updatedAt.toISOString(),
      }));
    }
  );
}

export async function upsertChannelConfig(input: z.infer<typeof upsertSchema>) {
  const session = await requireSession({ minRole: "ADMIN" });
  const data = upsertSchema.parse(input);

  return withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      // On update, merge new cred values into the existing (decrypted)
      // set so admins can rotate a single key without retyping every
      // secret. We accept empty strings as "no change" for that key.
      let credsToStore: Record<string, string> = data.credentials;
      const existing = data.id
        ? await tx.channelConfig.findFirst({
            where: { id: data.id, tenantId: session.tenantId },
          })
        : null;

      if (existing) {
        const { envelopeDecrypt } = await import("@/core/auth/envelope-crypto");
        const priorPlain = await envelopeDecrypt(tx, session.tenantId, existing.credsEnc);
        const prior = priorPlain ? (JSON.parse(priorPlain) as Record<string, string>) : {};
        const merged: Record<string, string> = { ...prior };
        for (const [k, v] of Object.entries(data.credentials)) {
          if (v !== "") merged[k] = v;
        }
        credsToStore = merged;
      }

      const ciphertext = await envelopeEncrypt(
        tx,
        session.tenantId,
        JSON.stringify(credsToStore)
      );

      const webhookSlug =
        existing?.webhookSlug ?? crypto.randomBytes(16).toString("hex");

      const row = existing
        ? await tx.channelConfig.update({
            where: { id: existing.id },
            data: {
              channel: data.channel,
              phoneOrHandle: data.phoneOrHandle,
              isActive: data.isActive,
              credsEnc: ciphertext,
            },
          })
        : await tx.channelConfig.create({
            data: {
              tenantId: session.tenantId,
              channel: data.channel,
              phoneOrHandle: data.phoneOrHandle,
              isActive: data.isActive,
              credsEnc: ciphertext,
              webhookSlug,
            },
          });

      const dual = dualFkForUser(session.subjectId, session.role);
      await tx.auditLog.create({
        data: {
          tenantId: session.tenantId,
          ...actorCols(dual),
          action: existing ? "CHANNEL_CONFIG_UPDATE" : "CHANNEL_CONFIG_CREATE",
          toValue: row.channel,
        },
      });
      revalidatePath("/admin/channels");
      return { ok: true, id: row.id, webhookSlug: row.webhookSlug };
    }
  );
}

export async function deleteChannelConfig(id: string) {
  const session = await requireSession({ minRole: "ADMIN" });
  return withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const config = await tx.channelConfig.findFirst({
        where: { id, tenantId: session.tenantId },
      });
      if (!config) throw new Error("Not found");
      await tx.channelConfig.delete({ where: { id: config.id } });
      const dual = dualFkForUser(session.subjectId, session.role);
      await tx.auditLog.create({
        data: {
          tenantId: session.tenantId,
          ...actorCols(dual),
          action: "CHANNEL_CONFIG_DELETE",
          fromValue: config.channel,
        },
      });
      revalidatePath("/admin/channels");
      return { ok: true };
    }
  );
}
