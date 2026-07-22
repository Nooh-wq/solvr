// Z10.4 — public per-organization dashboard.
//
// Verifies the org_analytics_share token, hydrates the analytics
// overview scoped strictly to the token's tenantId + organizationId,
// and renders a stripped-down view. Spec §3 pins encoded here:
//
//   - Signed link carries organizationId in the JWT; verifier trusts
//     ONLY that value. Any URL param that tries to broaden scope is
//     ignored (see the filter build below — organizationId comes from
//     `claims.organizationId`, not the searchParams).
//   - Internal-visibility custom fields never surface here. Currently
//     the shared view doesn't render CF values at all (a follow-up
//     surface — the KPIs / trend / breakdown widgets are the shape the
//     spec asks for). If a future card renders CF values, filter
//     `isInternal` out here. Enforcement lives in
//     src/lib/analytics/shared-cf-filter.ts as a shared helper.
//   - No FilterBar — holders can't broaden the scope. The range
//     dropdown is intentionally omitted for the same reason (though a
//     read-only range display is safe if we add one later).

import Image from "next/image";
import { verifyPurposeToken } from "@/core/auth/tokens";
import { getAnalyticsOverviewByTenant } from "@/actions/admin";
import { withRls } from "@/lib/db";
import { AxisBarChart, TrendChart, HeatmapChart } from "@/components/charts";

const CATEGORY_PALETTE = ["#ff6a00", "#ff8f40", "var(--foreground)", "#aeaeae", "#d6d6d6"];

function pct(v: number | null) {
  return v !== null ? `${Math.round(v * 100)}%` : null;
}
function hours(v: number | null) {
  return v !== null ? `${v.toFixed(1)}h` : null;
}

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

export default async function SharedOrgDashboardPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const claims = await verifyPurposeToken(token, "org_analytics_share");
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

  // Filter blob is HARD-CODED to the token's org. URL params are
  // ignored — a party holding the link can't broaden scope.
  const data = await getAnalyticsOverviewByTenant({
    tenantId: claims.tenantId,
    subjectId: null,
    role: "SUPER_ADMIN",
    rawFilter: { range: "30d", organizationId: claims.organizationId },
  });

  const [branding, org] = await Promise.all([
    withRls(
      { tenantId: claims.tenantId, userId: null, role: "SUPER_ADMIN" },
      (tx) => tx.tenantBranding.findUnique({ where: { tenantId: claims.tenantId } })
    ),
    withRls(
      { tenantId: claims.tenantId, userId: null, role: "SUPER_ADMIN" },
      (tx) =>
        tx.organization.findFirst({
          where: { id: claims.organizationId, tenantId: claims.tenantId },
          select: { id: true, name: true },
        })
    ),
  ]);
  const productName = branding?.productName ?? "Support";

  const primarySegments = data.primaryBreakdown.rows.map((r, i) => ({
    label: r.label,
    value: r.value,
    color: CATEGORY_PALETTE[i % CATEGORY_PALETTE.length],
  }));

  return (
    <div className="min-h-screen app-shell-bg px-6 py-8">
      <div className="max-w-5xl mx-auto">
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
            Read-only snapshot · scoped to {org?.name ?? "organization"}
          </span>
        </div>

        <h1 className="text-2xl font-bold mb-1">{org?.name ?? "Organization"} — Analytics</h1>
        <p className="text-[12px] text-[var(--color-neutral-600)] mb-6">
          Last 30 days. Only tickets belonging to this organization are shown.
        </p>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <StatCard label="Total tickets" value={data.kpis.totalInRange} />
          <StatCard
            label="Open"
            value={data.kpis.openInRange}
            sub={`${data.kpis.unassignedOpenInRange} unassigned`}
          />
          <StatCard label="Resolved" value={data.kpis.resolvedInRange} />
          <StatCard label="Avg first response" value={hours(data.kpis.avgFirstResponseHours)} />
          <StatCard label="Avg resolution" value={hours(data.kpis.avgResolutionHours)} />
          <StatCard
            label="SLA compliance"
            value={pct(data.kpis.slaComplianceRate)}
            sub={data.kpis.slaComplianceRate !== null ? `${data.kpis.slaAtRiskCount} at risk` : undefined}
          />
          <StatCard
            label="CSAT"
            value={data.kpis.avgCsatRating !== null ? `${data.kpis.avgCsatRating.toFixed(1)}/5` : null}
          />
        </div>

        <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-5 mb-6">
          <h2 className="text-[13px] font-semibold mb-4">Tickets over time</h2>
          <TrendChart data={data.dailySeries} />
        </div>

        <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-5 mb-6">
          <h2 className="text-[13px] font-semibold mb-4">By category</h2>
          {primarySegments.length > 0 ? (
            <AxisBarChart items={primarySegments} />
          ) : (
            <p className="text-[13px] text-[var(--color-neutral-500)]">No tickets in this range.</p>
          )}
        </div>

        <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-5 mb-6">
          <h2 className="text-[13px] font-semibold mb-1">Peak hours</h2>
          <HeatmapChart grid={data.heatmap} />
        </div>

        <p className="text-[11px] text-[var(--color-neutral-500)] mt-8 text-center">
          Read-only snapshot. Refresh to update.
        </p>
      </div>
    </div>
  );
}
