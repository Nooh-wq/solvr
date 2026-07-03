import { getReportStats } from "@/actions/admin";

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-white border border-[var(--color-neutral-300)] rounded p-5">
      <p className="uppercase-label text-[11px] text-[var(--color-neutral-600)] mb-2">{label}</p>
      <p className="text-2xl font-bold font-mono">{value}</p>
    </div>
  );
}

const STATUS_LABELS: Record<string, string> = {
  OPEN: "Open",
  IN_PROGRESS: "In progress",
  PENDING: "Pending",
  RESOLVED: "Resolved",
  CLOSED: "Closed",
};

export default async function AdminOverviewPage() {
  const stats = await getReportStats();

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Overview</h1>

      <div className="grid grid-cols-4 gap-4 mb-8">
        <StatCard label="Total tickets" value={stats.total} />
        <StatCard label="Unassigned (open)" value={stats.unassigned} />
        <StatCard
          label="Avg first response"
          value={stats.avgFirstResponseHours !== null ? `${stats.avgFirstResponseHours.toFixed(1)}h` : "—"}
        />
        <StatCard label="Open" value={stats.byStatus.OPEN ?? 0} />
      </div>

      <div className="grid grid-cols-2 gap-6">
        <div className="bg-white border border-[var(--color-neutral-300)] rounded p-5">
          <h2 className="text-[13px] font-semibold mb-4">By status</h2>
          <div className="space-y-2">
            {Object.entries(STATUS_LABELS).map(([key, label]) => (
              <div key={key} className="flex items-center justify-between text-sm">
                <span className="text-[var(--color-neutral-700)]">{label}</span>
                <span className="font-mono font-semibold">{stats.byStatus[key] ?? 0}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="bg-white border border-[var(--color-neutral-300)] rounded p-5">
          <h2 className="text-[13px] font-semibold mb-4">By priority</h2>
          <div className="space-y-2">
            {["LOW", "MEDIUM", "HIGH", "URGENT"].map((key) => (
              <div key={key} className="flex items-center justify-between text-sm">
                <span className="text-[var(--color-neutral-700)]">{key}</span>
                <span className="font-mono font-semibold">{stats.byPriority[key] ?? 0}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
