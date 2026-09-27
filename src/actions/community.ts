"use server";

// M14.3 / M14.4 — community forum + moderation + M10 KB suggestion feed.
//
// Spec §3 pins:
//   - Moderation defaults ON for new posts (via
//     HelpCenter.communityModerationDefault).
//   - Auto-index only "solved + upvoted" posts into RAG (spec: "Do NOT
//     auto-index every community post into RAG. Post must be flagged
//     as 'helpful' or 'solved' first").
//   - Fail-closed help-center resolution (the resolver returns null on
//     mismatch; every action here rejects with "Not found" then).

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withRls, prisma } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { actorCols, dualFkForUser } from "@/lib/z1-dual-fk";

const createPostSchema = z.object({
  helpCenterId: z.string().min(1),
  title: z.string().min(4).max(200),
  body: z.string().min(4).max(20_000),
});
const createReplySchema = z.object({
  postId: z.string().min(1),
  body: z.string().min(4).max(20_000),
});
const idSchema = z.object({ id: z.string().min(1) });
const upvoteSchema = z.object({
  postId: z.string().min(1).optional(),
  replyId: z.string().min(1).optional(),
});
const solvedSchema = z.object({
  postId: z.string().min(1),
  replyId: z.string().min(1),
});
const moderationSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["post", "reply"]),
  decision: z.enum(["APPROVED", "REJECTED"]),
});

export async function createCommunityPost(input: z.infer<typeof createPostSchema>) {
  const session = await requireSession();
  const data = createPostSchema.parse(input);
  return withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const hc = await tx.helpCenter.findFirst({
        where: { id: data.helpCenterId, tenantId: session.tenantId, isActive: true, communityEnabled: true },
      });
      if (!hc) throw new Error("Community not available");

      // Only end users create community posts (spec: it's a community
      // between customers). Staff can moderate but not author here.
      if (session.role !== "CLIENT") {
        throw new Error("Only community members can post");
      }

      const post = await tx.communityPost.create({
        data: {
          tenantId: session.tenantId,
          helpCenterId: hc.id,
          authorEndUserId: session.subjectId,
          title: data.title,
          body: data.body,
          status: hc.communityModerationDefault ? "PENDING" : "APPROVED",
        },
      });
      revalidatePath(`/help/${hc.slug}/community`);
      return { ok: true, id: post.id, status: post.status };
    }
  );
}

export async function createCommunityReply(input: z.infer<typeof createReplySchema>) {
  const session = await requireSession();
  const data = createReplySchema.parse(input);
  if (session.role !== "CLIENT") throw new Error("Only community members can reply");
  return withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const post = await tx.communityPost.findFirst({
        where: {
          id: data.postId,
          tenantId: session.tenantId,
          status: { in: ["APPROVED", "SOLVED"] },
        },
        include: { helpCenter: { select: { communityModerationDefault: true } } },
      });
      if (!post) throw new Error("Post not available");
      const reply = await tx.communityReply.create({
        data: {
          tenantId: session.tenantId,
          postId: post.id,
          authorEndUserId: session.subjectId,
          body: data.body,
          status: post.helpCenter.communityModerationDefault ? "PENDING" : "APPROVED",
        },
      });
      return { ok: true, id: reply.id };
    }
  );
}

export async function upvote(input: z.infer<typeof upvoteSchema>) {
  const session = await requireSession();
  const data = upvoteSchema.parse(input);
  if ((data.postId ? 1 : 0) + (data.replyId ? 1 : 0) !== 1) {
    throw new Error("Upvote must target exactly one of post or reply");
  }
  return withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      if (data.postId) {
        const dupe = await tx.communityUpvote.findFirst({
          where: {
            tenantId: session.tenantId,
            postId: data.postId,
            voterEndUserId: session.subjectId,
          },
        });
        if (dupe) return { ok: true, alreadyVoted: true };
        await tx.communityUpvote.create({
          data: {
            tenantId: session.tenantId,
            postId: data.postId,
            voterEndUserId: session.subjectId,
          },
        });
        await tx.communityPost.update({
          where: { id: data.postId },
          data: { upvoteCount: { increment: 1 } },
        });
        // M14.4 — cascade feed check.
        await maybeFeedToKbSuggestion(tx, session.tenantId, data.postId);
        return { ok: true };
      }
      // Reply upvote.
      const dupe = await tx.communityUpvote.findFirst({
        where: {
          tenantId: session.tenantId,
          replyId: data.replyId!,
          voterEndUserId: session.subjectId,
        },
      });
      if (dupe) return { ok: true, alreadyVoted: true };
      await tx.communityUpvote.create({
        data: {
          tenantId: session.tenantId,
          replyId: data.replyId!,
          voterEndUserId: session.subjectId,
        },
      });
      await tx.communityReply.update({
        where: { id: data.replyId! },
        data: { upvoteCount: { increment: 1 } },
      });
      const parent = await tx.communityReply.findUnique({
        where: { id: data.replyId! },
        select: { postId: true },
      });
      if (parent) await maybeFeedToKbSuggestion(tx, session.tenantId, parent.postId);
      return { ok: true };
    }
  );
}

