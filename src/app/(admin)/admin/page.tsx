import { getReportStats } from "@/actions/admin";
import { TrendChart, DonutChart, BarList } from "@/components/charts";

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="bg-white border border-[var(--color-neutral-300)] rounded-xl p-5">
      <p className="uppercase-label text-[11px] text-[var(--color-neutral-600)] mb-2">{label}</p>
      <p className="text-2xl font-bold font-mono">{value}</p>
      {sub && <p className="text-[11px] text-[var(--color-neutral-500)] mt-1">{sub}</p>}
    </div>
  );
}

// Status/priority colors kept within the brand palette (neutral → warm ramp).
const STATUS_SEGMENTS: { key: string; label: string; color: string }[] = [
  { key: "OPEN", label: "Open", color: "#ff6a00" },
  { key: "IN_PROGRESS", label: "In progress", color: "#1a1a1a" },
  { key: "PENDING", label: "Pending", color: "#aeaeae" },
  { key: "RESOLVED", label: "Resolved", color: "#ffb380" },
  { key: "CLOSED", label: "Closed", color: "#d6d6d6" },
];

const PRIORITY_SEGMENTS: { key: string; label: string; color: string }[] = [
  { key: "URGENT", label: "Urgent", color: "#ff6a00" },
  { key: "HIGH", label: "High", color: "#ff8f40" },
  { key: "MEDIUM", label: "Medium", color: "#aeaeae" },
  { key: "LOW", label: "Low", color: "#d6d6d6" },
];

export default async function AdminOverviewPage() {
  const stats = await getReportStats();

  const created30 = stats.dailySeries.reduce((s, d) => s + d.created, 0);
  const resolved30 = stats.dailySeries.reduce((s, d) => s + d.resolved, 0);

  const statusSegments = STATUS_SEGMENTS.map((s) => ({ label: s.label, value: stats.byStatus[s.key] ?? 0, color: s.color }));
  const prioritySegments = PRIORITY_SEGMENTS.map((s) => ({ label: s.label, value: stats.byPriority[s.key] ?? 0, color: s.color }));

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Overview</h1>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard label="Total tickets" value={stats.total} />
        <StatCard label="Open" value={stats.byStatus.OPEN ?? 0} sub={`${stats.unassigned} unassigned`} />
        <StatCard label="Created (30d)" value={created30} sub={`${resolved30} resolved`} />
        <StatCard
          label="Avg first response"
          value={stats.avgFirstResponseHours !== null ? `${stats.avgFirstResponseHours.toFixed(1)}h` : "—"}
        />
      </div>

      <div className="bg-white border border-[var(--color-neutral-300)] rounded-xl p-5 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-[13px] font-semibold">Tickets over time</h2>
          <div className="flex items-center gap-4 text-[11px] text-[var(--color-neutral-600)]">
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-3 rounded-full bg-[var(--color-primary)]" /> Created
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-0.5 w-3 bg-[var(--color-neutral-700)]" /> Resolved
            </span>
            <span className="text-[var(--color-neutral-400)]">last 30 days</span>
          </div>
        </div>
        <TrendChart data={stats.dailySeries} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white border border-[var(--color-neutral-300)] rounded-xl p-5">
          <h2 className="text-[13px] font-semibold mb-4">By status</h2>
          <DonutChart segments={statusSegments} total={stats.total} />
        </div>
        <div className="bg-white border border-[var(--color-neutral-300)] rounded-xl p-5">
          <h2 className="text-[13px] font-semibold mb-4">By priority</h2>
          <BarList items={prioritySegments} />
        </div>
      </div>
    </div>
  );
}
