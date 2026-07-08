"use client";

import { useState, useTransition } from "react";
import {
  approveAccountDeletion,
  rejectAccountDeletion,
  type PendingDeletionRow,
} from "@/actions/accountDeletions";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { useRouter } from "next/navigation";

export function AccountDeletionsList({ rows }: { rows: PendingDeletionRow[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handle(action: "approve" | "reject", requestId: string) {
    setBusyId(requestId);
    startTransition(async () => {
      const result =
        action === "approve"
          ? await approveAccountDeletion({ requestId })
          : await rejectAccountDeletion({ requestId });
      setBusyId(null);
      if ("error" in result) {
        toast({ title: `Couldn't ${action}`, description: result.error, variant: "error" });
        return;
      }
      toast({
        title: action === "approve" ? "Account deleted" : "Request rejected",
        variant: "success",
      });
      router.refresh();
    });
  }

  if (rows.length === 0) {
    return (
      <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-6 text-[13px] text-[var(--color-neutral-500)]">
        No pending requests.
      </div>
    );
  }

  return (
    <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl divide-y divide-[var(--color-neutral-200)] dark:divide-white/10">
      {rows.map((r) => (
        <div key={r.id} className="p-4 flex items-start gap-4">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium">{r.name ?? r.email}</div>
            <div className="text-[12px] text-[var(--color-neutral-500)]">
              {r.email} · {r.kind === "TEAM_MEMBER" ? "Staff" : r.kind === "END_USER" ? "Client" : "Unknown"} · Requested {r.createdAt.toLocaleString()}
            </div>
            {r.reason && (
              <div className="text-[12px] text-[var(--color-neutral-600)] mt-1 italic">
                &ldquo;{r.reason}&rdquo;
              </div>
            )}
          </div>
          <div className="flex gap-2 shrink-0">
            <Button
              size="sm"
              variant="secondary"
              disabled={pending && busyId === r.id}
              onClick={() => handle("reject", r.id)}
            >
              Reject
            </Button>
            <Button
              size="sm"
              disabled={pending && busyId === r.id}
              onClick={() => handle("approve", r.id)}
            >
              {pending && busyId === r.id ? "Deleting…" : "Approve"}
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
