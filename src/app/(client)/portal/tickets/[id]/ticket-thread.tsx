"use client";

import { useRouter } from "next/navigation";
import { postClientReply } from "@/actions/tickets";
import { uploadTicketAttachment } from "@/actions/attachments";
import { ConversationThread, type ConversationMessage } from "@/components/conversation-thread";
import { MessageComposer } from "@/components/message-composer";
import { useToast } from "@/components/ui/toast";

export function TicketThread({
  description,
  clientName,
  messages,
  ticketId,
  mentionNames = [],
}: {
  description: string;
  clientName: string;
  messages: ConversationMessage[];
  ticketId: string;
  mentionNames?: string[];
}) {
  const router = useRouter();
  const { toast } = useToast();

  async function onSend(body: string, attachmentIds: string[]) {
    try {
      await postClientReply({ ticketId, body, attachmentIds });
      toast({ title: "Reply sent", variant: "success" });
      router.refresh();
    } catch (e) {
      toast({ title: "Couldn't send reply", description: e instanceof Error ? e.message : undefined, variant: "error" });
    }
  }

  return (
    <ConversationThread
      description={description}
      clientName={clientName}
      mySenderRoles={["CLIENT"]}
      messages={messages}
      mentionNames={mentionNames}
      composer={
        <MessageComposer
          placeholder="Reply to this ticket…"
          onSend={onSend}
          upload={(fd) => uploadTicketAttachment(ticketId, fd)}
          mentionNames={mentionNames}
        />
      }
    />
  );
}
