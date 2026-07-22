import Link from "next/link";
import { listActiveCatalogItems } from "@/actions/serviceCatalog";
import { getTenantServiceMode } from "@/actions/serviceMode";
import { labelsFor } from "@/lib/service-mode/labels";

export default async function PortalCatalogPage() {
  const [items, mode] = await Promise.all([
    listActiveCatalogItems(),
    getTenantServiceMode(),
  ]);
  const L = labelsFor(mode);

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold mb-1">{L.catalog}</h1>
      <p className="text-sm text-[var(--color-neutral-600)] mb-6">
        Pick the {L.ticket.toLowerCase()} type that matches what you need.
      </p>
      {items.length === 0 ? (
        <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-8 text-center text-sm text-[var(--color-neutral-600)]">
          No catalog items yet. Ask your admin to add some in Admin → Service catalog.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {items.map((it) => (
            <Link
              key={it.id}
              href={`/portal/catalog/${it.id}`}
              className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-5 hover:border-[var(--color-primary)] transition-colors cursor-pointer"
            >
              <div className="text-3xl mb-2">{it.iconEmoji ?? "📋"}</div>
              <div className="text-[14px] font-semibold mb-1">{it.name}</div>
              <div className="text-[12px] text-[var(--color-neutral-600)] line-clamp-3">
                {it.description}
              </div>
              {it.requiresApproval ? (
                <div className="mt-3 text-[10px] uppercase-label text-[var(--color-neutral-500)]">
                  Requires approval
                </div>
              ) : null}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
