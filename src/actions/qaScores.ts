"use server";

// M11.3–M11.6 — read-side actions over QaScore. Every action here is
// gated to AGENT+; end-users have no route into QA data (spec §3
// "Do NOT display QA scores to end users").
//
// Self vs team scoping:
//   - AGENT sees only their own scores.
//   - Team-Lead-flagged roles (any role whose scope includes GROUP or
//     ALL) see everyone in-scope.
//   - ADMIN / SUPER_ADMIN see everything in the tenant.
// This is enforced by the caller's session role + subjectId — RLS is
// tenant-scoped only for qa_scores. The narrowing to author subject
// id happens in the query below.

import { z } from "zod";
import { withRls, prisma } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import type { Rubric } from "@/lib/ai/qa";

const listSchema = z.object({
  days: z.number().int().min(1).max(365).default(30),
  authorSubjectId: z.string().min(1).optional(),
});

const decideSchema = z.object({
  id: z.string().min(1),
});

export type QaScoreDto = {
  id: string;
  messageId: string;
  ticketId: string;
  ticketReference: string | null;
  authorTeamMemberId: string | null;
  senderRole: string;
  overall: number;
  isFlagged: boolean;
  flaggedReasons: string[];
  scores: Record<string, { score: number; rationale: string }>;
  reviewStatus: string;
  createdAt: string;
};

/** Aggregate view: rolling averages by dimension over the last N days. */
export type ComplianceRow = {
  date: string;             // YYYY-MM-DD (UTC)
  overall: number;
  perDimension: Record<string, number>;
  count: number;
};

function canSeeOthers(role: string, roleName: string | null | undefined): boolean {
  if (role === "ADMIN" || role === "SUPER_ADMIN") return true;
  // Z5 convention: role names ending in "Lead" or "Manager" imply
  // team-lead scope. Concrete tenants can rename this by editing the
  // Role record; the check here is name-based rather than DB-flag
  // based so it works with the seeded roles out of the box.
  return typeof roleName === "string" && /lead|manager/i.test(roleName);
}

export async function listQaScores(input: z.infer<typeof listSchema>): Promise<QaScoreDto[]> {
  const session = await requireSession({ minRole: "AGENT" });
  const data = listSchema.parse(input);
  const canSeeAll = canSeeOthers(session.role, session.roleName);
  const authorFilter = canSeeAll
    ? data.authorSubjectId
      ? { authorTeamMemberId: data.authorSubjectId }
      : {}
    : { authorTeamMemberId: session.subjectId };
  const since = new Date(Date.now() - data.days * 24 * 60 * 60 * 1000);

  return withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const rows = await tx.qaScore.findMany({
        where: {
          tenantId: session.tenantId,
          createdAt: { gte: since },
          ...authorFilter,
        },
        orderBy: { createdAt: "desc" },
        take: 100,
      });
      const ticketIds = [...new Set(rows.map((r) => r.ticketId))];
      const tickets = ticketIds.length
        ? await tx.ticket.findMany({
            where: { tenantId: session.tenantId, id: { in: ticketIds } },
            select: { id: true, reference: true },
          })
        : [];
      const refById = new Map(tickets.map((t) => [t.id, t.reference]));

      return rows.map((r) => ({
        id: r.id,
        messageId: r.messageId,
        ticketId: r.ticketId,
        ticketReference: refById.get(r.ticketId) ?? null,
        authorTeamMemberId: r.authorTeamMemberId,
        senderRole: r.senderRole,
        overall: r.overall,
        isFlagged: r.isFlagged,
        flaggedReasons: Array.isArray(r.flaggedReasons) ? (r.flaggedReasons as string[]) : [],
        scores: (r.scoresJson as Record<string, { score: number; rationale: string }>) ?? {},
        reviewStatus: r.reviewStatus,
        createdAt: r.createdAt.toISOString(),
      }));
    }
  );
}

/** Rolling per-day aggregate for coaching charts + compliance dashboard. */
export async function getComplianceTrend(days = 30): Promise<{
  rubric: Rubric | null;
  rows: ComplianceRow[];
}> {
  const session = await requireSession({ minRole: "AGENT" });
  const canSeeAll = canSeeOthers(session.role, session.roleName);
  const authorFilter = canSeeAll ? {} : { authorTeamMemberId: session.subjectId };
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  return withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const rubricRow = await tx.qaRubric.findFirst({
        where: { tenantId: session.tenantId, isActive: true },
      });
      const rubric = rubricRow ? (rubricRow.dimensions as Rubric) : null;
      const scores = await tx.qaScore.findMany({
        where: {
          tenantId: session.tenantId,
          createdAt: { gte: since },
          ...authorFilter,
        },
        select: { overall: true, scoresJson: true, createdAt: true },
      });

      // Bucket by UTC date.
      const buckets = new Map<
        string,
        { count: number; overallSum: number; perDim: Record<string, { sum: number; count: number }> }
      >();
      for (const s of scores) {
        const key = s.createdAt.toISOString().slice(0, 10);
        const b = buckets.get(key) ?? {
          count: 0,
          overallSum: 0,
          perDim: {},
        };
        b.count += 1;
        b.overallSum += s.overall;
        const dims = (s.scoresJson as Record<string, { score: number }>) ?? {};
        for (const [k, v] of Object.entries(dims)) {
          const cur = b.perDim[k] ?? { sum: 0, count: 0 };
          cur.sum += v.score;
          cur.count += 1;
          b.perDim[k] = cur;
        }
        buckets.set(key, b);
      }

      const rows = [...buckets.entries()]
        .sort((a, b) => (a[0] < b[0] ? -1 : 1))
        .map(([date, b]) => ({
          date,
          overall: b.overallSum / b.count,
          perDimension: Object.fromEntries(
            Object.entries(b.perDim).map(([k, v]) => [k, v.sum / v.count])
          ),
          count: b.count,
        }));
      return { rubric, rows };
    }
  );
}

