import { Suspense } from "react";
import { getAnalyticsOverview } from "@/actions/admin";
import { TrendChart, AxisBarChart, HeatmapChart } from "@/components/charts";
import { InteractiveRegionMap } from "@/components/region-map";
import { FilterBar } from "./filter-bar";
import { AgentLeaderboard } from "./agent-leaderboard";

// M13.2 — KPI card renders only when it has a value AND (optionally)
// a prior value to compare to. Nulls are omitted, not shown as "—" —
// spec §3 "Do NOT show KPI cards for data you don't have."
function StatCard({
  label,
  value,
  sub,
  delta,
  isBetter,
}: {
  label: string;
  value: string | number | null;
  sub?: string;
  delta?: number | null;
  /** For directional colour: for "Avg first response" a smaller number is better. Defaults to "up is better". */
  isBetter?: (delta: number) => boolean;
}) {
  if (value === null || value === "—") return null;
  const arrow = delta === null || delta === undefined
    ? null
    : delta === 0
      ? { symbol: "→", tone: "neutral" as const }
      : (isBetter ?? ((d) => d > 0))(delta)
        ? { symbol: delta > 0 ? "▲" : "▼", tone: "good" as const }
        : { symbol: delta > 0 ? "▲" : "▼", tone: "bad" as const };
  const toneClass =
    arrow?.tone === "good"
      ? "text-emerald-600 dark:text-emerald-400"
      : arrow?.tone === "bad"
        ? "text-red-600 dark:text-red-400"
        : "text-[var(--color-neutral-500)]";
  return (
    <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-5">
      <p className="uppercase-label text-[11px] text-[var(--color-neutral-600)] mb-2">{label}</p>
      <div className="flex items-baseline gap-2">
        <p className="text-2xl font-bold font-mono">{value}</p>
        {arrow && delta !== 0 && (
          <span className={`text-[11px] font-medium ${toneClass}`}>
            {arrow.symbol} {Math.abs(delta ?? 0).toFixed(delta && Math.abs(delta) < 10 ? 1 : 0)}
            {typeof value === "string" && value.endsWith("%") ? "pp" : ""}
          </span>
        )}
      </div>
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
  return v !== null ? `${Math.round(v * 100)}%` : null;
}

function hours(v: number | null) {
  return v !== null ? `${v.toFixed(1)}h` : null;
}

// M13.2 — pct-point delta between two 0..1 rates, or null if either
// side is null. Returns integer percent points; the arrow renderer
// tags "pp" onto values that are already percentages.
function pctDelta(now: number | null, prev: number | null): number | null {
  if (now === null || prev === null) return null;
  return Math.round((now - prev) * 100);
}

function hoursDelta(now: number | null, prev: number | null): number | null {
  if (now === null || prev === null) return null;
  return now - prev;
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
    organizationId: sp.organizationId,
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

  // M13.2 — assemble delta values once so JSX stays readable.
  const totalDelta = data.kpis.totalInRange - data.priorKpis.totalInRange;
  const resolvedDelta = data.kpis.resolvedInRange - data.priorKpis.resolvedInRange;
  const firstResponseDelta = hoursDelta(
    data.kpis.avgFirstResponseHours,
    data.priorKpis.avgFirstResponseHours
  );

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Analytics</h1>

      <Suspense fallback={null}>
        <FilterBar
          current={data.filter}
          categories={data.filterOptions.categories}
          agents={data.filterOptions.agents}
          organizations={data.filterOptions.organizations}
        />
      </Suspense>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard
          label="Total tickets"
          value={data.kpis.totalInRange}
          delta={data.priorKpis.totalInRange > 0 ? totalDelta : null}
        />
        <StatCard
          label="Open"
          value={data.kpis.openInRange}
          sub={`${data.kpis.unassignedOpenInRange} unassigned`}
        />
        <StatCard
          label="Resolved"
          value={data.kpis.resolvedInRange}
          delta={data.priorKpis.resolvedInRange > 0 ? resolvedDelta : null}
        />
        <StatCard
          label="Avg first response"
          value={hours(data.kpis.avgFirstResponseHours)}
          delta={firstResponseDelta}
          // Lower first-response is better — invert the "up is better" default.
          isBetter={(d) => d < 0}
        />
        <StatCard
          label="Avg resolution time"
          value={hours(data.kpis.avgResolutionHours)}
        />
        <StatCard
          label="SLA compliance"
          value={pct(data.kpis.slaComplianceRate)}
          sub={
            data.kpis.slaComplianceRate !== null
              ? `${data.kpis.slaAtRiskCount} at risk`
              : undefined
          }
        />
        <StatCard label="CSAT" value={data.kpis.avgCsatRating !== null ? `${data.kpis.avgCsatRating.toFixed(1)}/5` : null} />
        <StatCard label="AI deflection" value={pct(data.kpis.aiDeflectionRate)} />
        <StatCard
          label="Reopen rate"
          value={pct(data.kpis.reopenRate)}
          sub={
            data.kpis.reopenRate !== null
              ? `of ${data.kpis.resolvedInRange} resolved`
              : undefined
          }
          isBetter={(d) => d < 0}
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
