"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { confirmResolution, reopenTicket } from "@/actions/tickets";
import { Button } from "@/components/ui/button";
import type { TicketStatus } from "@/generated/prisma";

export function TicketActions({ ticketId, status }: { ticketId: string; status: TicketStatus }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  if (status !== "RESOLVED" && status !== "CLOSED") return null;

  function onConfirm() {
    startTransition(async () => {
      await confirmResolution(ticketId);
      router.refresh();
    });
  }

  function onReopen() {
    startTransition(async () => {
      await reopenTicket(ticketId);
      router.refresh();
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
