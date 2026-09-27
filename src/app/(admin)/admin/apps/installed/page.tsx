import Link from "next/link";
import { listInstalledIntegrations } from "@/actions/marketplace";
import { InstalledList } from "./installed-list";

export default async function InstalledAppsPage() {
  const installs = await listInstalledIntegrations();
  return (
    <div>
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold mb-1">Installed apps</h1>
          <p className="text-sm text-[var(--color-neutral-600)]">
            Manage integrations wired to this tenant. Credentials are encrypted at rest.
          </p>
        </div>
        <Link
          href="/admin/apps/marketplace"
          className="text-[12px] font-medium px-3 py-1.5 rounded-lg border border-[var(--color-neutral-300)] hover:bg-[var(--color-neutral-100)]"
        >
          Browse marketplace
        </Link>
      </div>
      <InstalledList installs={installs} />
    </div>
  );
}
