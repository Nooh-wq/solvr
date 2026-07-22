import Link from "next/link";
import { notFound } from "next/navigation";
import { resolveHelpCenterBySlug } from "@/actions/helpCenters";
import { listPublicCommunityPosts } from "@/actions/publicHelpCenter";

export default async function CommunityHomePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const hc = await resolveHelpCenterBySlug(slug);
  if (!hc) notFound();
  const posts = await listPublicCommunityPosts(hc.tenantId, hc.helpCenterId);

  return (
    <div className="min-h-screen app-shell-bg">
      <div className="max-w-3xl mx-auto px-6 py-12">
        <Link
          href={`/help/${slug}`}
          className="text-[12px] text-[var(--color-neutral-600)] hover:underline"
        >
          ← {hc.name}
        </Link>
        <h1 className="text-3xl font-bold mt-2 mb-6">Community</h1>
        {posts.length === 0 ? (
          <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-8 text-center text-sm text-[var(--color-neutral-600)]">
            No community discussions yet.
          </div>
        ) : (
          <div className="space-y-3">
            {posts.map((p) => (
              <Link
                key={p.id}
                href={`/help/${slug}/community/${p.id}`}
                className="block bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-5 hover:border-[var(--color-primary)] transition-colors"
              >
                <div className="flex items-start justify-between gap-3 mb-1">
                  <div className="text-[14px] font-semibold">{p.title}</div>
                  {p.status === "SOLVED" ? (
                    <span className="text-[10px] uppercase-label px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800">
                      Solved
                    </span>
                  ) : null}
                </div>
                <div className="text-[12px] text-[var(--color-neutral-600)]">
                  {p.upvoteCount} upvotes · {p.replyCount} replies ·{" "}
                  {new Date(p.createdAt).toLocaleDateString()}
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
