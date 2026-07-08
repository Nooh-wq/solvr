import { notFound } from "next/navigation";
import Link from "next/link";
import { ADMIN_SECTIONS, ADMIN_PAGE_CATALOG, type AdminSectionSlug } from "@/lib/admin-nav";

// Z7.4 — section landing page. Every one of the seven sections lands
// here so an admin who's new to the platform can orient without hunting
// through the collapsed nav tree. Empty sections (Channels, Apps &
// Integrations) still render a card explaining what will live under
// them — a deliberate honesty over placeholder features.

export default async function AdminSectionLanding({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const section = ADMIN_SECTIONS.find((s) => s.slug === slug);
  if (!section) notFound();
  const pages = ADMIN_PAGE_CATALOG.filter((p) => p.section === (slug as AdminSectionSlug));

  return (
    <div className="space-y-6">
      <div>
        <div className="text-[11px] uppercase tracking-wider text-[var(--color-neutral-500)] font-semibold">Admin Center</div>
        <h1 className="text-2xl font-semibold text-[var(--foreground)] mt-1">{section.label}</h1>
        <p className="mt-2 text-[13px] text-[var(--color-neutral-600)] max-w-2xl">{section.description}</p>
      </div>

      {pages.length === 0 ? (
        <div className="rounded-xl border border-black/5 dark:border-white/10 bg-[var(--color-surface)] p-8 text-center">
          <div className="text-[13px] font-medium text-[var(--foreground)]">Nothing here yet</div>
          <p className="mt-1 text-[12px] text-[var(--color-neutral-500)] max-w-sm mx-auto">
            {section.description} Configuration surfaces for this section are on the roadmap and will appear here.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {pages.map((p) => (
            <Link
              key={p.href}
              href={p.href}
              className="group rounded-xl border border-black/5 dark:border-white/10 bg-[var(--color-surface)] p-4 hover:border-[var(--color-primary)]/30 hover:shadow-[0_4px_16px_-6px_rgba(0,0,0,0.08)] transition-all duration-150 cursor-pointer"
            >
              <div className="text-[13px] font-semibold text-[var(--foreground)] group-hover:text-[var(--color-primary)] transition-colors duration-150">
                {p.label}
              </div>
              {p.keywords.length > 0 && (
                <div className="mt-1.5 text-[11px] text-[var(--color-neutral-500)] line-clamp-2">
                  {p.keywords.slice(0, 4).join(" · ")}
                </div>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
