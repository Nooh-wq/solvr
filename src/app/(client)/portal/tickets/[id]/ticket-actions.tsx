"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { confirmResolution, reopenTicket } from "@/actions/tickets";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import type { TicketStatus } from "@/generated/prisma";

export function TicketActions({ ticketId, status }: { ticketId: string; status: TicketStatus }) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  if (status !== "RESOLVED" && status !== "CLOSED") return null;

  function onConfirm() {
    startTransition(async () => {
      try {
        await confirmResolution(ticketId);
        toast({ title: "Ticket closed", description: "Thanks for confirming.", variant: "success" });
        router.refresh();
      } catch (e) {
        toast({ title: "Couldn't confirm resolution", description: e instanceof Error ? e.message : undefined, variant: "error" });
      }
    });
  }

  function onReopen() {
    startTransition(async () => {
      try {
        await reopenTicket(ticketId);
        toast({ title: "Ticket reopened", variant: "success" });
        router.refresh();
      } catch (e) {
        toast({ title: "Couldn't reopen ticket", description: e instanceof Error ? e.message : undefined, variant: "error" });
      }
    });
  }

  return (
    <div className="flex gap-3 mt-4">
      {status === "RESOLVED" && (
        <Button onClick={onConfirm} disabled={pending} variant="primary" size="sm">
          Confirm resolved
        </Button>
      )}
      <Button onClick={onReopen} disabled={pending} variant="secondary" size="sm">
        Reopen
      </Button>
    </div>
  );
}
