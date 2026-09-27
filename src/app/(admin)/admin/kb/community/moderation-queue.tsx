"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { moderateItem } from "@/actions/community";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

type PendingPost = {
  id: string;
  title: string;
  body: string;
  helpCenterName: string;
  createdAt: string;
};
type PendingReply = { id: string; postId: string; body: string; createdAt: string };

export function ModerationQueue({
  posts,
  replies,
}: {
  posts: PendingPost[];
  replies: PendingReply[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  function decide(kind: "post" | "reply", id: string, decision: "APPROVED" | "REJECTED") {
    startTransition(async () => {
      try {
        await moderateItem({ id, kind, decision });
        toast({
          title: decision === "APPROVED" ? `${kind} approved` : `${kind} rejected`,
          variant: "success",
        });
        router.refresh();
      } catch (e) {
        toast({
          title: "Couldn't update",
          description: e instanceof Error ? e.message : undefined,
          variant: "error",
        });
      }
    });
  }

  if (posts.length === 0 && replies.length === 0) {
    return (
      <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-8 text-center text-sm text-[var(--color-neutral-600)]">
        Nothing to moderate right now.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {posts.length > 0 ? (
        <section>
          <div className="text-[12px] uppercase-label text-[var(--color-neutral-700)] mb-3">
            Pending posts
          </div>
          <div className="space-y-3">
            {posts.map((p) => (
              <div
                key={p.id}
                className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-5"
              >
                <div className="text-[11px] uppercase-label text-[var(--color-neutral-500)] mb-1">
                  {p.helpCenterName} · {new Date(p.createdAt).toLocaleString()}
                </div>
                <div className="text-[14px] font-semibold mb-1">{p.title}</div>
                <div className="text-[13px] text-[var(--color-neutral-700)] whitespace-pre-wrap mb-3">
                  {p.body}
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    disabled={pending}
                    onClick={() => decide("post", p.id, "APPROVED")}
                  >
                    Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={pending}
                    onClick={() => decide("post", p.id, "REJECTED")}
                  >
                    Reject
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {replies.length > 0 ? (
        <section>
          <div className="text-[12px] uppercase-label text-[var(--color-neutral-700)] mb-3">
            Pending replies
          </div>
          <div className="space-y-3">
            {replies.map((r) => (
              <div
                key={r.id}
                className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-5"
              >
                <div className="text-[11px] uppercase-label text-[var(--color-neutral-500)] mb-1">
                  Reply to post {r.postId.slice(0, 8)}… · {new Date(r.createdAt).toLocaleString()}
                </div>
                <div className="text-[13px] whitespace-pre-wrap mb-3">{r.body}</div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    disabled={pending}
                    onClick={() => decide("reply", r.id, "APPROVED")}
                  >
                    Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={pending}
                    onClick={() => decide("reply", r.id, "REJECTED")}
                  >
                    Reject
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
