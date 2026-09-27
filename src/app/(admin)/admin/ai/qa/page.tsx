import Link from "next/link";
import { getComplianceTrend, getCsatCorrelation, countFlaggedScores } from "@/actions/qaScores";
import { ComplianceView } from "./compliance-view";

export default async function QaDashboardPage() {
  const [{ rubric, rows }, correlation, flaggedCount] = await Promise.all([
    getComplianceTrend(30),
    getCsatCorrelation(90),
    countFlaggedScores(),
  ]);
  return (
    <div>
      <div className="flex justify-between items-start gap-4 mb-1">
        <h1 className="text-2xl font-bold">AI QA</h1>
        <div className="flex gap-3 text-[13px] font-medium">
          <Link href="/admin/ai/qa/rubric" className="text-[var(--color-primary)] hover:underline">
            Rubric
          </Link>
          <Link href="/admin/ai/qa/flagged" className="text-[var(--color-primary)] hover:underline">
            Flagged
            {flaggedCount > 0 ? (
              <span className="ml-1 inline-flex items-center justify-center min-w-[18px] h-4 px-1 rounded-full bg-[var(--color-primary)] text-white text-[10px] font-semibold">
                {flaggedCount}
              </span>
            ) : null}
          </Link>
        </div>
      </div>
      <p className="text-sm text-[var(--color-neutral-600)] mb-6">
        Quality trends across your tenant. Coaching signal only — not a compensation input.
      </p>
      <ComplianceView rubric={rubric} rows={rows} correlation={correlation} />
    </div>
  );
}
