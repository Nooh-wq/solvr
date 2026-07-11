import { getApiUsageOverview } from "@/actions/apiUsage";

export default async function ApiUsagePage() {
  const overview = await getApiUsageOverview();
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-2">API usage</h1>
      <p className="text-[13px] text-[var(--color-neutral-600)] mb-6">
        Last 7 days.
      </p>

      <div className="grid grid-cols-3 gap-4 mb-8 max-w-3xl">
        <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-neutral-600)]">Requests</p>
          <p className="text-2xl font-bold font-mono">{overview.totalRequests}</p>
        </div>
        <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-neutral-600)]">Errors</p>
          <p className="text-2xl font-bold font-mono">{overview.errorRequests}</p>
        </div>
        <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-neutral-600)]">Error rate</p>
          <p className="text-2xl font-bold font-mono">{pct(overview.errorRate)}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-4xl">
        <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-5">
          <h2 className="text-[13px] font-semibold mb-3">Top endpoints</h2>
          {overview.topEndpoints.length === 0 ? (
            <p className="text-[13px] text-[var(--color-neutral-500)]">No traffic yet.</p>
          ) : (
            <table className="w-full text-[12px]">
              <thead className="text-left text-[var(--color-neutral-500)]">
                <tr><th>Endpoint</th><th className="text-right">Requests</th><th className="text-right">Errors</th></tr>
              </thead>
              <tbody>
                {overview.topEndpoints.map((e) => (
                  <tr key={e.endpoint} className="border-t border-[var(--color-neutral-100)] dark:border-white/5">
                    <td className="py-1 font-mono text-[11px]">{e.endpoint}</td>
                    <td className="py-1 text-right font-mono">{e.count}</td>
                    <td className="py-1 text-right font-mono">{e.errorCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-5">
          <h2 className="text-[13px] font-semibold mb-3">By key</h2>
          {overview.perKey.length === 0 ? (
            <p className="text-[13px] text-[var(--color-neutral-500)]">No traffic yet.</p>
          ) : (
            <table className="w-full text-[12px]">
              <thead className="text-left text-[var(--color-neutral-500)]">
                <tr><th>Key</th><th className="text-right">Requests</th><th className="text-right">Errors</th></tr>
              </thead>
              <tbody>
                {overview.perKey.map((k) => (
                  <tr key={k.apiKeyId ?? "null"} className="border-t border-[var(--color-neutral-100)] dark:border-white/5">
                    <td className="py-1">{k.name}</td>
                    <td className="py-1 text-right font-mono">{k.count}</td>
                    <td className="py-1 text-right font-mono">{k.errorCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
