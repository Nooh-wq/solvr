import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { withRls } from "@/lib/db";
import { getAccountSettings } from "@/actions/accountSettings";
import { DomainEditor } from "./domain-editor";

export const dynamic = "force-dynamic";

export default async function DomainsPage() {
  const session = await requireSession({ minRole: "ADMIN" });
  const [settings, helpCenters] = await Promise.all([
    getAccountSettings(),
    withRls(
      { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
      (tx) =>
        tx.helpCenter.findMany({
          where: { tenantId: session.tenantId },
          select: { id: true, slug: true, name: true, customDomain: true },
          orderBy: { name: "asc" },
        })
    ),
  ]);

  const apex = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">Custom domains</h1>
      <p className="text-sm text-[var(--color-neutral-600)] mb-6 max-w-2xl">
        Serve your customer portal and help center from your own hostnames. Point a CNAME record
        at your Solvr endpoint, then set the hostname below.
      </p>

      <div className="space-y-6 max-w-3xl">
        <section>
          <h2 className="text-[15px] font-semibold mb-1">Customer portal</h2>
          <p className="text-[12px] text-[var(--color-neutral-600)] mb-3">
            Where end users open and reply to tickets. Falls back to{" "}
            <code className="text-[11px]">{apex.replace(/^https?:\/\//, "")}</code>.
          </p>
          <DomainEditor initialDomain={settings.customDomain ?? ""} />
        </section>

        <section>
          <h2 className="text-[15px] font-semibold mb-1">Help centers</h2>
          <p className="text-[12px] text-[var(--color-neutral-600)] mb-3">
            Each help center can have its own hostname. Manage from the help center editor.
          </p>
          {helpCenters.length === 0 ? (
            <div className="p-4 rounded-2xl border border-dashed border-[var(--color-neutral-300)] text-[13px] text-[var(--color-neutral-600)]">
              No help centers yet.{" "}
              <Link href="/admin/kb" className="underline">
                Create one
              </Link>
              .
            </div>
          ) : (
            <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-[var(--color-light-gray)] text-[11px] uppercase-label text-[var(--color-neutral-700)]">
                  <tr>
                    <th className="text-left font-semibold px-4 py-2.5">Help center</th>
                    <th className="text-left font-semibold px-4 py-2.5">Slug</th>
                    <th className="text-left font-semibold px-4 py-2.5">Custom domain</th>
                    <th className="text-right font-semibold px-4 py-2.5"></th>
                  </tr>
                </thead>
                <tbody>
                  {helpCenters.map((hc) => (
                    <tr key={hc.id} className="border-t border-[var(--color-neutral-100)]">
                      <td className="px-4 py-3 font-medium">{hc.name}</td>
                      <td className="px-4 py-3 font-mono text-[12px]">/{hc.slug}</td>
                      <td className="px-4 py-3 font-mono text-[12px]">
                        {hc.customDomain ?? <span className="text-[var(--color-neutral-500)]">—</span>}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link
                          href="/admin/kb"
                          className="text-[12px] font-medium px-3 py-1.5 rounded-lg border border-[var(--color-neutral-300)] hover:bg-[var(--color-neutral-100)]"
                        >
                          Edit
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="p-4 rounded-2xl bg-[var(--color-neutral-100)] text-[12px] text-[var(--color-neutral-700)]">
          <div className="font-semibold text-[13px] mb-1">DNS setup</div>
          <div>
            Create a CNAME record on your DNS provider pointing your hostname (e.g.{" "}
            <code>support.acme.com</code>) to{" "}
            <code>{apex.replace(/^https?:\/\//, "")}</code>.
          </div>
          <div className="mt-2">
            Once the record propagates, HTTPS is provisioned automatically.
          </div>
        </section>
      </div>
    </div>
  );
}
