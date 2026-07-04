"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { postClientReply } from "@/actions/tickets";
import { TicketMessageList, type ThreadMessage } from "@/components/ticket-message-list";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";

export function TicketThread({ messages, ticketId }: { messages: ThreadMessage[]; ticketId: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [body, setBody] = useState("");
  const [pending, startTransition] = useTransition();

  function onSubmit() {
    if (!body.trim()) return;
    startTransition(async () => {
      try {
        await postClientReply({ ticketId, body });
        setBody("");
        toast({ title: "Reply sent", variant: "success" });
        router.refresh();
      } catch (e) {
        toast({ title: "Couldn't send reply", description: e instanceof Error ? e.message : undefined, variant: "error" });
      }
    });
  }

  return (
    <div>
      <TicketMessageList messages={messages} />
      <div className="bg-white border border-[var(--color-neutral-300)] rounded-2xl p-4 mt-4">
        <Textarea
          rows={3}
          placeholder="Reply to this ticket…"
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
        <div className="flex justify-end mt-3">
          <Button onClick={onSubmit} disabled={pending || !body.trim()}>
            {pending ? "Sending…" : "Reply"}
          </Button>
        </div>
      </div>
    </div>
  );
}
