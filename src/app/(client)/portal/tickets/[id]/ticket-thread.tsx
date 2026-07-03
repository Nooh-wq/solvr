"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { postClientReply } from "@/actions/tickets";
import { TicketMessageList, type ThreadMessage } from "@/components/ticket-message-list";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";

export function TicketThread({ messages, ticketId }: { messages: ThreadMessage[]; ticketId: string }) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [pending, startTransition] = useTransition();

  function onSubmit() {
    if (!body.trim()) return;
    startTransition(async () => {
      await postClientReply({ ticketId, body });
      setBody("");
      router.refresh();
    });
  }

  return (
    <div>
      <TicketMessageList messages={messages} />
      <div className="bg-white border border-[var(--color-neutral-300)] rounded p-4">
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
