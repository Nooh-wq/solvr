import Link from "next/link";
import { listCatalog, listInstalledIntegrations } from "@/actions/marketplace";

export default async function MarketplacePage() {
  const [catalog, installed] = await Promise.all([listCatalog(), listInstalledIntegrations()]);
  const installedByKey = new Map<string, number>();
  for (const i of installed) installedByKey.set(i.appKey, (installedByKey.get(i.appKey) ?? 0) + 1);

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">Marketplace</h1>
      <p className="text-sm text-[var(--color-neutral-600)] mb-6">
        Every app listed here is installable — no coming-soons. Installing an app makes it
        available as an Escalation Path destination and as an inline action on the ticket detail.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {catalog.map((app) => {
          const count = installedByKey.get(app.key) ?? 0;
          return (
            <div
              key={app.key}
              className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-5 flex flex-col gap-3"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-[15px] font-semibold">{app.name}</div>
                  <div className="text-[11px] uppercase-label text-[var(--color-neutral-500)] mt-0.5">
                    {app.category}
                  </div>
                </div>
                {count > 0 ? (
                  <span className="text-[10px] uppercase-label px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800">
                    Installed × {count}
                  </span>
                ) : null}
              </div>
              <p className="text-[13px] text-[var(--color-neutral-700)] flex-1">{app.tagline}</p>
              <Link
                href={`/admin/apps/marketplace/${app.key}/install`}
                className="text-[12px] font-medium px-3 py-1.5 rounded-lg bg-[var(--color-primary)] text-[var(--color-on-primary)] hover:opacity-90 text-center"
              >
                {count > 0 ? "Install another" : "Install"}
              </Link>
            </div>
          );
        })}
      </div>
      <div className="mt-8 text-[13px]">
        <Link href="/admin/apps/installed" className="underline">
          View installed apps →
        </Link>
      </div>
    </div>
  );
}
