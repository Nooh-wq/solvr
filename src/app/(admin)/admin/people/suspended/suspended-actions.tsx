"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { updateUser } from "@/actions/admin";

export function SuspendedActions({ userId, email }: { userId: string; email: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function reactivate() {
    if (!confirm(`Reactivate ${email}? They'll be able to log in again.`)) return;
    setError(null);
    start(async () => {
      try {
        await updateUser({ userId, status: "ACTIVE" });
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
        onClick={reactivate}
        className="text-[12px] font-medium px-3 py-1.5 rounded-lg bg-[var(--color-primary)] text-[var(--color-on-primary)] hover:opacity-90 disabled:opacity-50 cursor-pointer"
      >
        Reactivate
      </button>
    </div>
  );
}
