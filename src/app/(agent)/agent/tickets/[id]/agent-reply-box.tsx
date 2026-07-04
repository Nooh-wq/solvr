"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { postAgentReply } from "@/actions/tickets";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";

/**
 * Rendered as the composer slot inside TicketConversation, so it lives at the
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

  const [noteOpen, setNoteOpen] = useState(false);
  const [noteBody, setNoteBody] = useState("");
  const [notePending, startNoteTransition] = useTransition();

  function sendReply() {
    if (!body.trim()) return;
    startTransition(async () => {
      try {
        await postAgentReply({ ticketId, body, isInternal: false });
        setBody("");
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
      <div className="flex items-end gap-2">
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
        <Button onClick={sendReply} disabled={pending || !body.trim()}>
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
