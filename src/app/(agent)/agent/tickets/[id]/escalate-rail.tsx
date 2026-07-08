"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { triggerEscalation } from "@/actions/escalations";
import { useToast } from "@/components/ui/toast";

// Z8.4 — the dynamic escalation button rail. Server component parent
// resolves which paths apply to this ticket's category; this client
// component wires clicks to triggerEscalation() and surfaces errors.
// Never silent per the spec: a webhook 500 shows a toast AND the
// escalation_logs row is written FAILED.

type Path = {
  id: string;
  label: string;
  destKind: "TEAM" | "WEBHOOK" | "EMAIL" | "INTEGRATION";
};

const DEST_HINT: Record<Path["destKind"], string> = {
  TEAM: "Reassigns to a team group",
  WEBHOOK: "Posts to a webhook",
  EMAIL: "Sends an email",
  INTEGRATION: "Marketplace integration",
};

export function EscalateRail({ ticketId, paths }: { ticketId: string; paths: Path[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  if (paths.length === 0) return null;

  function onClick(p: Path) {
    if (p.destKind === "INTEGRATION") {
      toast({ title: "Not available", description: "Marketplace hasn't shipped yet.", variant: "error" });
      return;
    }
    startTransition(async () => {
      try {
        await triggerEscalation({ escalationPathId: p.id, ticketId });
        toast({ title: `Escalated: ${p.label}`, variant: "success" });
        router.refresh();
      } catch (e) {
        toast({
          title: "Escalation failed",
          description: e instanceof Error ? e.message : undefined,
          variant: "error",
        });
      }
    });
  }

  return (
    <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-3">
      <div className="text-[11px] uppercase tracking-wider text-[var(--color-neutral-500)] font-semibold mb-2 px-1">
        Escalate
      </div>
      <div className="flex flex-col gap-1.5">
        {paths.map((p) => (
          <button
            key={p.id}
            onClick={() => onClick(p)}
            disabled={pending}
            title={DEST_HINT[p.destKind]}
            className="text-left px-3 py-2 rounded-lg text-[13px] font-medium bg-black/[0.03] dark:bg-white/[0.04] hover:bg-[var(--color-primary)] hover:text-white transition-colors duration-150 cursor-pointer disabled:opacity-50 disabled:cursor-wait"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="truncate">{p.label}</span>
              <span className="text-[10px] opacity-60">{p.destKind}</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