/** Author or moderator marks a reply as best answer → post becomes SOLVED. */
export async function markReplyAsBestAnswer(input: z.infer<typeof solvedSchema>) {
  const session = await requireSession();
  const data = solvedSchema.parse(input);
  return withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const post = await tx.communityPost.findFirst({
        where: { id: data.postId, tenantId: session.tenantId },
      });
      if (!post) throw new Error("Not found");
      const isModerator = session.role === "AGENT" || session.role === "ADMIN" || session.role === "SUPER_ADMIN";
      if (!isModerator && post.authorEndUserId !== session.subjectId) {
        throw new Error("Only the author or a moderator can mark best answer");
      }
      await tx.communityReply.updateMany({
        where: { postId: post.id, tenantId: session.tenantId, isBestAnswer: true },
        data: { isBestAnswer: false },
      });
      await tx.communityReply.update({
        where: { id: data.replyId },
        data: { isBestAnswer: true },
      });
      await tx.communityPost.update({
        where: { id: post.id },
        data: { status: "SOLVED", bestReplyId: data.replyId },
      });
      await maybeFeedToKbSuggestion(tx, session.tenantId, post.id);
      revalidatePath(`/help`);
      return { ok: true };
    }
  );
}

export async function moderateItem(input: z.infer<typeof moderationSchema>) {
  const session = await requireSession({ minRole: "AGENT" });
  const data = moderationSchema.parse(input);
  return withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      if (data.kind === "post") {
        await tx.communityPost.update({
          where: { id: data.id },
          data: { status: data.decision },
        });
      } else {
        await tx.communityReply.update({
          where: { id: data.id },
          data: { status: data.decision },
        });
      }
      const dual = dualFkForUser(session.subjectId, session.role);
      await tx.auditLog.create({
        data: {
          tenantId: session.tenantId,
          ...actorCols(dual),
          action: `COMMUNITY_${data.kind.toUpperCase()}_${data.decision}`,
          toValue: data.id,
        },
      });
      revalidatePath("/admin/kb/community");
      revalidatePath("/help");
      return { ok: true };
    }
  );
}

export async function listPendingModeration() {
  const session = await requireSession({ minRole: "AGENT" });
  return withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const [posts, replies] = await Promise.all([
        tx.communityPost.findMany({
          where: { tenantId: session.tenantId, status: "PENDING" },
          orderBy: { createdAt: "asc" },
          include: { helpCenter: { select: { name: true } } },
        }),
        tx.communityReply.findMany({
          where: { tenantId: session.tenantId, status: "PENDING" },
          orderBy: { createdAt: "asc" },
        }),
      ]);
      return {
        posts: posts.map((p) => ({
          id: p.id,
          title: p.title,
          body: p.body,
          helpCenterName: p.helpCenter.name,
          createdAt: p.createdAt.toISOString(),
        })),
        replies: replies.map((r) => ({
          id: r.id,
          postId: r.postId,
          body: r.body,
          createdAt: r.createdAt.toISOString(),
        })),
      };
    }
  );
}

// ---------------------------------------------------------------------
// M14.4 — feed solved + upvoted posts into KbSuggestion (M10 queue).
// The suggestion still requires admin approval before it hits the KB.
// ---------------------------------------------------------------------
async function maybeFeedToKbSuggestion(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  tenantId: string,
  postId: string
): Promise<void> {
  const post = await tx.communityPost.findFirst({
    where: { id: postId, tenantId, status: "SOLVED", feedIntoKbSuggestionAt: null },
    include: {
      helpCenter: { select: { communityUpvoteThreshold: true } },
      replies: {
        where: { isBestAnswer: true, status: "APPROVED" },
        take: 1,
        select: { body: true },
      },
    },
  });
  if (!post) return;
  if (post.upvoteCount < post.helpCenter.communityUpvoteThreshold) return;
  const bestAnswerBody = post.replies[0]?.body ?? "";

  // Reuse the M10 KbSuggestion table. sourceDigest is deterministic so
  // repeated triggers don't create duplicates — combine tenant + post id.
  const crypto = await import("node:crypto");
  const sourceDigest = crypto
    .createHash("sha256")
    .update(`community:${tenantId}:${post.id}`)
    .digest("hex");
  await tx.kbSuggestion.upsert({
    where: {
      tenantId_sourceDigest: { tenantId, sourceDigest },
    },
    create: {
      tenantId,
      status: "PENDING",
      title: post.title,
      body: `${post.body}\n\n---\n\nBest answer:\n${bestAnswerBody}`,
      sourceTicketIds: [] as never,
      sourceDigest,
      reason: `Community post solved with ${post.upvoteCount} upvotes on help center.`,
    },
    update: {},
  });
  await tx.communityPost.update({
    where: { id: post.id },
    data: { feedIntoKbSuggestionAt: new Date() },
  });
}
