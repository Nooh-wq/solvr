// M-admin — Landing dashboard. Task-oriented, NOT analytics.
// Analytics moved to /admin/analytics section per spec §Landing.

import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { getAdminLandingData } from "@/actions/adminLanding";
import { RecentlyViewedCard } from "./recently-viewed-card";
import { SetupProgressCard } from "./setup-progress-card";

export default async function AdminLandingPage() {
  const session = await requireSession({ minRole: "ADMIN" });
  const data = await getAdminLandingData();
  const isSuper = session.role === "SUPER_ADMIN";

  const pendingItems: Array<{ label: string; count: number; href: string }> = [
    { label: "Users awaiting approval", count: data.pending.peopleAwaitingApproval, href: "/admin/people/pending" },
    { label: "KB suggestions", count: data.pending.kbSuggestions, href: "/admin/kb/suggestions" },
    { label: "AI actions awaiting approval", count: data.pending.aiActionsAwaitingApproval, href: "/agent/ai-actions" },
    { label: "Approval requests", count: data.pending.approvalRequests, href: "/portal/approvals" },
    { label: "Deletion requests", count: data.pending.accountDeletionRequests, href: "/admin/account-deletions" },
  ].filter((i) => i.count > 0);

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">Admin Center</h1>
      <p className="text-sm text-[var(--color-neutral-600)] mb-6">
        Configure Support and see what needs your attention.
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        <SetupProgressCard setup={data.setup} />

        <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-5">
          <h2 className="text-[13px] font-semibold mb-3">Pending items</h2>
          {pendingItems.length === 0 ? (
            <p className="text-[12px] text-[var(--color-neutral-500)]">Nothing needs your attention.</p>
          ) : (
            <ul className="space-y-2">
              {pendingItems.map((i) => (
                <li key={i.href}>
                  <Link href={i.href} className="flex justify-between items-center hover:underline text-[13px]">
                    <span>{i.label}</span>
                    <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-[var(--color-primary)] text-[var(--color-on-primary)]">
                      {i.count}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-5">
          <h2 className="text-[13px] font-semibold mb-3">Recent activity</h2>
          {data.recentActivity.length === 0 ? (
            <p className="text-[12px] text-[var(--color-neutral-500)]">No recent admin actions.</p>
          ) : (
            <ul className="space-y-2">
              {data.recentActivity.map((r) => (
                <li key={r.id} className="text-[12px] flex justify-between gap-3">
                  <span className="truncate">
                    <span className="font-medium">{r.action}</span>
                    {r.toValue ? <span className="text-[var(--color-neutral-600)]"> · {r.toValue}</span> : null}
                  </span>
                  <span className="text-[11px] text-[var(--color-neutral-500)] whitespace-nowrap">
                    {new Date(r.createdAt).toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <RecentlyViewedCard />
      </div>

      {isSuper ? (
        <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-5 mb-4">
          <h2 className="text-[13px] font-semibold mb-3">System health</h2>
          <p className="text-[12px] text-[var(--color-neutral-500)]">
            Cross-tenant health, database status, and job-queue metrics live in{" "}
            <Link href="/admin/super/analytics" className="underline">
              Super Admin → Cross-tenant analytics
            </Link>
            .
          </p>
        </div>
      ) : null}

      <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-5">
        <h2 className="text-[13px] font-semibold mb-3">Quick actions</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <QuickAction href="/admin/team-members" label="Invite team member" />
          <QuickAction href="/admin/fields" label="Create custom field" />
          <QuickAction href="/admin/sla-policies" label="Set up SLA policy" />
          <QuickAction href="/admin/channels" label="Configure channels" />
        </div>
      </div>
    </div>
  );
}

function QuickAction({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="rounded-xl border border-[var(--color-neutral-300)] p-4 text-[13px] font-medium hover:bg-[var(--color-neutral-100)] transition-colors block"
    >
      {label}
    </Link>
  );
}
