import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { resolveHelpCenterBySlug } from "@/actions/helpCenters";
import { getPublicArticleBySlugOrId } from "@/actions/publicHelpCenter";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string; article: string }>;
}): Promise<Metadata> {
  const { slug, article } = await params;
  const hc = await resolveHelpCenterBySlug(slug);
  if (!hc) return {};
  const a = await getPublicArticleBySlugOrId(hc.tenantId, hc.helpCenterId, article);
  if (!a) return { title: hc.name };
  return {
    title: `${a.title} — ${hc.name}`,
    description: a.excerpt,
  };
}

export default async function HelpArticlePage({
  params,
}: {
  params: Promise<{ slug: string; article: string }>;
}) {
  const { slug, article } = await params;
  const hc = await resolveHelpCenterBySlug(slug);
  if (!hc) notFound();
  const a = await getPublicArticleBySlugOrId(hc.tenantId, hc.helpCenterId, article);
  if (!a) notFound();

  return (
    <div className="min-h-screen app-shell-bg">
      <div className="max-w-3xl mx-auto px-6 py-12">
        <Link
          href={`/help/${slug}`}
          className="text-[12px] text-[var(--color-neutral-600)] hover:underline"
        >
          ← {hc.name}
        </Link>
        <h1 className="text-3xl font-bold mt-2 mb-1">{a.title}</h1>
        <div className="text-[12px] text-[var(--color-neutral-500)] mb-6">
          Updated {new Date(a.updatedAt).toLocaleDateString()}
        </div>
        <article className="prose max-w-none whitespace-pre-wrap text-[14px] leading-relaxed">
          {a.body}
        </article>
      </div>
    </div>
  );
}
