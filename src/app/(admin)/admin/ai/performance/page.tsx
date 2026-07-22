import { getAiPerformance } from "@/actions/aiPerformance";
import { EmptyState } from "@/components/empty-state";

export const dynamic = "force-dynamic";

function pct(n: number) {
  return `${(n * 100).toFixed(1)}%`;
}

export default async function AiPerformancePage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  const sp = await searchParams;
  const days = Math.min(Math.max(parseInt(sp.days ?? "30", 10) || 30, 1), 90);
  const perf = await getAiPerformance(days);

  const totalActions = perf.actions.proposed + perf.actions.executed + perf.actions.failed +
    perf.actions.approved + perf.actions.rejected;

  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <h1 className="text-2xl font-bold">AI performance</h1>
        <div className="flex gap-1">
          {[7, 30, 90].map((d) => (
            <a
              key={d}
              href={`?days=${d}`}
              className={`text-[12px] px-3 py-1 rounded-lg border ${
                d === days
                  ? "bg-[var(--color-neutral-900)] text-[var(--color-neutral-100)] border-transparent"
                  : "border-[var(--color-neutral-300)] hover:bg-[var(--color-neutral-100)]"
              }`}
            >
              Last {d}d
            </a>
          ))}
        </div>
      </div>
      <p className="text-sm text-[var(--color-neutral-600)] mb-6 max-w-2xl">
        Confidence, approval, and success metrics from your AI tools and classification calls.
      </p>

      {totalActions === 0 && perf.classifications.total === 0 ? (
        <EmptyState
          title="No AI activity in this window"
          description="Once agents start using AI tools or messages get classified, metrics will appear here."
          primaryCta={{ label: "AI configuration", href: "/admin/ai/settings" }}
        />
      ) : (
        <div className="space-y-6">
          <section>
            <h2 className="text-[13px] uppercase-label text-[var(--color-neutral-600)] mb-2">
              Tool actions
            </h2>
            <div className="grid gap-3 md:grid-cols-4">
              <Tile label="Success rate" value={pct(perf.actions.successRate)} sub={`${perf.actions.executed} of ${perf.actions.executed + perf.actions.failed}`} />
              <Tile label="Executed" value={perf.actions.executed} />
              <Tile label="Failed" value={perf.actions.failed} tone={perf.actions.failed > 0 ? "warn" : "ok"} />
              <Tile
                label="Approval latency"
                value={
                  perf.actions.avgApprovalLatencyMs === null
                    ? "—"
                    : `${Math.round(perf.actions.avgApprovalLatencyMs / 1000)}s`
                }
                sub="avg time to decision"
              />
            </div>
          </section>

          <section>
            <h2 className="text-[13px] uppercase-label text-[var(--color-neutral-600)] mb-2">
              Human oversight
            </h2>
            <div className="grid gap-3 md:grid-cols-4">
              <Tile label="Approval rate" value={pct(perf.actions.approvalRate)} sub={`${perf.actions.rejected} rejected`} />
              <Tile label="Pending" value={perf.actions.proposed} tone={perf.actions.proposed > 20 ? "warn" : undefined} />
              <Tile label="Approved" value={perf.actions.approved} />
              <Tile label="Rejected" value={perf.actions.rejected} tone={perf.actions.rejected > 0 ? "warn" : undefined} />
            </div>
          </section>

          <section>
            <h2 className="text-[13px] uppercase-label text-[var(--color-neutral-600)] mb-2">
              Classification & spend
            </h2>
            <div className="grid gap-3 md:grid-cols-3">
              <Tile label="Classifications" value={perf.classifications.total.toLocaleString()} />
              <Tile
                label="Tokens this month"
                value={perf.classifications.tokensUsedThisMonth.toLocaleString()}
                sub={`cap ${perf.classifications.tokenCap.toLocaleString()}`}
                tone={
                  perf.classifications.tokensUsedThisMonth / perf.classifications.tokenCap > 0.8
                    ? "err"
                    : perf.classifications.tokensUsedThisMonth / perf.classifications.tokenCap > 0.5
                      ? "warn"
                      : undefined
                }
              />
              <Tile
                label="QA avg score"
                value={perf.qa.avgScore === null ? "—" : perf.qa.avgScore.toFixed(2)}
                sub={`${perf.qa.lowScoreCount} below 0.6`}
                tone={
                  perf.qa.avgScore !== null && perf.qa.avgScore < 0.6
                    ? "err"
                    : perf.qa.avgScore !== null && perf.qa.avgScore < 0.75
                      ? "warn"
                      : undefined
                }
              />
            </div>
          </section>

          {perf.byTool.length > 0 ? (
            <section>
              <h2 className="text-[13px] uppercase-label text-[var(--color-neutral-600)] mb-2">
                By tool
              </h2>
              <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-[var(--color-light-gray)] text-[11px] uppercase-label text-[var(--color-neutral-700)]">
                    <tr>
                      <th className="text-left font-semibold px-4 py-2.5">Tool</th>
                      <th className="text-right font-semibold px-4 py-2.5">Executed</th>
                      <th className="text-right font-semibold px-4 py-2.5">Failed</th>
                      <th className="text-right font-semibold px-4 py-2.5">Success rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {perf.byTool.map((r) => (
                      <tr key={r.toolName} className="border-t border-[var(--color-neutral-100)]">
                        <td className="px-4 py-3 font-medium">{r.toolName}</td>
                        <td className="px-4 py-3 text-right font-mono text-[12px]">{r.executed}</td>
                        <td className="px-4 py-3 text-right font-mono text-[12px]">{r.failed}</td>
                        <td className="px-4 py-3 text-right font-mono text-[12px]">{pct(r.successRate)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}
        </div>
      )}
    </div>
  );
}

function Tile({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string | number;
  sub?: string;
  tone?: "ok" | "warn" | "err";
}) {
  const toneClass =
    tone === "err"
      ? "text-[var(--color-danger)]"
      : tone === "warn"
        ? "text-[var(--color-warning)]"
        : tone === "ok"
          ? "text-[var(--color-success)]"
          : "";
  return (
    <div className="p-5 bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl">
      <div className="text-[11px] uppercase-label text-[var(--color-neutral-600)] mb-1">{label}</div>
      <div className={`text-[24px] font-semibold ${toneClass}`}>{value}</div>
      {sub ? <div className="text-[11px] text-[var(--color-neutral-500)] mt-1">{sub}</div> : null}
    </div>
  );
}
