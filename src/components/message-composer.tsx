"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import { useStagedAttachments, StagedAttachmentChips, type UploadResult } from "@/components/staged-attachments";
import { PlusIcon, AtIcon, SendIcon, BoldIcon, ItalicIcon, UnderlineIcon, ListBulletIcon, ListOrderedIcon } from "@/components/icons";
import { ATTACHMENT_ALLOWED_MIME } from "@/lib/validation/ticket";

/** Matches "@partialname" ending at `pos` in `text`, so both live-typing and the toolbar's @ button can share one mention-detection rule. */
function mentionMatchAt(text: string, pos: number): { atIndex: number; query: string } | null {
  const upToCursor = text.slice(0, pos);
  const m = upToCursor.match(/(?:^|\s)@([\w'-]*)$/);
  if (!m) return null;
  return { atIndex: upToCursor.lastIndexOf("@"), query: m[1] };
}

function ToolbarButton({
  icon,
  label,
  onClick,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className="h-7 w-7 flex items-center justify-center rounded-md text-[var(--color-neutral-600)] hover:bg-black/[0.06] hover:text-black transition-colors duration-150 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
    >
      {icon}
    </button>
  );
}

/**
 * Slack-style message composer shared by the agent, client, and guest reply
 * boxes (see conversation-thread.tsx's `composer` slot). Formatting is
 * lightweight markdown written directly into the plain-text `body`
 * (**bold**, *italic*, __underline__, "- "/"1. " list prefixes) — rendered
 * back out by conversation-thread.tsx's renderMessageBody(). No HTML is ever
 * stored or dangerouslySetInnerHTML'd, so there's no new XSS surface.
 */
export function MessageComposer({
  placeholder,
  onSend,
  upload,
  mentionNames = [],
  disabled,
  footer,
}: {
  placeholder: string;
  onSend: (body: string, attachmentIds: string[]) => Promise<void>;
  upload: (formData: FormData) => Promise<UploadResult>;
  mentionNames?: string[];
  disabled?: boolean;
  footer?: React.ReactNode;
}) {
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { staged, uploading, addFiles, remove, reset, attachmentIds } = useStagedAttachments(upload);

  const filteredMentions = mentionQuery === null ? [] : mentionNames.filter((n) => n.toLowerCase().includes(mentionQuery.toLowerCase()));

  function setBodyAndCaret(next: string, caret: number) {
    setBody(next);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(caret, caret);
    });
  }

  function wrapSelection(marker: string) {
    const el = textareaRef.current;
    if (!el) return;
    const start = el.selectionStart ?? body.length;
    const end = el.selectionEnd ?? body.length;
    const selected = body.slice(start, end) || "text";
    const next = `${body.slice(0, start)}${marker}${selected}${marker}${body.slice(end)}`;
    setBody(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + marker.length, start + marker.length + selected.length);
    });
  }

  function prefixLines(ordered: boolean) {
    const el = textareaRef.current;
    if (!el) return;
    const start = el.selectionStart ?? body.length;
    const end = el.selectionEnd ?? body.length;
    const lineStart = body.lastIndexOf("\n", start - 1) + 1;
    const nextNewline = body.indexOf("\n", end);
    const lineEnd = nextNewline === -1 ? body.length : nextNewline;
    const lines = body.slice(lineStart, lineEnd).split("\n");
    const prefixed = lines.map((l, i) => (ordered ? `${i + 1}. ${l}` : `- ${l}`)).join("\n");
    const next = body.slice(0, lineStart) + prefixed + body.slice(lineEnd);
    setBody(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(lineStart, lineStart + prefixed.length);
    });
  }

  function insertMention(name: string) {
    const el = textareaRef.current;
    const pos = el?.selectionStart ?? body.length;
    const match = mentionMatchAt(body, pos);
    if (!match) return;
    const next = `${body.slice(0, match.atIndex)}@${name} ${body.slice(pos)}`;
    setBodyAndCaret(next, match.atIndex + name.length + 2);
    setMentionQuery(null);
  }

  function triggerMentionButton() {
    const el = textareaRef.current;
    if (!el) return;
    const pos = el.selectionStart ?? body.length;
    const before = body.slice(0, pos);
    const insert = before.length > 0 && !/\s$/.test(before) ? " @" : "@";
    const next = before + insert + body.slice(pos);
    setBodyAndCaret(next, pos + insert.length);
    setMentionQuery("");
  }

  function handleChange(value: string, caret: number) {
    setBody(value);
    const match = mentionMatchAt(value, caret);
    setMentionQuery(match ? match.query : null);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (mentionQuery !== null && filteredMentions.length > 0 && e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      insertMention(filteredMentions[0]);
      return;
    }
    if (mentionQuery !== null && e.key === "Escape") {
      setMentionQuery(null);
      return;
    }
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      send();
    }
  }

  async function send() {
    if (!body.trim() || sending || uploading) return;
    setSending(true);
    try {
      await onSend(body, attachmentIds);
      setBody("");
      reset();
      setMentionQuery(null);
    } finally {
      setSending(false);
    }
  }

  return (
    <div>
      <StagedAttachmentChips files={staged} onRemove={remove} />
      <div className="rounded-2xl border border-[var(--color-neutral-300)] bg-[var(--color-light-gray)]/50 transition-colors duration-150 focus-within:bg-white focus-within:border-[var(--color-primary)] focus-within:ring-4 focus-within:ring-[var(--color-primary)]/12">
        <div className="flex items-center gap-0.5 px-2 pt-1.5">
          <ToolbarButton icon={<BoldIcon className="h-4 w-4" />} label="Bold" onClick={() => wrapSelection("**")} />
          <ToolbarButton icon={<ItalicIcon className="h-4 w-4" />} label="Italic" onClick={() => wrapSelection("*")} />
          <ToolbarButton icon={<UnderlineIcon className="h-4 w-4" />} label="Underline" onClick={() => wrapSelection("__")} />
          <span className="w-px h-4 bg-black/10 mx-1" />
          <ToolbarButton icon={<ListBulletIcon className="h-4 w-4" />} label="Bulleted list" onClick={() => prefixLines(false)} />
          <ToolbarButton icon={<ListOrderedIcon className="h-4 w-4" />} label="Numbered list" onClick={() => prefixLines(true)} />
        </div>

        <textarea
          ref={textareaRef}
          rows={2}
          placeholder={placeholder}
          value={body}
          onChange={(e) => handleChange(e.target.value, e.target.selectionStart ?? e.target.value.length)}
          onKeyDown={handleKeyDown}
          className="w-full resize-none border-0 bg-transparent px-3 py-2 text-[13px] focus:outline-none placeholder:text-[var(--color-neutral-400)]"
        />

        {mentionQuery !== null && filteredMentions.length > 0 && (
          <div className="mx-3 mb-2 rounded-lg border border-[var(--color-neutral-200)] bg-white shadow-[0_8px_24px_-8px_rgba(0,0,0,0.2)] overflow-hidden">
            {filteredMentions.map((name) => (
              <button
                key={name}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => insertMention(name)}
                className="w-full text-left px-3 py-1.5 text-[13px] hover:bg-[var(--color-light-gray)] cursor-pointer"
              >
                @{name}
              </button>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between px-1.5 pb-1.5">
          <div className="flex items-center gap-0.5">
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
            <ToolbarButton
              icon={<PlusIcon className="h-[18px] w-[18px]" />}
              label="Attach a file"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
            />
            {mentionNames.length > 0 && (
              <ToolbarButton icon={<AtIcon className="h-4 w-4" />} label="Mention someone" onClick={triggerMentionButton} />
            )}
          </div>
          <button
            type="button"
            onClick={send}
            disabled={disabled || sending || uploading || !body.trim()}
            aria-label="Send"
            title="Send (⌘/Ctrl + Enter)"
            className="h-8 w-8 shrink-0 flex items-center justify-center rounded-full bg-[var(--color-primary)] text-white hover:brightness-105 active:scale-95 transition-all duration-150 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100"
          >
            <SendIcon className="h-4 w-4" />
          </button>
        </div>
      </div>
      {footer}
    </div>
  );
}
