import { notFound } from "next/navigation";
import Link from "next/link";
import { getCatalogApp } from "@/actions/marketplace";
import { InstallForm } from "./install-form";

export default async function InstallPage({
  params,
}: {
  params: Promise<{ appKey: string }>;
}) {
  const { appKey } = await params;
  const app = await getCatalogApp(appKey);
  if (!app) notFound();
  return (
    <div className="max-w-2xl">
      <Link
        href="/admin/apps/marketplace"
        className="text-[12px] text-[var(--color-neutral-600)] hover:underline"
      >
        ← Marketplace
      </Link>
      <h1 className="text-2xl font-bold mt-2 mb-1">Install {app.name}</h1>
      <p className="text-sm text-[var(--color-neutral-600)] mb-6">{app.tagline}</p>
      <InstallForm app={app} />
    </div>
  );
}
