"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { approveAiAction, rejectAiAction, type QueuedActionDto } from "@/actions/aiActionQueue";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";

export function QueueList({ items }: { items: QueuedActionDto[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [pending, startTransition] = useTransition();

  if (items.length === 0) {
    return (
      <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-8 text-center text-sm text-[var(--color-neutral-600)]">
        No pending AI actions.
      </div>
    );
  }

  function approve(id: string, toolName: string) {
    startTransition(async () => {
      try {
        const outcome = await approveAiAction({ id });
        toast({
          title:
            outcome.kind === "executed"
              ? `Ran ${toolName}`
              : outcome.kind === "failed"
                ? `Ran ${toolName} but it failed`
                : `Approved ${toolName}`,
          variant: outcome.kind === "executed" ? "success" : "error",
        });
        router.refresh();
      } catch (e) {
        toast({
          title: "Approve failed",
          description: e instanceof Error ? e.message : undefined,
          variant: "error",
        });
      }
    });
  }

  function reject(id: string) {
    startTransition(async () => {
      try {
        await rejectAiAction({ id, reason: rejectReason.trim() || undefined });
        toast({ title: "Rejected", variant: "success" });
        setRejectingId(null);
        setRejectReason("");
        router.refresh();
      } catch (e) {
        toast({
          title: "Reject failed",
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
              <div className="text-[13px] font-semibold text-[var(--color-neutral-900)]">
                {it.toolName}
                {it.requiresApproval ? null : (
                  <span className="ml-2 text-[10px] uppercase-label text-amber-700">
                    auto (unexpected)
                  </span>
                )}
              </div>
              <div className="text-[12px] text-[var(--color-neutral-600)]">
                Proposed by {it.proposedByRole} · {new Date(it.createdAt).toLocaleString()}
                {it.ticketReference ? (
                  <>
                    {" · "}
                    <Link
                      href={`/agent/tickets/${it.ticketId}`}
                      className="text-[var(--color-primary)] hover:underline"
                    >
                      {it.ticketReference}
                    </Link>
                  </>
                ) : null}
              </div>
            </div>
          </div>
          <pre className="bg-[var(--color-light-gray)] rounded-md p-3 text-[12px] font-mono overflow-x-auto whitespace-pre-wrap">
            {it.argsJson}
          </pre>
          {rejectingId === it.id ? (
            <div className="mt-3 space-y-2">
              <Textarea
                rows={2}
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Reason (optional)"
              />
              <div className="flex gap-2">
                <Button variant="secondary" disabled={pending} onClick={() => reject(it.id)}>
                  Confirm reject
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setRejectingId(null);
                    setRejectReason("");
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div className="mt-3 flex gap-2">
              <Button disabled={pending} onClick={() => approve(it.id, it.toolName)}>
                Approve + run
              </Button>
              <Button variant="secondary" disabled={pending} onClick={() => setRejectingId(it.id)}>
                Reject
              </Button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
