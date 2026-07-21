import { getComplianceTrend, listQaScores } from "@/actions/qaScores";
import { ComplianceView } from "@/app/(admin)/admin/ai/qa/compliance-view";
import { RecentScores } from "./recent-scores";

export default async function CoachingPage() {
  const [{ rubric, rows }, recent] = await Promise.all([
    getComplianceTrend(30),
    listQaScores({ days: 30 }),
  ]);
  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold mb-1">Coaching</h1>
        <p className="text-sm text-[var(--color-neutral-600)]">
          Your QA trend from the last 30 days. Coaching signal only — not a compensation input. Team leads see their
          team&apos;s aggregate; individual agents see only their own scores.
        </p>
      </div>
      <ComplianceView rubric={rubric} rows={rows} correlation={[]} />
      <section>
        <div className="text-[12px] uppercase-label text-[var(--color-neutral-700)] mb-2">
          Recent scored replies
        </div>
        <RecentScores items={recent} />
      </section>
    </div>
  );
}
