"use client";

import { useRouter } from "next/navigation";
import { postGuestReply, uploadGuestAttachment } from "@/actions/guest";
import { useToast } from "@/components/ui/toast";
import { MessageComposer } from "@/components/message-composer";

export function GuestReplyBox({ token, mentionNames = [] }: { token: string; mentionNames?: string[] }) {
  const router = useRouter();
  const { toast } = useToast();

  async function onSend(body: string, attachmentIds: string[]) {
    const result = await postGuestReply({ token, body, attachmentIds });
    if (!result.ok) {
      toast({ title: "Couldn't send reply", description: result.error, variant: "error" });
      return;
    }
    toast({ title: "Reply sent", variant: "success" });
    router.refresh();
  }

  return (
    <MessageComposer
      placeholder="Write a reply…"
      onSend={onSend}
      upload={(fd) => uploadGuestAttachment(token, fd)}
      mentionNames={mentionNames}
    />
  );
}