/** M11.5 — pair each ticket's QA overall with its SurveyResponse rating. */
export async function getCsatCorrelation(days = 90): Promise<Array<{ overall: number; rating: number }>> {
  const session = await requireSession({ minRole: "ADMIN" });
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const surveys = await tx.surveyResponse.findMany({
        where: { tenantId: session.tenantId, createdAt: { gte: since }, surveyType: "CSAT" },
        select: { ticketId: true, rating: true },
      });
      if (surveys.length === 0) return [];
      const ticketIds = surveys.map((s) => s.ticketId);
      const scores = await tx.qaScore.findMany({
        where: { tenantId: session.tenantId, ticketId: { in: ticketIds } },
        select: { ticketId: true, overall: true, createdAt: true },
        orderBy: { createdAt: "asc" },
      });
      // A ticket may have several scored replies. Take the mean.
      const perTicket = new Map<string, { sum: number; n: number }>();
      for (const s of scores) {
        const cur = perTicket.get(s.ticketId) ?? { sum: 0, n: 0 };
        cur.sum += s.overall;
        cur.n += 1;
        perTicket.set(s.ticketId, cur);
      }
      const out: Array<{ overall: number; rating: number }> = [];
      for (const s of surveys) {
        const q = perTicket.get(s.ticketId);
        if (!q || q.n === 0) continue;
        out.push({ overall: q.sum / q.n, rating: s.rating });
      }
      return out;
    }
  );
}

/** M11.4 — flagged queue: pending flagged rows for the admin to review. */
export async function listFlaggedScores(): Promise<QaScoreDto[]> {
  const session = await requireSession({ minRole: "ADMIN" });
  return withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const rows = await tx.qaScore.findMany({
        where: {
          tenantId: session.tenantId,
          isFlagged: true,
          reviewStatus: "PENDING",
        },
        orderBy: { createdAt: "desc" },
        take: 100,
      });
      const ticketIds = [...new Set(rows.map((r) => r.ticketId))];
      const tickets = ticketIds.length
        ? await tx.ticket.findMany({
            where: { tenantId: session.tenantId, id: { in: ticketIds } },
            select: { id: true, reference: true },
          })
        : [];
      const refById = new Map(tickets.map((t) => [t.id, t.reference]));
      return rows.map((r) => ({
        id: r.id,
        messageId: r.messageId,
        ticketId: r.ticketId,
        ticketReference: refById.get(r.ticketId) ?? null,
        authorTeamMemberId: r.authorTeamMemberId,
        senderRole: r.senderRole,
        overall: r.overall,
        isFlagged: r.isFlagged,
        flaggedReasons: Array.isArray(r.flaggedReasons) ? (r.flaggedReasons as string[]) : [],
        scores: (r.scoresJson as Record<string, { score: number; rationale: string }>) ?? {},
        reviewStatus: r.reviewStatus,
        createdAt: r.createdAt.toISOString(),
      }));
    }
  );
}

export async function markScoreReviewed(input: z.infer<typeof decideSchema>) {
  const session = await requireSession({ minRole: "ADMIN" });
  const data = decideSchema.parse(input);
  return withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      await tx.qaScore.update({
        where: { id: data.id },
        data: {
          reviewStatus: "REVIEWED",
          reviewedBySubjectId: session.subjectId,
          reviewedAt: new Date(),
        },
      });
      return { ok: true };
    }
  );
}

export async function dismissScore(input: z.infer<typeof decideSchema>) {
  const session = await requireSession({ minRole: "ADMIN" });
  const data = decideSchema.parse(input);
  return withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      await tx.qaScore.update({
        where: { id: data.id },
        data: {
          reviewStatus: "DISMISSED",
          reviewedBySubjectId: session.subjectId,
          reviewedAt: new Date(),
        },
      });
      return { ok: true };
    }
  );
}

export async function countFlaggedScores(): Promise<number> {
  const session = await requireSession({ minRole: "ADMIN" });
  return prisma.qaScore.count({
    where: { tenantId: session.tenantId, isFlagged: true, reviewStatus: "PENDING" },
  });
}
