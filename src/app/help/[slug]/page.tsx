// M14.2 — public help center home. Path-based route. Fail-closed:
// unknown slug → notFound(). Custom-domain matches route via
// middleware rewrite (deferred; the slug path is the load-bearing
// entry today).

import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { resolveHelpCenterBySlug } from "@/actions/helpCenters";
import { listPublicHelpCenterArticles } from "@/actions/publicHelpCenter";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const hc = await resolveHelpCenterBySlug(slug);
  if (!hc) return {};
  return {
    title: `${hc.name} — Help center`,
    description: `Articles and community answers for ${hc.name}`,
  };
}

export default async function HelpCenterHome({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const hc = await resolveHelpCenterBySlug(slug);
  if (!hc) notFound();
  const articles = await listPublicHelpCenterArticles(hc.tenantId, hc.helpCenterId);

  return (
    <div className="min-h-screen app-shell-bg">
      <div className="max-w-4xl mx-auto px-6 py-12">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">{hc.name}</h1>
          <p className="text-[13px] text-[var(--color-neutral-600)]">
            Browse articles or ask the community. Your feedback helps everyone.
          </p>
        </div>

        <section className="mb-10">
          <div className="text-[12px] uppercase-label text-[var(--color-neutral-700)] mb-3">
            Articles
          </div>
          {articles.length === 0 ? (
            <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-8 text-center text-sm text-[var(--color-neutral-600)]">
              No published articles yet.
            </div>
          ) : (
            <div className="space-y-3">
              {articles.map((a) => (
                <Link
                  key={a.id}
                  href={`/help/${slug}/${a.slug ?? a.id}`}
                  className="block bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-5 hover:border-[var(--color-primary)] transition-colors"
                >
                  <div className="text-[15px] font-semibold mb-1">{a.title}</div>
                  <div className="text-[13px] text-[var(--color-neutral-600)]">{a.excerpt}</div>
                </Link>
              ))}
            </div>
          )}
        </section>

        <section>
          <Link
            href={`/help/${slug}/community`}
            className="inline-block text-[13px] font-medium text-[var(--color-primary)] hover:underline"
          >
            Visit the community →
          </Link>
        </section>
      </div>
    </div>
  );
}
