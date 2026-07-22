"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { approveUser, rejectUser } from "@/actions/admin";

export function PendingActions({ userId, email }: { userId: string; email: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run(fn: (input: { userId: string }) => Promise<unknown>, confirmText: string) {
    if (!confirm(confirmText)) return;
    setError(null);
    start(async () => {
      try {
        await fn({ userId });
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong.");
      }
    });
  }

  return (
    <div className="inline-flex items-center gap-2">
      {error ? <span className="text-[11px] text-[var(--color-danger)]">{error}</span> : null}
      <button
        type="button"
        disabled={pending}
        onClick={() => run(approveUser, `Approve ${email}?`)}
        className="text-[12px] font-medium px-3 py-1.5 rounded-lg bg-[var(--color-primary)] text-[var(--color-on-primary)] hover:opacity-90 disabled:opacity-50 cursor-pointer"
      >
        Approve
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={() => run(rejectUser, `Reject ${email}? They'll be notified.`)}
        className="text-[12px] font-medium px-3 py-1.5 rounded-lg border border-[var(--color-neutral-300)] hover:bg-[var(--color-neutral-100)] disabled:opacity-50 cursor-pointer"
      >
        Reject
      </button>
    </div>
  );
}
