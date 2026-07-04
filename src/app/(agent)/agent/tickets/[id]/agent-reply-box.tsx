"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { postAgentReply } from "@/actions/tickets";
import { uploadTicketAttachment } from "@/actions/attachments";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { useStagedAttachments, StagedAttachmentChips } from "@/components/staged-attachments";
import { PaperclipIcon } from "@/components/icons";
import { ATTACHMENT_ALLOWED_MIME } from "@/lib/validation/ticket";

/**
 * Rendered as the composer slot inside ConversationThread, so it lives at the
 * bottom of the chat box like a real messaging app instead of a separate
 * card below it. Internal notes are a distinct action (a small button that
 * opens a popup), not a checkbox on the main composer — keeps "reply to
 * client" the one-click default and makes internal notes an explicit,
 * deliberate choice that's harder to send by accident.
 */
export function AgentReplyBox({ ticketId }: { ticketId: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [body, setBody] = useState("");
  const [pending, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { staged, uploading, addFiles, remove, reset, attachmentIds } = useStagedAttachments((fd) => uploadTicketAttachment(ticketId, fd));

  const [noteOpen, setNoteOpen] = useState(false);
  const [noteBody, setNoteBody] = useState("");
  const [notePending, startNoteTransition] = useTransition();

  function sendReply() {
    if (!body.trim()) return;
    startTransition(async () => {
      try {
        await postAgentReply({ ticketId, body, isInternal: false, attachmentIds });
        setBody("");
        reset();
        toast({ title: "Reply sent", variant: "success" });
        router.refresh();
      } catch (e) {
        toast({ title: "Couldn't send reply", description: e instanceof Error ? e.message : undefined, variant: "error" });
      }
    });
  }

  function addNote() {
    if (!noteBody.trim()) return;
    startNoteTransition(async () => {
      try {
        await postAgentReply({ ticketId, body: noteBody, isInternal: true });
        setNoteBody("");
        setNoteOpen(false);
        toast({ title: "Internal note added", variant: "success" });
        router.refresh();
      } catch (e) {
        toast({ title: "Couldn't add note", description: e instanceof Error ? e.message : undefined, variant: "error" });
      }
    });
  }

  return (
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
          placeholder="Reply to client…"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              sendReply();
            }
          }}
          className="flex-1 resize-none border-0 bg-[var(--color-light-gray)]/60 focus:bg-white transition-colors"
        />
        <Button onClick={sendReply} disabled={pending || uploading || !body.trim()}>
          {pending ? "Sending…" : "Send reply"}
        </Button>
      </div>
      <div className="flex items-center justify-between mt-2">
        <button
          type="button"
          onClick={() => setNoteOpen(true)}
          className="text-[12px] font-medium text-[var(--color-orange-deep)] hover:underline cursor-pointer"
        >
          + Internal note
        </button>
        <span className="text-[11px] text-[var(--color-neutral-400)]">⌘/Ctrl + Enter to send</span>
      </div>

      <Modal open={noteOpen} onClose={() => setNoteOpen(false)} title="Add internal note">
        <p className="text-[12px] text-[var(--color-neutral-600)] mb-3">Only visible to your team — never shown to the client.</p>
        <Textarea
          rows={5}
          placeholder="Internal note…"
          value={noteBody}
          onChange={(e) => setNoteBody(e.target.value)}
          autoFocus
        />
        <div className="flex justify-end gap-2 mt-3">
          <Button variant="secondary" onClick={() => setNoteOpen(false)}>
            Cancel
          </Button>
          <Button onClick={addNote} disabled={notePending || !noteBody.trim()}>
            {notePending ? "Adding…" : "Add note"}
          </Button>
        </div>
      </Modal>
    </>
  );
}
