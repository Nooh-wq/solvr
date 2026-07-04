"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { postClientReply } from "@/actions/tickets";
import { uploadTicketAttachment } from "@/actions/attachments";
import { ConversationThread, type ConversationMessage } from "@/components/conversation-thread";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { useStagedAttachments, StagedAttachmentChips } from "@/components/staged-attachments";
import { PaperclipIcon } from "@/components/icons";
import { ATTACHMENT_ALLOWED_MIME } from "@/lib/validation/ticket";

export function TicketThread({
  description,
  clientName,
  messages,
  ticketId,
}: {
  description: string;
  clientName: string;
  messages: ConversationMessage[];
  ticketId: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [body, setBody] = useState("");
  const [pending, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { staged, uploading, addFiles, remove, reset, attachmentIds } = useStagedAttachments((fd) => uploadTicketAttachment(ticketId, fd));

  function onSubmit() {
    if (!body.trim()) return;
    startTransition(async () => {
      try {
        await postClientReply({ ticketId, body, attachmentIds });
        setBody("");
        reset();
        toast({ title: "Reply sent", variant: "success" });
        router.refresh();
      } catch (e) {
        toast({ title: "Couldn't send reply", description: e instanceof Error ? e.message : undefined, variant: "error" });
      }
    });
  }

  return (
    <ConversationThread
      description={description}
      clientName={clientName}
      mySenderRoles={["CLIENT"]}
      messages={messages}
      composer={
        <>
          <StagedAttachmentChips files={staged} onRemove={remove} />
          <div className="flex items-end gap-2">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept={ATTACHMENT_ALLOWED_MIME.join(",")}
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.length) addFiles(e.target.files);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              title="Attach a file"
              className="h-9 w-9 shrink-0 flex items-center justify-center rounded-full text-[var(--color-neutral-600)] hover:bg-black/[0.05] hover:text-black transition-colors duration-150 cursor-pointer disabled:opacity-50"
            >
              <PaperclipIcon className="h-[18px] w-[18px]" />
            </button>
            <Textarea
              rows={2}
              placeholder="Reply to this ticket…"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  onSubmit();
                }
              }}
              className="flex-1 resize-none border-0 bg-[var(--color-light-gray)]/60 focus:bg-white transition-colors"
            />
            <Button onClick={onSubmit} disabled={pending || uploading || !body.trim()}>
              {pending ? "Sending…" : "Reply"}
            </Button>
          </div>
        </>
      }
    />
  );
}
