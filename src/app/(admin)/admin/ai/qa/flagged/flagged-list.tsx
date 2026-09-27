"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { markScoreReviewed, dismissScore, type QaScoreDto } from "@/actions/qaScores";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

export function FlaggedList({ items }: { items: QaScoreDto[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  if (items.length === 0) {
    return (
      <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-8 text-center text-sm text-[var(--color-neutral-600)]">
        No flagged replies.
      </div>
    );
  }

  function review(id: string) {
    startTransition(async () => {
      try {
        await markScoreReviewed({ id });
        toast({ title: "Marked reviewed", variant: "success" });
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

  function dismiss(id: string) {
    startTransition(async () => {
      try {
        await dismissScore({ id });
        toast({ title: "Dismissed", variant: "success" });
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

  return (
    <div className="space-y-3">
      {items.map((it) => (
        <div
          key={it.id}
          className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-5"
        >
          <div className="flex justify-between items-start gap-4 mb-3">
            <div>
              <div className="text-[13px] font-semibold">
                Overall: {it.overall.toFixed(2)} / 5
                {it.ticketReference ? (
                  <>
                    {" · "}
                    <Link
                      href={`/agent/tickets/${it.ticketId}`}
                      target="_blank"
                      className="text-[var(--color-primary)] hover:underline"
                    >
                      {it.ticketReference}
                    </Link>
                  </>
                ) : null}
              </div>
              <div className="text-[12px] text-[var(--color-neutral-600)]">
                By {it.senderRole} · {new Date(it.createdAt).toLocaleString()}
              </div>
            </div>
            <div className="text-[12px] text-[var(--color-neutral-700)]">
              Flagged: {it.flaggedReasons.join(", ")}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 text-[12px]">
            {Object.entries(it.scores).map(([k, v]) => (
              <div key={k} className="p-2 rounded-md bg-[var(--color-light-gray)]">
                <div className="font-semibold">
                  {k}: {v.score.toFixed(1)}
                </div>
                <div className="text-[var(--color-neutral-700)]">{v.rationale}</div>
              </div>
            ))}
          </div>
          <div className="mt-3 flex gap-2">
            <Button disabled={pending} onClick={() => review(it.id)}>
              Mark reviewed
            </Button>
            <Button variant="secondary" disabled={pending} onClick={() => dismiss(it.id)}>
              Dismiss
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
