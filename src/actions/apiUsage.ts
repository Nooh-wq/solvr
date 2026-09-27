"use server";

// M7.6 — usage log reads for the admin dashboard.
// Rollup is deliberately simple: top endpoints by request count + error
// rate, per-key totals. Time window: last 7 days.

import { withRls } from "@/lib/db";
import { requireSession } from "@/lib/auth";

export async function getApiUsageOverview(): Promise<{
  totalRequests: number;
  errorRequests: number;
  errorRate: number;
  topEndpoints: Array<{ endpoint: string; count: number; errorCount: number }>;
  perKey: Array<{ apiKeyId: string | null; name: string; count: number; errorCount: number }>;
}> {
  const session = await requireSession();
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  return withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const [logs, keys] = await Promise.all([
        tx.apiUsageLog.findMany({
          where: { tenantId: session.tenantId, createdAt: { gte: since } },
          select: { apiKeyId: true, method: true, path: true, statusCode: true },
        }),
        tx.apiKey.findMany({
          where: { tenantId: session.tenantId },
          select: { id: true, name: true },
        }),
      ]);

      const totalRequests = logs.length;
      const errorRequests = logs.filter((l) => l.statusCode >= 400).length;

      // Top endpoints by request count.
      const endpointBuckets = new Map<string, { count: number; errorCount: number }>();
      for (const l of logs) {
        const key = `${l.method} ${l.path.replace(/\/[0-9a-f-]{8,}/g, "/{id}")}`;
        const b = endpointBuckets.get(key) ?? { count: 0, errorCount: 0 };
        b.count++;
        if (l.statusCode >= 400) b.errorCount++;
        endpointBuckets.set(key, b);
      }
      const topEndpoints = Array.from(endpointBuckets.entries())
        .map(([endpoint, b]) => ({ endpoint, ...b }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);

      // Per-key totals.
      const keyMap = new Map(keys.map((k) => [k.id, k.name]));
      const perKeyBuckets = new Map<string | null, { count: number; errorCount: number }>();
      for (const l of logs) {
        const b = perKeyBuckets.get(l.apiKeyId) ?? { count: 0, errorCount: 0 };
        b.count++;
        if (l.statusCode >= 400) b.errorCount++;
        perKeyBuckets.set(l.apiKeyId, b);
      }
      const perKey = Array.from(perKeyBuckets.entries())
        .map(([apiKeyId, b]) => ({
          apiKeyId,
          name: apiKeyId ? keyMap.get(apiKeyId) ?? "(deleted key)" : "(anonymous/rejected)",
          ...b,
        }))
        .sort((a, b) => b.count - a.count);

      return {
        totalRequests,
        errorRequests,
        errorRate: totalRequests > 0 ? errorRequests / totalRequests : 0,
        topEndpoints,
        perKey,
      };
    }
  );
}
