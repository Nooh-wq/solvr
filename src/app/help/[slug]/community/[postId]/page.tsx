import Link from "next/link";
import { notFound } from "next/navigation";
import { resolveHelpCenterBySlug } from "@/actions/helpCenters";
import { getPublicCommunityPost } from "@/actions/publicHelpCenter";

export default async function CommunityPostPage({
  params,
}: {
  params: Promise<{ slug: string; postId: string }>;
}) {
  const { slug, postId } = await params;
  const hc = await resolveHelpCenterBySlug(slug);
  if (!hc) notFound();
  const post = await getPublicCommunityPost(hc.tenantId, hc.helpCenterId, postId);
  if (!post) notFound();

  return (
    <div className="min-h-screen app-shell-bg">
      <div className="max-w-3xl mx-auto px-6 py-12">
        <Link
          href={`/help/${slug}/community`}
          className="text-[12px] text-[var(--color-neutral-600)] hover:underline"
        >
          ← Community
        </Link>
        <div className="mt-2 mb-4 flex items-start justify-between gap-3">
          <h1 className="text-2xl font-bold">{post.title}</h1>
          {post.status === "SOLVED" ? (
            <span className="text-[10px] uppercase-label px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800">
              Solved
            </span>
          ) : null}
        </div>
        <article className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-5 mb-6">
          <div className="text-[11px] uppercase-label text-[var(--color-neutral-500)] mb-2">
            {post.upvoteCount} upvotes · {new Date(post.createdAt).toLocaleString()}
          </div>
          <div className="text-[13px] whitespace-pre-wrap">{post.body}</div>
        </article>

        <div className="text-[12px] uppercase-label text-[var(--color-neutral-700)] mb-3">
          {post.replies.length} {post.replies.length === 1 ? "reply" : "replies"}
        </div>
        <div className="space-y-3">
          {post.replies.map((r) => (
            <div
              key={r.id}
              className={`border rounded-2xl p-5 ${
                r.isBestAnswer
                  ? "bg-emerald-50 dark:bg-emerald-900/10 border-emerald-200 dark:border-emerald-800"
                  : "bg-[var(--color-surface)] border-[var(--color-neutral-300)]"
              }`}
            >
              {r.isBestAnswer ? (
                <div className="text-[10px] uppercase-label text-emerald-700 mb-1">
                  ✓ Best answer
                </div>
              ) : null}
              <div className="text-[11px] text-[var(--color-neutral-500)] mb-2">
                {r.upvoteCount} upvotes · {new Date(r.createdAt).toLocaleString()}
              </div>
              <div className="text-[13px] whitespace-pre-wrap">{r.body}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
