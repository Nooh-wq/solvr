// Z10.3 — dedicated per-organization analytics route.
//
// Renders the same widget composition as /admin/analytics but pre-scopes
// every query to a single organizationId and hides the Organization
// dropdown on the filter bar. Everything else — range, category, agent,
// priority, group, tag, CF filters, groupBy — still applies.

import { notFound } from "next/navigation";
import Link from "next/link";
import { Suspense } from "react";
import { getAnalyticsOverview } from "@/actions/admin";
import { loadOrganizationDetail } from "@/actions/organizations";
import { createOrgShareLink } from "@/actions/orgShare";
import { AxisBarChart, TrendChart } from "@/components/charts";
import { FilterBar } from "@/app/(admin)/admin/analytics/filter-bar";
import { ShareLinkButton } from "./share-link-button";

const CATEGORY_PALETTE = ["#ff6a00", "#ff8f40", "var(--foreground)", "#aeaeae", "#d6d6d6"];

export default async function OrgAnalyticsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const raw = await searchParams;
  const org = await loadOrganizationDetail(id).catch(() => null);
  if (!org) notFound();

  // Z10.3 — organizationId is FORCE-scoped from the URL param, never
  // from a ?organizationId= query string. Passing arbitrary URL params
  // through into getAnalyticsOverview would let a caller broaden scope
  // by tweaking the query string; we build the filter blob explicitly
  // and lean on the action's zod parse to reject unknowns.
  const data = await getAnalyticsOverview({
    range: (typeof raw.range === "string" && ["7d", "30d", "90d"].includes(raw.range)
      ? raw.range
      : "30d") as "7d" | "30d" | "90d",
    organizationId: id,
    // Any URL-supplied query params are optional; the underlying schema
    // rejects unknown values, so unrecognized strings become undefined.
    ...(typeof raw.categoryId === "string" ? { categoryId: raw.categoryId } : {}),
    ...(typeof raw.groupBy === "string" && ["category", "organization", "group", "tag", "agent"].includes(raw.groupBy)
      ? { groupBy: raw.groupBy as "category" | "organization" | "group" | "tag" | "agent" }
      : {}),
  });

  const primarySegments = data.primaryBreakdown.rows.map((r, i) => ({
    label: r.label,
    value: r.value,
    color: CATEGORY_PALETTE[i % CATEGORY_PALETTE.length],
  }));

  return (
    <div>
      <div className="flex items-start justify-between mb-6 gap-4">
        <div>
          <div className="text-[12px] text-[var(--color-neutral-600)] mb-1">
            <Link href="/admin/organizations" className="hover:underline">
              Organizations
            </Link>{" "}
            /{" "}
            <Link href={`/admin/organizations/${org.id}`} className="hover:underline">
              {org.name}
            </Link>
          </div>
          <h1 className="text-2xl font-bold">{org.name} — Analytics</h1>
        </div>
        <ShareLinkButton
          organizationId={org.id}
          createLink={async (days: number) => {
            "use server";
            return createOrgShareLink({ organizationId: org.id, days });
          }}
        />
      </div>

      <Suspense fallback={null}>
        <FilterBar
          current={data.filter}
          categories={data.filterOptions.categories}
          agents={data.filterOptions.agents}
          organizations={data.filterOptions.organizations}
          groups={data.filterOptions.groups}
          tags={data.filterOptions.tags}
          customFieldDefinitions={data.filterOptions.customFieldDefinitions}
          hideOrganization
        />
      </Suspense>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard label="Total tickets" value={data.kpis.totalInRange} />
        <StatCard label="Open" value={data.kpis.openInRange} />
        <StatCard label="Resolved" value={data.kpis.resolvedInRange} />
        <StatCard
          label="Avg first response"
          value={data.kpis.avgFirstResponseHours !== null ? `${data.kpis.avgFirstResponseHours.toFixed(1)}h` : "—"}
        />
      </div>

      <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-5 mb-6">
        <h2 className="text-[13px] font-semibold mb-4">Tickets over time</h2>
        <TrendChart data={data.dailySeries} />
      </div>

      <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-5">
        <h2 className="text-[13px] font-semibold mb-4">
          By {data.primaryBreakdown.dimension === "category" ? "category" : data.primaryBreakdown.dimension}
        </h2>
        {primarySegments.length > 0 ? (
          <AxisBarChart items={primarySegments} />
        ) : (
          <p className="text-[13px] text-[var(--color-neutral-500)]">No tickets in this range.</p>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-5">
      <p className="uppercase-label text-[11px] text-[var(--color-neutral-600)] mb-2">{label}</p>
      <p className="text-2xl font-bold font-mono">{value}</p>
    </div>
  );
}
