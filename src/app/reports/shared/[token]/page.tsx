import Image from "next/image";
// B7.5: no cookie R/W here. Purpose literal stays "analytics_share"
// (snake_case) per §7.16 — every live 30-day share link in customer
// inboxes carries that exact claim.
import { verifyPurposeToken } from "@/core/auth/tokens";
import { getAnalyticsOverviewByTenant } from "@/actions/admin";
import { withRls } from "@/lib/db";
import { TrendChart, AxisBarChart, HeatmapChart } from "@/components/charts";

// M13 gap 2 — read-only shared analytics dashboard. Token in the URL
// carries the tenantId + filter; verify + hydrate + render. No
// interactivity beyond the trend chart's built-in series toggle: the
// FilterBar is intentionally omitted because whoever holds the link
// shouldn't be able to broaden its scope.

function StatCard({ label, value, sub }: { label: string; value: string | number | null; sub?: string }) {
  if (value === null) return null;
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

const pct = (v: number | null) => (v !== null ? `${Math.round(v * 100)}%` : null);
const hours = (v: number | null) => (v !== null ? `${v.toFixed(1)}h` : null);

export default async function SharedAnalyticsPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const claims = await verifyPurposeToken(token, "analytics_share");
  if (!claims) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6">
        <div className="max-w-md text-center">
          <h1 className="text-lg font-semibold mb-2">This link is no longer valid</h1>
          <p className="text-[13px] text-[var(--color-neutral-600)]">
            It may have expired or the URL wasn&apos;t copied correctly.
          </p>
        </div>
      </div>
    );
  }

  const data = await getAnalyticsOverviewByTenant({
    tenantId: claims.tenantId,
    subjectId: null,
    role: "SUPER_ADMIN",
    rawFilter: claims.filters,
  });

  // Tenant branding for the header — pulled directly under the token's
  // tenantId. Same withRls pattern as any other Support-owned read.
  const branding = await withRls(
    { tenantId: claims.tenantId, userId: null, role: "SUPER_ADMIN" },
    (tx) => tx.tenantBranding.findUnique({ where: { tenantId: claims.tenantId } })
  );
  const productName = branding?.productName ?? "Support";

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
    <div className="min-h-screen app-shell-bg px-6 py-8">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center gap-2 mb-6">
          {branding?.logoUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={branding.logoUrl} alt="" className="h-5 w-5 object-contain" />
          ) : (
            <Image
              src="/brand/solvr-wordmark-black.svg"
              alt={productName}
              width={84}
              height={30}
              className="dark:hidden"
            />
          )}
          <span className="text-[15px] font-semibold">{productName}</span>
          <span className="text-[11px] text-[var(--color-neutral-500)] ml-auto">
            Read-only snapshot · {data.filter.range}
          </span>
        </div>

        <h1 className="text-2xl font-bold mb-6">Analytics</h1>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <StatCard label="Total tickets" value={data.kpis.totalInRange} />
          <StatCard
            label="Open"
            value={data.kpis.openInRange}
            sub={`${data.kpis.unassignedOpenInRange} unassigned`}
          />
          <StatCard label="Resolved" value={data.kpis.resolvedInRange} />
          <StatCard label="Avg first response" value={hours(data.kpis.avgFirstResponseHours)} />
          <StatCard label="Avg resolution time" value={hours(data.kpis.avgResolutionHours)} />
          <StatCard
            label="SLA compliance"
            value={pct(data.kpis.slaComplianceRate)}
            sub={data.kpis.slaComplianceRate !== null ? `${data.kpis.slaAtRiskCount} at risk` : undefined}
          />
          <StatCard label="CSAT" value={data.kpis.avgCsatRating !== null ? `${data.kpis.avgCsatRating.toFixed(1)}/5` : null} />
          <StatCard label="AI deflection" value={pct(data.kpis.aiDeflectionRate)} />
        </div>

        <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-5 mb-6">
          <h2 className="text-[13px] font-semibold mb-4">Tickets over time</h2>
          <TrendChart data={data.dailySeries} />
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

        <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-5 mb-6">
          <h2 className="text-[13px] font-semibold mb-1">Peak hours</h2>
          <p className="text-[11px] text-[var(--color-neutral-500)] mb-4">Ticket volume by day and hour</p>
          <HeatmapChart grid={data.heatmap} />
        </div>

        <p className="text-[11px] text-[var(--color-neutral-500)] mt-8 text-center">
          This is a read-only snapshot. It updates each time you refresh the page.
        </p>
      </div>
    </div>
  );
}
