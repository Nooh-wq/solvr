"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { postAgentReply } from "@/actions/tickets";
import { uploadTicketAttachment } from "@/actions/attachments";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { MessageComposer } from "@/components/message-composer";

/**
 * Rendered as the composer slot inside ConversationThread, so it lives at the
 * bottom of the chat box like a real messaging app instead of a separate
 * card below it. Internal notes are a distinct action (a small button that
 * opens a popup), not a checkbox on the main composer — keeps "reply to
 * client" the one-click default and makes internal notes an explicit,
 * deliberate choice that's harder to send by accident.
 */
export function AgentReplyBox({
  ticketId,
  mentionNames = [],
  isLightAgent = false,
}: {
  ticketId: string;
  mentionNames?: string[];
  /**
   * Z5.5 — when true, the public reply composer is replaced by an
   * internal-note composer. Server-side postAgentReply also rejects any
   * non-internal message from a Light Agent (see actions/tickets.ts), so
   * this is UI parity for a rule the backend enforces regardless.
   */
  isLightAgent?: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();

  const [noteOpen, setNoteOpen] = useState(false);
  const [noteBody, setNoteBody] = useState("");
  const [notePending, startNoteTransition] = useTransition();

  async function sendReply(body: string, attachmentIds: string[]) {
    try {
      await postAgentReply({ ticketId, body, isInternal: false, attachmentIds });
      router.refresh();
    } catch (e) {
      toast({ title: "Couldn't send reply", description: e instanceof Error ? e.message : undefined, variant: "error" });
    }
  }

  async function sendNoteFromMainComposer(body: string, attachmentIds: string[]) {
    try {
      await postAgentReply({ ticketId, body, isInternal: true, attachmentIds });
      router.refresh();
    } catch (e) {
      toast({ title: "Couldn't add note", description: e instanceof Error ? e.message : undefined, variant: "error" });
    }
  }

  if (isLightAgent) {
    return (
      <MessageComposer
        placeholder="Add an internal note…"
        onSend={sendNoteFromMainComposer}
        upload={(fd) => uploadTicketAttachment(ticketId, fd)}
        mentionNames={mentionNames}
        footer={
          <div className="flex items-center justify-between mt-2">
            <span className="text-[12px] font-medium text-[var(--color-orange-deep)]">
              Light Agent — internal notes only
            </span>
            <span className="text-[11px] text-[var(--color-neutral-400)]">⌘/Ctrl + Enter to send</span>
          </div>
        }
      />
    );
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
      <MessageComposer
        placeholder="Reply to client…"
        onSend={sendReply}
        upload={(fd) => uploadTicketAttachment(ticketId, fd)}
        mentionNames={mentionNames}
        footer={
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
        }
      />

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
