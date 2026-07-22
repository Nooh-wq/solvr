"use server";

// Phase 4d — AI performance metrics for /admin/ai/performance.
// Aggregates over AiActionLog + AiClassificationCache + QaScore.

import { requireSession } from "@/lib/auth";
import { withRls } from "@/lib/db";

export type AiPerformance = {
  windowDays: number;
  actions: {
    proposed: number;
    executed: number;
    failed: number;
    approved: number;
    rejected: number;
    successRate: number; // executed / (executed + failed)
    approvalRate: number; // approved / (approved + rejected)
    avgApprovalLatencyMs: number | null;
  };
  classifications: {
    total: number;
    cacheHits: number;
    tokensUsedThisMonth: number;
    tokenCap: number;
  };
  qa: {
    scoresLast30: number;
    avgScore: number | null;
    lowScoreCount: number; // < 0.6
  };
  byTool: Array<{ toolName: string; executed: number; failed: number; successRate: number }>;
};

export async function getAiPerformance(days = 30): Promise<AiPerformance> {
  const session = await requireSession({ minRole: "ADMIN" });
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  return withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const [actions, byTool, classifications, tenant, qaScores] = await Promise.all([
        tx.aiActionLog.findMany({
          where: { tenantId: session.tenantId, createdAt: { gte: since } },
          select: { status: true, createdAt: true, decidedAt: true },
        }),
        tx.aiActionLog.groupBy({
          by: ["toolName", "status"],
          where: { tenantId: session.tenantId, createdAt: { gte: since } },
          _count: { _all: true },
        }),
        tx.aiClassificationCache.count({
          where: { tenantId: session.tenantId, createdAt: { gte: since } },
        }),
        tx.tenant.findUniqueOrThrow({
          where: { id: session.tenantId },
          select: { aiTokensUsedThisMonth: true, aiMonthlyTokenCap: true },
        }),
        tx.qaScore.findMany({
          where: { tenantId: session.tenantId, createdAt: { gte: since } },
          select: { overall: true },
        }),
      ]);

      const proposed = actions.filter((a) => a.status === "PROPOSED").length;
      const executed = actions.filter((a) => a.status === "EXECUTED").length;
      const failed = actions.filter((a) => a.status === "FAILED").length;
      const approved = actions.filter((a) => a.status === "APPROVED" || a.status === "EXECUTED").length;
      const rejected = actions.filter((a) => a.status === "REJECTED").length;
      const decidedActions = actions.filter((a) => a.decidedAt && a.status !== "PROPOSED");
      const latencyMs = decidedActions.length
        ? decidedActions.reduce(
            (sum, a) => sum + ((a.decidedAt?.getTime() ?? 0) - a.createdAt.getTime()),
            0
          ) / decidedActions.length
        : null;

      const toolMap = new Map<string, { executed: number; failed: number }>();
      for (const r of byTool) {
        const cur = toolMap.get(r.toolName) ?? { executed: 0, failed: 0 };
        if (r.status === "EXECUTED") cur.executed += r._count._all;
        if (r.status === "FAILED") cur.failed += r._count._all;
        toolMap.set(r.toolName, cur);
      }
      const byToolArr = Array.from(toolMap.entries())
        .map(([toolName, v]) => ({
          toolName,
          executed: v.executed,
          failed: v.failed,
          successRate: v.executed + v.failed === 0 ? 0 : v.executed / (v.executed + v.failed),
        }))
        .sort((a, b) => b.executed + b.failed - (a.executed + a.failed))
        .slice(0, 10);

      const avgScore = qaScores.length
        ? qaScores.reduce((sum, s) => sum + Number(s.overall ?? 0), 0) / qaScores.length
        : null;
      const lowScoreCount = qaScores.filter((s) => Number(s.overall ?? 0) < 0.6).length;

      return {
        windowDays: days,
        actions: {
          proposed,
          executed,
          failed,
          approved,
          rejected,
          successRate: executed + failed === 0 ? 0 : executed / (executed + failed),
          approvalRate: approved + rejected === 0 ? 0 : approved / (approved + rejected),
          avgApprovalLatencyMs: latencyMs,
        },
        classifications: {
          total: classifications,
          cacheHits: 0,
          tokensUsedThisMonth: tenant.aiTokensUsedThisMonth,
          tokenCap: tenant.aiMonthlyTokenCap,
        },
        qa: {
          scoresLast30: qaScores.length,
          avgScore,
          lowScoreCount,
        },
        byTool: byToolArr,
      };
    }
  );
}
