import { Suspense } from "react";
import { getAnalyticsOverview } from "@/actions/admin";
import { TrendChart, AxisBarChart, HeatmapChart } from "@/components/charts";
import { InteractiveRegionMap } from "@/components/region-map";
import { FilterBar } from "./filter-bar";
import { AgentLeaderboard } from "./agent-leaderboard";

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-5">
      <p className="uppercase-label text-[11px] text-[var(--color-neutral-600)] mb-2">{label}</p>
      <p className="text-2xl font-bold font-mono">{value}</p>
      {sub && <p className="text-[11px] text-[var(--color-neutral-500)] mt-1">{sub}</p>}
    </div>
  );
}

const CATEGORY_PALETTE = ["#ff6a00", "#ff8f40", "var(--foreground)", "#aeaeae", "#d6d6d6"];
const CHANNEL_COLORS: Record<string, string> = {
  portal: "var(--color-primary)",
  chatbot: "var(--foreground)",
  email: "#aeaeae",
};
const CHANNEL_LABELS: Record<string, string> = { portal: "Portal", chatbot: "Chatbot", email: "Email" };

const RANGE_VALUES = ["7d", "30d", "90d", "custom"] as const;
const CHANNEL_VALUES = ["portal", "chatbot", "email"] as const;
const PRIORITY_VALUES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;

function pct(v: number | null) {
  return v !== null ? `${Math.round(v * 100)}%` : "—";
}

function hours(v: number | null) {
  return v !== null ? `${v.toFixed(1)}h` : "—";
}

export default async function AdminAnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  // Cheap allow-list coercion so a malformed/stale query string never reaches
  // the action as a value the enum schema would throw on — combined with the
  // safeParse fallback inside getAnalyticsOverview, the whole filter pipeline
  // is defensive end-to-end (never 500s on a bad URL).
  const range = (RANGE_VALUES as readonly string[]).includes(sp.range ?? "") ? (sp.range as (typeof RANGE_VALUES)[number]) : undefined;
  const channel = (CHANNEL_VALUES as readonly string[]).includes(sp.channel ?? "") ? (sp.channel as (typeof CHANNEL_VALUES)[number]) : undefined;
  const priority = (PRIORITY_VALUES as readonly string[]).includes(sp.priority ?? "")
    ? (sp.priority as (typeof PRIORITY_VALUES)[number])
    : undefined;

  const data = await getAnalyticsOverview({
    range,
    from: sp.from ? new Date(sp.from) : undefined,
    to: sp.to ? new Date(sp.to) : undefined,
    channel,
    categoryId: sp.categoryId,
    priority,
    assignedToId: sp.assignedToId as "unassigned" | undefined,
  });

  const categorySegments = data.categoryBreakdown.map((c, i) => ({
    label: c.label,
    value: c.value,
    color: CATEGORY_PALETTE[i % CATEGORY_PALETTE.length],
  }));
  const channelSegments = data.channelBreakdown.map((c) => ({
    label: CHANNEL_LABELS[c.label] ?? c.label,
    value: c.value,
    color: CHANNEL_COLORS[c.label] ?? "var(--color-neutral-400)",
  }));

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Analytics</h1>

      <Suspense fallback={null}>
        <FilterBar current={data.filter} categories={data.filterOptions.categories} agents={data.filterOptions.agents} />
      </Suspense>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard label="Total tickets" value={data.kpis.totalInRange} />
        <StatCard label="Open" value={data.kpis.openInRange} sub={`${data.kpis.unassignedOpenInRange} unassigned`} />
        <StatCard label="Avg first response" value={hours(data.kpis.avgFirstResponseHours)} />
        <StatCard label="Avg resolution time" value={hours(data.kpis.avgResolutionHours)} />
        <StatCard
          label="SLA compliance"
          value={pct(data.kpis.slaComplianceRate)}
          sub={`${data.kpis.slaAtRiskCount} at risk`}
        />
        <StatCard label="CSAT" value={data.kpis.avgCsatRating !== null ? `${data.kpis.avgCsatRating.toFixed(1)}/5` : "—"} />
        <StatCard label="AI deflection" value={pct(data.kpis.aiDeflectionRate)} sub="Based on date range only" />
        <StatCard
          label="Reopen rate"
          value={pct(data.kpis.reopenRate)}
          sub={`of ${data.kpis.resolvedInRange} resolved`}
        />
      </div>

      <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-5 mb-6">
        <h2 className="text-[13px] font-semibold mb-4">Tickets over time</h2>
        <TrendChart data={data.dailySeries} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-5">
          <h2 className="text-[13px] font-semibold mb-1">Clients by region</h2>
          <p className="text-[11px] text-[var(--color-neutral-500)] mb-4">
            Approximate — shaded by ticket volume, populates going forward only
          </p>
          {data.regionBreakdown.length > 0 ? (
            <InteractiveRegionMap regions={data.regionBreakdown} />
          ) : (
            <p className="text-[13px] text-[var(--color-neutral-500)]">No region data yet for this range.</p>
          )}
        </div>
        <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-5">
          <h2 className="text-[13px] font-semibold mb-4">Top regions</h2>
          {data.regionBreakdown.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead className="text-[11px] uppercase-label text-[var(--color-neutral-500)]">
                  <tr>
                    <th className="text-left font-semibold pb-2">Region</th>
                    <th className="text-right font-semibold pb-2">Tickets</th>
                    <th className="text-right font-semibold pb-2">Avg res.</th>
                  </tr>
                </thead>
                <tbody>
                  {data.regionBreakdown.map((r) => (
                    <tr key={r.code ?? r.label} className="border-t border-black/5 dark:border-white/10">
                      <td className="py-2 font-medium">{r.label}</td>
                      <td className="py-2 text-right font-mono tabular-nums">{r.value}</td>
                      <td className="py-2 text-right font-mono tabular-nums">
                        {r.avgResolutionHours !== null ? `${r.avgResolutionHours.toFixed(1)}h` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-[13px] text-[var(--color-neutral-500)]">No region data yet for this range.</p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-5">
          <h2 className="text-[13px] font-semibold mb-4">By category</h2>
          {categorySegments.length > 0 ? (
            <AxisBarChart items={categorySegments} />
          ) : (
            <p className="text-[13px] text-[var(--color-neutral-500)]">No tickets in this range.</p>
          )}
        </div>
        <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-5">
          <h2 className="text-[13px] font-semibold mb-4">By channel</h2>
          {channelSegments.length > 0 ? (
            <AxisBarChart items={channelSegments} />
          ) : (
            <p className="text-[13px] text-[var(--color-neutral-500)]">No tickets in this range.</p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-5">
          <h2 className="text-[13px] font-semibold mb-4">Agent leaderboard</h2>
          <AgentLeaderboard rows={data.agentLeaderboard} />
        </div>
        <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-5">
          <h2 className="text-[13px] font-semibold mb-1">Peak hours</h2>
          <p className="text-[11px] text-[var(--color-neutral-500)] mb-4">Ticket volume by day and hour</p>
          <HeatmapChart grid={data.heatmap} />
        </div>
      </div>
    </div>
  );
}
