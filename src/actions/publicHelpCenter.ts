"use server";

// M14.2 — public-side reads for the /help/[slug] routes. These use a
// SUPER_ADMIN system context because callers are anonymous — the
// resolved help center's tenantId is the authority, and every query
// filters by (tenantId, helpCenterId + isPublished/APPROVED). Spec
// §3 pin: fail-closed on domain/slug mismatch — the resolver returns
// null and pages 404.

import { withRls } from "@/lib/db";

export type PublicArticleSummary = {
  id: string;
  slug: string | null;
  title: string;
  excerpt: string;
  updatedAt: string;
};

export type PublicArticleDetail = PublicArticleSummary & {
  body: string;
};

function excerpt(body: string, n = 180): string {
  const clean = body.replace(/\s+/g, " ").trim();
  return clean.length > n ? `${clean.slice(0, n)}…` : clean;
}

export async function listPublicHelpCenterArticles(
  tenantId: string,
  helpCenterId: string
): Promise<PublicArticleSummary[]> {
  return withRls({ tenantId, userId: null, role: "SUPER_ADMIN" }, async (tx) => {
    const rows = await tx.kbArticle.findMany({
      where: {
        tenantId,
        helpCenterId,
        isPublished: true,
      },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        slug: true,
        title: true,
        body: true,
        updatedAt: true,
      },
    });
    return rows.map((r) => ({
      id: r.id,
      slug: r.slug,
      title: r.title,
      excerpt: excerpt(r.body),
      updatedAt: r.updatedAt.toISOString(),
    }));
  });
}

export async function getPublicArticleBySlugOrId(
  tenantId: string,
  helpCenterId: string,
  slugOrId: string
): Promise<PublicArticleDetail | null> {
  return withRls({ tenantId, userId: null, role: "SUPER_ADMIN" }, async (tx) => {
    const row = await tx.kbArticle.findFirst({
      where: {
        tenantId,
        helpCenterId,
        isPublished: true,
        OR: [{ id: slugOrId }, { slug: slugOrId }],
      },
      select: {
        id: true,
        slug: true,
        title: true,
        body: true,
        updatedAt: true,
      },
    });
    if (!row) return null;
    return {
      id: row.id,
      slug: row.slug,
      title: row.title,
      excerpt: excerpt(row.body),
      body: row.body,
      updatedAt: row.updatedAt.toISOString(),
    };
  });
}

export type PublicCommunityPost = {
  id: string;
  title: string;
  body: string;
  status: string;
  upvoteCount: number;
  createdAt: string;
  replyCount: number;
};

export async function listPublicCommunityPosts(
  tenantId: string,
  helpCenterId: string
): Promise<PublicCommunityPost[]> {
  return withRls({ tenantId, userId: null, role: "SUPER_ADMIN" }, async (tx) => {
    const rows = await tx.communityPost.findMany({
      where: {
        tenantId,
        helpCenterId,
        status: { in: ["APPROVED", "SOLVED"] },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        title: true,
        body: true,
        status: true,
        upvoteCount: true,
        createdAt: true,
        _count: { select: { replies: true } },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      body: r.body,
      status: r.status,
      upvoteCount: r.upvoteCount,
      createdAt: r.createdAt.toISOString(),
      replyCount: r._count.replies,
    }));
  });
}

export async function getPublicCommunityPost(
  tenantId: string,
  helpCenterId: string,
  postId: string
): Promise<
  | ({
      replies: Array<{
        id: string;
        body: string;
        upvoteCount: number;
        isBestAnswer: boolean;
        createdAt: string;
      }>;
    } & PublicCommunityPost)
  | null
> {
  return withRls({ tenantId, userId: null, role: "SUPER_ADMIN" }, async (tx) => {
    const post = await tx.communityPost.findFirst({
      where: {
        tenantId,
        helpCenterId,
        id: postId,
        status: { in: ["APPROVED", "SOLVED"] },
      },
      include: {
        replies: {
          where: { status: "APPROVED" },
          orderBy: [{ isBestAnswer: "desc" }, { upvoteCount: "desc" }, { createdAt: "asc" }],
        },
      },
    });
    if (!post) return null;
    return {
      id: post.id,
      title: post.title,
      body: post.body,
      status: post.status,
      upvoteCount: post.upvoteCount,
      createdAt: post.createdAt.toISOString(),
      replyCount: post.replies.length,
      replies: post.replies.map((r) => ({
        id: r.id,
        body: r.body,
        upvoteCount: r.upvoteCount,
        isBestAnswer: r.isBestAnswer,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  });
}
