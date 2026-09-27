"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  approveRequest,
  rejectRequest,
  type ApprovalDto,
} from "@/actions/approvalRequests";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";

export function ApprovalsList({ items }: { items: ApprovalDto[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [decidingId, setDecidingId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();

  if (items.length === 0) {
    return (
      <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-8 text-center text-sm text-[var(--color-neutral-600)]">
        Nothing waiting on your decision.
      </div>
    );
  }

  function approve(id: string) {
    startTransition(async () => {
      try {
        await approveRequest({ id, note: note.trim() || undefined });
        toast({ title: "Approved", variant: "success" });
        setDecidingId(null);
        setNote("");
        router.refresh();
      } catch (e) {
        toast({
          title: "Couldn't approve",
          description: e instanceof Error ? e.message : undefined,
          variant: "error",
        });
      }
    });
  }
  function reject(id: string) {
    startTransition(async () => {
      try {
        await rejectRequest({ id, note: note.trim() || undefined });
        toast({ title: "Rejected", variant: "success" });
        setDecidingId(null);
        setNote("");
        router.refresh();
      } catch (e) {
        toast({
          title: "Couldn't reject",
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
          <div className="flex justify-between items-start gap-4 mb-2">
            <div>
              <div className="text-[13px] font-semibold">
                {it.ticketTitle}
                {it.ticketReference ? (
                  <span className="ml-2 text-[11px] text-[var(--color-neutral-500)]">
                    <Link
                      href={`/portal/tickets/${it.ticketId}`}
                      className="hover:underline"
                    >
                      {it.ticketReference}
                    </Link>
                  </span>
                ) : null}
              </div>
              <div className="text-[12px] text-[var(--color-neutral-600)]">
                Step {it.currentStep + 1} of {it.totalSteps} · expires{" "}
                {new Date(it.expiresAt).toLocaleDateString()}
              </div>
            </div>
          </div>
          {decidingId === it.id ? (
            <div className="mt-3 space-y-2">
              <Textarea
                rows={2}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Optional note"
              />
              <div className="flex gap-2">
                <Button disabled={pending} onClick={() => approve(it.id)}>
                  Approve
                </Button>
                <Button
                  variant="secondary"
                  disabled={pending}
                  onClick={() => reject(it.id)}
                >
                  Reject
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setDecidingId(null);
                    setNote("");
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <Button size="sm" onClick={() => setDecidingId(it.id)}>
              Decide
            </Button>
          )}
        </div>
      ))}
    </div>
  );
}
