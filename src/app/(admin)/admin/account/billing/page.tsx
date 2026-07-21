import { getBillingUsage } from "@/actions/accountSettings";

export const dynamic = "force-dynamic";

const PLAN_META: Record<string, { label: string; description: string; badge: string }> = {
  TRIAL: {
    label: "Trial",
    description: "Full-feature trial. Add a payment method before it ends to keep your data.",
    badge: "bg-[var(--color-warning)]/15 text-[var(--color-warning)]",
  },
  STARTER: {
    label: "Starter",
    description: "For small teams up to 5 agents.",
    badge: "bg-[var(--color-neutral-200)] text-[var(--color-neutral-700)]",
  },
  GROWTH: {
    label: "Growth",
    description: "For scaling support orgs with SLA and routing needs.",
    badge: "bg-[var(--color-primary)]/10 text-[var(--color-primary)]",
  },
  ENTERPRISE: {
    label: "Enterprise",
    description: "SSO, SCIM, BYOK, HIPAA, priority support.",
    badge: "bg-[var(--color-success)]/15 text-[var(--color-success)]",
  },
};

export default async function BillingPage() {
  const usage = await getBillingUsage();
  const plan = PLAN_META[usage.plan] ?? PLAN_META.TRIAL;
  const daysActive = Math.max(
    1,
    Math.floor((Date.now() - new Date(usage.createdAt).getTime()) / (24 * 60 * 60 * 1000))
  );

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">Billing</h1>
      <p className="text-sm text-[var(--color-neutral-600)] mb-6 max-w-2xl">
        Plan details and workspace usage. To change plans or update payment, contact your account
        rep or email <a href="mailto:sales@solvr.com" className="underline">sales@solvr.com</a>.
      </p>

      <div className="grid gap-4 md:grid-cols-2 max-w-4xl">
        <div className="p-5 bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl">
          <div className="flex items-start justify-between mb-2">
            <div>
              <div className="text-[11px] uppercase-label text-[var(--color-neutral-600)]">Current plan</div>
              <div className="text-[22px] font-semibold">{plan.label}</div>
            </div>
            <span className={`text-[11px] uppercase-label px-2 py-1 rounded-full ${plan.badge}`}>
              {usage.plan}
            </span>
          </div>
          <p className="text-[13px] text-[var(--color-neutral-600)] mb-4">{plan.description}</p>
          <dl className="grid grid-cols-2 gap-2 text-[12px]">
            <dt className="text-[var(--color-neutral-600)]">Seats used</dt>
            <dd className="text-right font-medium">
              {usage.activeTeamMemberCount}
              {usage.seatLimit ? <span className="text-[var(--color-neutral-500)]"> / {usage.seatLimit}</span> : null}
            </dd>
            <dt className="text-[var(--color-neutral-600)]">Workspace age</dt>
            <dd className="text-right font-medium">{daysActive} days</dd>
            {usage.trialEndsAt ? (
              <>
                <dt className="text-[var(--color-neutral-600)]">Trial ends</dt>
                <dd className="text-right font-medium">
                  {new Date(usage.trialEndsAt).toLocaleDateString()}
                </dd>
              </>
            ) : null}
          </dl>
        </div>

        <div className="p-5 bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl">
          <div className="text-[11px] uppercase-label text-[var(--color-neutral-600)] mb-1">Team</div>
          <div className="text-[22px] font-semibold mb-4">{usage.teamMemberCount}</div>
          <dl className="grid grid-cols-2 gap-2 text-[12px]">
            <dt className="text-[var(--color-neutral-600)]">Active</dt>
            <dd className="text-right font-medium">{usage.activeTeamMemberCount}</dd>
            <dt className="text-[var(--color-neutral-600)]">Customers</dt>
            <dd className="text-right font-medium">{usage.endUserCount.toLocaleString()}</dd>
          </dl>
        </div>

        <div className="p-5 bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl md:col-span-2">
          <div className="text-[11px] uppercase-label text-[var(--color-neutral-600)] mb-3">Usage (last 30 days)</div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <div className="text-[24px] font-semibold">{usage.ticketCountLast30Days.toLocaleString()}</div>
              <div className="text-[11px] uppercase-label text-[var(--color-neutral-500)]">Tickets created</div>
            </div>
            <div>
              <div className="text-[24px] font-semibold">{usage.messageCountLast30Days.toLocaleString()}</div>
              <div className="text-[11px] uppercase-label text-[var(--color-neutral-500)]">Messages sent</div>
            </div>
            <div>
              <div className="text-[24px] font-semibold">{usage.apiCallCountLast30Days.toLocaleString()}</div>
              <div className="text-[11px] uppercase-label text-[var(--color-neutral-500)]">API calls</div>
            </div>
          </div>
        </div>

        <div className="p-5 bg-[var(--color-neutral-100)] rounded-2xl md:col-span-2">
          <div className="text-[13px] font-semibold mb-1">Need to change plans?</div>
          <p className="text-[12px] text-[var(--color-neutral-700)] mb-3">
            Upgrades, downgrades, invoices, and payment method changes are handled by your account
            team. Reach out and we&apos;ll get back within one business day.
          </p>
          <a
            href="mailto:sales@solvr.com"
            className="inline-block text-[12px] font-medium px-4 py-2 rounded-lg bg-[var(--color-primary)] text-[var(--color-on-primary)] hover:opacity-90"
          >
            Contact sales
          </a>
        </div>
      </div>
    </div>
  );
}
