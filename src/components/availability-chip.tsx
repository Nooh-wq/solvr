"use client";

import { useState, useTransition } from "react";
import { setOwnAvailability } from "@/actions/routing";
import { useToast } from "@/components/ui/toast";

// M3.1 — agent-facing availability chip. Toggling flips
// AgentProfile.isAvailable, which the routing engine reads to include
// or exclude the agent from auto-routes. Optimistic; rolls back on
// server error. Purely visual outside routing — a ticket already
// assigned to an away agent stays with them.

export function AvailabilityChip({
  initialAvailable,
}: {
  initialAvailable: boolean;
}) {
  const { toast } = useToast();
  const [available, setAvailable] = useState<boolean>(initialAvailable);
  const [pending, startTransition] = useTransition();

  function toggle() {
    if (pending) return;
    const next = !available;
    setAvailable(next);
    startTransition(async () => {
      try {
        await setOwnAvailability({ isAvailable: next });
      } catch (e) {
        setAvailable(!next);
        toast({
          title: "Couldn't update availability",
          description: e instanceof Error ? e.message : undefined,
          variant: "error",
        });
      }
    });
  }

  const label = available ? "Available" : "Away";
  const style = available
    ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30 hover:bg-emerald-500/15"
    : "bg-[var(--color-neutral-100)] text-[var(--color-neutral-600)] border-[var(--color-neutral-300)] hover:bg-[var(--color-neutral-200)]";

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={pending}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors cursor-pointer ${style}`}
      title={
        available
          ? "You're currently receiving auto-routed tickets. Click to go Away."
          : "You're excluded from auto-routing. Click to become Available."
      }
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${
          available ? "bg-emerald-500" : "bg-[var(--color-neutral-400)]"
        }`}
      />
      {label}
    </button>
  );
}
