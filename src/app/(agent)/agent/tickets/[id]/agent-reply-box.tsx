"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { postAgentReply } from "@/actions/tickets";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";

export function AgentReplyBox({ ticketId }: { ticketId: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [body, setBody] = useState("");
  const [isInternal, setIsInternal] = useState(false);
  const [pending, startTransition] = useTransition();

  function onSubmit() {
    if (!body.trim()) return;
    startTransition(async () => {
      try {
        await postAgentReply({ ticketId, body, isInternal });
        setBody("");
        toast({ title: isInternal ? "Internal note added" : "Reply sent", variant: "success" });
        router.refresh();
      } catch (e) {
        toast({ title: "Couldn't send", description: e instanceof Error ? e.message : undefined, variant: "error" });
      }
    });
  }

  return (
    <div className="bg-white border border-[var(--color-neutral-300)] rounded-2xl p-4">
      <Textarea
        rows={3}
        placeholder={isInternal ? "Internal note (not visible to client)…" : "Reply to client…"}
        value={body}
        onChange={(e) => setBody(e.target.value)}
      />
      <div className="flex items-center justify-between mt-3">
        <label className="flex items-center gap-2 text-[13px] text-[var(--color-neutral-700)]">
          <input type="checkbox" checked={isInternal} onChange={(e) => setIsInternal(e.target.checked)} />
          Internal note
        </label>
        <Button onClick={onSubmit} disabled={pending || !body.trim()} variant={isInternal ? "secondary" : "primary"}>
          {pending ? "Sending…" : isInternal ? "Add note" : "Send reply"}
        </Button>
      </div>
    </div>
  );
}
