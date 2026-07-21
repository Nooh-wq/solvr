import Link from "next/link";
import { listTenantsWithHealth, startImpersonation } from "@/actions/super";
import { EmptyState } from "@/components/empty-state";

export const dynamic = "force-dynamic";

export default async function ImpersonationPage() {
  const tenants = await listTenantsWithHealth();
  const clients = tenants.filter((t) => t.type === "CLIENT");

  async function impersonateAction(formData: FormData) {
    "use server";
    const tenantId = String(formData.get("tenantId") ?? "");
    if (!tenantId) return;
    await startImpersonation(tenantId);
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">Impersonation</h1>
      <p className="text-sm text-[var(--color-neutral-600)] mb-6 max-w-2xl">
        Step into a customer tenant to help debug something they&apos;re seeing. Every impersonation
        session is audited on both sides &mdash; the start and end events land in{" "}
        <Link href="/admin/audit-log" className="underline">
          Audit log
        </Link>{" "}
        under the target tenant.
      </p>

      <div className="p-4 mb-6 rounded-2xl bg-[var(--color-warning)]/10 border border-[var(--color-warning)]/40 text-[13px] text-[var(--color-neutral-700)]">
        <div className="font-semibold text-[var(--color-warning)] mb-1">Before you start</div>
        Impersonation drops you into the target tenant as an <code>ADMIN</code>. You&apos;ll see
        their data as they see it, and any action you take is attributed to you in their audit log.
        Use <Link href="/admin/super" className="underline">Tenant management → Stop impersonating</Link>{" "}
        (or the top-of-page banner) to return.
      </div>

      {clients.length === 0 ? (
        <EmptyState
          title="No client tenants yet"
          description="Provision a client tenant from Tenant management before impersonating."
          primaryCta={{ label: "Tenant management", href: "/admin/super" }}
        />
      ) : (
        <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-[var(--color-light-gray)] text-[11px] uppercase-label text-[var(--color-neutral-700)]">
              <tr>
                <th className="text-left font-semibold px-4 py-2.5">Tenant</th>
                <th className="text-left font-semibold px-4 py-2.5">Status</th>
                <th className="text-left font-semibold px-4 py-2.5">Users</th>
                <th className="text-left font-semibold px-4 py-2.5">Tickets</th>
                <th className="text-right font-semibold px-4 py-2.5">Action</th>
              </tr>
            </thead>
            <tbody>
              {clients.map((t) => (
                <tr key={t.id} className="border-t border-[var(--color-neutral-100)]">
                  <td className="px-4 py-3">
                    <div className="font-medium">{t.name}</div>
                    <div className="text-[11px] text-[var(--color-neutral-500)] font-mono">{t.slug}</div>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`text-[11px] uppercase-label px-2 py-0.5 rounded-full ${
                        t.status === "ACTIVE"
                          ? "bg-[var(--color-success)]/10 text-[var(--color-success)]"
                          : "bg-[var(--color-neutral-100)]"
                      }`}
                    >
                      {t.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-[12px]">{t.userCount}</td>
                  <td className="px-4 py-3 font-mono text-[12px]">{t.ticketCount}</td>
                  <td className="px-4 py-3 text-right">
                    <form action={impersonateAction}>
                      <input type="hidden" name="tenantId" value={t.id} />
                      <button
                        type="submit"
                        className="text-[12px] font-medium px-3 py-1.5 rounded-lg bg-[var(--color-primary)] text-[var(--color-on-primary)] hover:opacity-90 cursor-pointer"
                      >
                        Impersonate
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
