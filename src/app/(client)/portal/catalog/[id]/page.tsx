import Link from "next/link";
import { notFound } from "next/navigation";
import { getCatalogItemWithFields } from "@/actions/serviceCatalog";
import { CatalogRequestForm } from "./catalog-request-form";

export default async function CatalogRequestPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const data = await getCatalogItemWithFields(id);
  if (!data) notFound();

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <Link
        href="/portal/catalog"
        className="text-[12px] text-[var(--color-neutral-600)] hover:underline"
      >
        ← Catalog
      </Link>
      <div className="flex items-center gap-3 mt-2 mb-1">
        {data.item.iconEmoji ? <span className="text-3xl">{data.item.iconEmoji}</span> : null}
        <h1 className="text-2xl font-bold">{data.item.name}</h1>
      </div>
      <p className="text-sm text-[var(--color-neutral-600)] mb-6">{data.item.description}</p>
      {data.item.requiresApproval ? (
        <div className="mb-6 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-md p-3 text-[12px] text-amber-800 dark:text-amber-200">
          This request needs approval before it can be fulfilled. You&apos;ll be notified when a
          decision is made.
        </div>
      ) : null}
      <CatalogRequestForm catalogItemId={data.item.id} fields={data.fields} />
    </div>
  );
}
