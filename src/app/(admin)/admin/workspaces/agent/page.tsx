import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { withRls } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Agent workspace defaults. This surface is deliberately a light hub
 * rather than a heavy editor — most preferences (theme, shortcuts,
 * notifications) live on the individual agent's profile at
 * /settings/profile, and the tenant-wide bits that DO exist
 * (default shared views, canned responses, macros) are managed on
 * their own pages linked here.
 */
export default async function AgentWorkspacePage() {
  const session = await requireSession({ minRole: "ADMIN" });
  const [savedViewCount, cannedCount, macroCount] = await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    (tx) =>
      Promise.all([
        tx.savedView.count({ where: { tenantId: session.tenantId, ownerTeamMemberId: null } }),
        tx.cannedResponse.count({ where: { tenantId: session.tenantId } }),
        tx.macro.count({ where: { tenantId: session.tenantId } }),
      ])
  );

  const cards: Array<{ href: string; title: string; description: string; badge?: string }> = [
    {
      href: "/admin/workspaces/views",
      title: "Shared views",
      description: "Queue filters every agent sees by default.",
      badge: `${savedViewCount} shared`,
    },
    {
      href: "/admin/canned-responses",
      title: "Canned responses",
      description: "Reusable reply templates agents can insert with a shortcut.",
      badge: `${cannedCount}`,
    },
    {
      href: "/admin/macros",
      title: "Macros",
      description: "Multi-step actions agents can apply to a ticket with one click.",
      badge: `${macroCount}`,
    },
    {
      href: "/admin/routing",
      title: "Routing rules",
      description: "How incoming tickets get assigned to agents and groups.",
    },
    {
      href: "/admin/csat",
      title: "CSAT & feedback",
      description: "Surveys agents can trigger from ticket detail.",
    },
    {
      href: "/admin/workspaces/layout",
      title: "Ticket layout",
      description: "What fields appear in what order on the ticket page.",
    },
  ];

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">Agent workspace</h1>
      <p className="text-sm text-[var(--color-neutral-600)] mb-6 max-w-2xl">
        Tenant-wide defaults for the agent workspace. Individual agent preferences (theme,
        keyboard shortcuts, notification opt-ins) live under each agent&apos;s{" "}
        <Link href="/settings/profile" className="underline">
          profile
        </Link>
        .
      </p>

      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {cards.map((c) => (
          <Link
            key={c.href}
            href={c.href}
            className="group p-4 rounded-2xl bg-[var(--color-surface)] border border-[var(--color-neutral-300)] hover:border-[var(--color-primary)] transition-colors"
          >
            <div className="flex items-start justify-between mb-2">
              <div className="font-semibold group-hover:text-[var(--color-primary)]">{c.title}</div>
              {c.badge ? (
                <span className="text-[10px] uppercase-label px-2 py-0.5 rounded-full bg-[var(--color-neutral-100)] text-[var(--color-neutral-600)]">
                  {c.badge}
                </span>
              ) : null}
            </div>
            <div className="text-[12px] text-[var(--color-neutral-600)]">{c.description}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}
