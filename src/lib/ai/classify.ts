// src/lib/ai/classify.ts
//
// M9 — classification orchestrator. Sits between the message-created
// event and the AiProvider. Handles:
//   - Content-hash cache lookup (spec §3: classify once, cache by hash)
//   - Per-tenant taxonomy fetch + digest (cache-invalidation on edit)
//   - Per-tenant monthly token cap (spec §3 + M9 admin knob)
//   - AI enabled/disabled master switch
//   - Sentry-safe error handling — never logs raw content (spec §3)
//
// Callers: src/lib/inngest/functions/classify-message.ts

import crypto from "node:crypto";
import { withRls, prisma } from "@/lib/db";
import { aiProvider } from "@/lib/ai";

export type TenantAiConfig = {
  aiEnabled: boolean;
  aiConfidenceThreshold: number;
  aiMonthlyTokenCap: number;
  aiTokensUsedThisMonth: number;
  aiTokensMonthResetAt: Date;
  aiAutoTranslate: boolean;
  aiPrimaryLanguage: string;
};

export type Signals = {
  intent: string | null;
  sentiment: string | null;
  urgency: string | null;
  language: string | null;
  confidence: number;
  fromCache: boolean;
};

export function contentHash(body: string): string {
  return crypto.createHash("sha256").update(body).digest("hex");
}

export function taxonomyDigest(
  activeSlugs: string[]
): string {
  return crypto
    .createHash("sha256")
    .update([...activeSlugs].sort().join("|"))
    .digest("hex");
}

/**
 * Reads the tenant's AI config + resets the monthly counter if the
 * reset date has rolled over.
 */
export async function loadTenantAiConfig(tenantId: string): Promise<TenantAiConfig> {
  const t = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: {
      aiEnabled: true,
      aiConfidenceThreshold: true,
      aiMonthlyTokenCap: true,
      aiTokensUsedThisMonth: true,
      aiTokensMonthResetAt: true,
      aiAutoTranslate: true,
      aiPrimaryLanguage: true,
    },
  });
  if (!t) throw new Error(`Tenant ${tenantId} not found`);

  // Monthly reset: if last reset was in a previous calendar month, zero
  // the counter. Cheap; no cron needed.
  const now = new Date();
  if (
    t.aiTokensMonthResetAt.getUTCMonth() !== now.getUTCMonth() ||
    t.aiTokensMonthResetAt.getUTCFullYear() !== now.getUTCFullYear()
  ) {
    await prisma.tenant.update({
      where: { id: tenantId },
      data: { aiTokensUsedThisMonth: 0, aiTokensMonthResetAt: now },
    });
    t.aiTokensUsedThisMonth = 0;
    t.aiTokensMonthResetAt = now;
  }
  return t;
}

/**
 * Attempts classification for a message body. Returns null when AI is
 * disabled, the provider is unconfigured, or the cap is exhausted AND
 * the cache misses. When the cap is exhausted BUT the cache hits, the
 * cached signals are returned (no fresh spend).
 *
 * On successful fresh classification, this function also:
 *   - Writes the row to AiClassificationCache
 *   - Increments Tenant.aiTokensUsedThisMonth by tokensUsed
 */
export async function classifyBody(
  tenantId: string,
  body: string
): Promise<Signals | null> {
  const config = await loadTenantAiConfig(tenantId);
  if (!config.aiEnabled) return null;

  // Taxonomy fetch + digest.
  const intents = await prisma.intentTaxonomy.findMany({
    where: { tenantId, isActive: true },
    orderBy: { sortOrder: "asc" },
    select: { slug: true, label: true, description: true },
  });
  const digest = taxonomyDigest(intents.map((i) => i.slug));
  const hash = contentHash(body);

  // Cache lookup.
  const cached = await prisma.aiClassificationCache.findUnique({
    where: {
      tenantId_contentHash_taxonomyDigest: {
        tenantId,
        contentHash: hash,
        taxonomyDigest: digest,
      },
    },
  });
  if (cached) {
    return {
      intent: cached.intent,
      sentiment: cached.sentiment,
      urgency: cached.urgency,
      language: cached.language,
      confidence: cached.confidence,
      fromCache: true,
    };
  }

  // Budget check — fresh classification only if there's headroom.
  if (config.aiTokensUsedThisMonth >= config.aiMonthlyTokenCap) return null;
  if (!aiProvider.isConfigured) return null;

  let result: Awaited<ReturnType<typeof aiProvider.classifyMessage>>;
  try {
    result = await aiProvider.classifyMessage({ body, intents });
  } catch {
    // Do not log the raw body — spec §3.
    return null;
  }

  // Persist cache + increment tenant counter in the same tx.
  await prisma.$transaction([
    prisma.aiClassificationCache.create({
      data: {
        tenantId,
        contentHash: hash,
        taxonomyDigest: digest,
        intent: result.intent,
        sentiment: result.sentiment,
        urgency: result.urgency,
        language: result.language,
        confidence: result.confidence,
        tokensUsed: result.tokensUsed,
      },
    }),
    prisma.tenant.update({
      where: { id: tenantId },
      data: { aiTokensUsedThisMonth: { increment: result.tokensUsed } },
    }),
  ]);

  return {
    intent: result.intent,
    sentiment: result.sentiment,
    urgency: result.urgency,
    language: result.language,
    confidence: result.confidence,
    fromCache: false,
  };
}

/**
 * True when the signal's confidence meets the tenant's threshold. Below
 * threshold → the agent UI renders the signal muted with "low confidence".
 */
export function meetsConfidenceThreshold(
  confidence: number | null,
  threshold: number
): boolean {
  if (confidence == null) return false;
  return confidence >= threshold;
}

// Silence unused-import warning while keeping withRls available for
// future SUPER_ADMIN-scoped writes (this file uses `prisma` directly
// because AI cache and tenant counter writes are cross-tenant admin
// operations).
void withRls;
