"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useStagedAttachments, StagedAttachmentChips, type UploadResult } from "@/components/staged-attachments";
import { PaperclipIcon, AtIcon, SendIcon, BoldIcon, ItalicIcon, UnderlineIcon, ListBulletIcon, ListOrderedIcon } from "@/components/icons";
import { ATTACHMENT_ALLOWED_MIME } from "@/lib/validation/ticket";
import { expand, type PlaceholderContext } from "@/lib/placeholders";

// Split of the composer's single "attach" affordance into image-vs-document.
// The whitelist itself hasn't changed — every doc mime here already sat in
// ATTACHMENT_ALLOWED_MIME — but the OS file dialog previously showed
// everything mixed, so a customer trying to attach a PDF had to scroll past
// image types. Two entry points keep the picker's `accept` filter tight to
// what the user actually meant to attach.
const IMAGE_MIME = ATTACHMENT_ALLOWED_MIME.filter((m) => m.startsWith("image/"));
const DOCUMENT_MIME = ATTACHMENT_ALLOWED_MIME.filter((m) => !m.startsWith("image/"));

/** Matches "@partialname" ending at `pos` in `text`, so both live-typing and the toolbar's @ button can share one mention-detection rule. */
function mentionMatchAt(text: string, pos: number): { atIndex: number; query: string } | null {
  const upToCursor = text.slice(0, pos);
  const m = upToCursor.match(/(?:^|\s)@([\w'-]*)$/);
  if (!m) return null;
  return { atIndex: upToCursor.lastIndexOf("@"), query: m[1] };
}

/**
 * Z6.3 — matches "/partial-shortcut" ending at `pos` in `text`. Same rule as
 * mentionMatchAt but for canned-response shortcuts. Kept intentionally
 * narrow (a-z, 0-9, dash) so a stray slash in prose ("and/or") doesn't
 * open the picker.
 */
function shortcutMatchAt(text: string, pos: number): { slashIndex: number; query: string } | null {
  const upToCursor = text.slice(0, pos);
  const m = upToCursor.match(/(?:^|\s)\/([a-z0-9-]*)$/);
  if (!m) return null;
  return { slashIndex: upToCursor.lastIndexOf("/"), query: m[1] };
}

function initialsOf(name: string) {
  return name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
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
      className="h-7 w-7 flex items-center justify-center rounded-md text-[var(--color-neutral-600)] hover:bg-black/[0.06] dark:hover:bg-white/[0.08] hover:text-[var(--foreground)] transition-colors duration-150 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
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
export type CannedResponseOption = { shortcut: string; name: string; body: string };

export function MessageComposer({
  placeholder,
  onSend,
  upload,
  mentionNames = [],
  cannedResponses = [],
  placeholderContext,
  disabled,
  footer,
}: {
  placeholder: string;
  onSend: (body: string, attachmentIds: string[]) => Promise<void>;
  upload: (formData: FormData) => Promise<UploadResult>;
  mentionNames?: string[];
  /**
   * Z6.3 — canned responses the acting session can insert with /shortcut.
   * Empty (the default) disables the picker entirely. Bodies may contain
   * {{...}} placeholders resolved through `placeholderContext` at insert
   * time via src/lib/placeholders.ts.
   */
  cannedResponses?: CannedResponseOption[];
  /**
   * Z6.2 — context passed to expand() when a canned response is inserted.
   * The composer is a plain-text surface, so expansion runs in "text"
   * mode (HTML-escaped). Omitting this while providing cannedResponses
   * still works — placeholders that can't be resolved render as blanks.
   */
  placeholderContext?: PlaceholderContext;
  disabled?: boolean;
  footer?: React.ReactNode;
}) {
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [shortcutQuery, setShortcutQuery] = useState<string | null>(null);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const documentInputRef = useRef<HTMLInputElement>(null);
  const [attachOpen, setAttachOpen] = useState(false);
  const attachRef = useRef<HTMLDivElement>(null);
  // Close the attach popover on outside click / Escape so it feels like
  // every other floating chooser in the app.
  useEffect(() => {
    if (!attachOpen) return;
    function onDown(e: MouseEvent) {
      if (attachRef.current && !attachRef.current.contains(e.target as Node)) {
        setAttachOpen(false);
      }
    }
    function onKey(e: globalThis.KeyboardEvent) {
      if (e.key === "Escape") setAttachOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [attachOpen]);
  const { staged, uploading, addFiles, remove, reset, attachmentIds } = useStagedAttachments(upload);

  const filteredMentions = mentionQuery === null ? [] : mentionNames.filter((n) => n.toLowerCase().includes(mentionQuery.toLowerCase()));
  const filteredShortcuts =
    shortcutQuery === null
      ? []
      : cannedResponses.filter(
          (r) =>
            r.shortcut.toLowerCase().startsWith(shortcutQuery.toLowerCase()) ||
            r.name.toLowerCase().includes(shortcutQuery.toLowerCase())
        );

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

  function insertShortcut(option: CannedResponseOption) {
    const el = textareaRef.current;
    const pos = el?.selectionStart ?? body.length;
    const match = shortcutMatchAt(body, pos);
    if (!match) return;
    const expanded = placeholderContext
      ? expand(option.body, placeholderContext, "text")
      : option.body;
    const next = `${body.slice(0, match.slashIndex)}${expanded}${body.slice(pos)}`;
    setBodyAndCaret(next, match.slashIndex + expanded.length);
    setShortcutQuery(null);
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
    setHighlightedIndex(0);
  }

  function handleChange(value: string, caret: number) {
    setBody(value);
    const match = mentionMatchAt(value, caret);
    setMentionQuery(match ? match.query : null);
    if (!match && cannedResponses.length > 0) {
      const s = shortcutMatchAt(value, caret);
      setShortcutQuery(s ? s.query : null);
    } else {
      setShortcutQuery(null);
    }
    setHighlightedIndex(0);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (mentionQuery !== null && filteredMentions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlightedIndex((i) => Math.min(i + 1, filteredMentions.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlightedIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        insertMention(filteredMentions[Math.min(highlightedIndex, filteredMentions.length - 1)]);
        return;
      }
    }
    if (mentionQuery !== null && e.key === "Escape") {
      setMentionQuery(null);
      return;
    }
    if (shortcutQuery !== null && filteredShortcuts.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlightedIndex((i) => Math.min(i + 1, filteredShortcuts.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlightedIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        insertShortcut(
          filteredShortcuts[Math.min(highlightedIndex, filteredShortcuts.length - 1)]
        );
        return;
      }
    }
    if (shortcutQuery !== null && e.key === "Escape") {
      setShortcutQuery(null);
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
      <div className="relative rounded-2xl border border-[var(--color-neutral-300)] bg-[var(--color-light-gray)]/50 transition-colors duration-150 focus-within:bg-[var(--color-surface)] focus-within:border-[var(--color-primary)] focus-within:ring-4 focus-within:ring-[var(--color-primary)]/12">
        <div className="flex items-center gap-0.5 px-2 pt-1.5">
          <ToolbarButton icon={<BoldIcon className="h-4 w-4" />} label="Bold" onClick={() => wrapSelection("**")} />
          <ToolbarButton icon={<ItalicIcon className="h-4 w-4" />} label="Italic" onClick={() => wrapSelection("*")} />
          <ToolbarButton icon={<UnderlineIcon className="h-4 w-4" />} label="Underline" onClick={() => wrapSelection("__")} />
          <span className="w-px h-4 bg-black/10 dark:bg-white/10 mx-1" />
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

        {shortcutQuery !== null && filteredShortcuts.length > 0 && (
          <div className="absolute bottom-full left-0 mb-2 w-80 rounded-xl border border-[var(--color-neutral-200)] bg-[var(--color-surface)] shadow-[0_16px_40px_-12px_rgba(0,0,0,0.3)] overflow-hidden z-20">
            <div className="max-h-56 overflow-y-auto py-1.5">
              {filteredShortcuts.map((r, i) => {
                const active = i === highlightedIndex;
                return (
                  <button
                    key={r.shortcut}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseEnter={() => setHighlightedIndex(i)}
                    onClick={() => insertShortcut(r)}
                    className={`w-full flex items-start gap-2.5 px-3 py-1.5 text-[13px] text-left cursor-pointer transition-colors duration-100 ${
                      active ? "bg-[var(--color-primary)] text-white" : "text-[var(--foreground)]"
                    }`}
                  >
                    <span
                      className={`shrink-0 mt-0.5 font-mono text-[11px] px-1.5 py-0.5 rounded ${
                        active
                          ? "bg-white/20 text-white"
                          : "bg-[var(--color-neutral-100)] dark:bg-white/[0.06] text-[var(--color-neutral-700)]"
                      }`}
                    >
                      /{r.shortcut}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium truncate">{r.name}</span>
                      <span
                        className={`block text-[11px] truncate ${
                          active ? "text-white/80" : "text-[var(--color-neutral-500)]"
                        }`}
                      >
                        {r.body.slice(0, 80)}
                        {r.body.length > 80 ? "…" : ""}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="flex items-center gap-3 px-3 py-1.5 border-t border-black/5 dark:border-white/10 bg-[var(--color-light-gray)]/70 text-[10px] text-[var(--color-neutral-500)]">
              <span className="flex items-center gap-1">
                <kbd className="px-1 py-0.5 rounded bg-[var(--color-surface)] border border-black/10 dark:border-white/10 font-mono text-[9px]">↑↓</kbd> navigate
              </span>
              <span className="flex items-center gap-1">
                <kbd className="px-1 py-0.5 rounded bg-[var(--color-surface)] border border-black/10 dark:border-white/10 font-mono text-[9px]">↵</kbd> insert
              </span>
              <span className="flex items-center gap-1">
                <kbd className="px-1 py-0.5 rounded bg-[var(--color-surface)] border border-black/10 dark:border-white/10 font-mono text-[9px]">esc</kbd> dismiss
              </span>
            </div>
          </div>
        )}

        {mentionQuery !== null && filteredMentions.length > 0 && (
          <div className="absolute bottom-full left-0 mb-2 w-72 rounded-xl border border-[var(--color-neutral-200)] bg-[var(--color-surface)] shadow-[0_16px_40px_-12px_rgba(0,0,0,0.3)] overflow-hidden z-20">
            <div className="max-h-56 overflow-y-auto py-1.5">
              {filteredMentions.map((name, i) => {
                const active = i === highlightedIndex;
                return (
                  <button
                    key={name}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseEnter={() => setHighlightedIndex(i)}
                    onClick={() => insertMention(name)}
                    className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-[13px] text-left cursor-pointer transition-colors duration-100 ${
                      active ? "bg-[var(--color-primary)] text-white" : "text-[var(--foreground)]"
                    }`}
                  >
                    <span
                      className={`h-6 w-6 shrink-0 rounded-md flex items-center justify-center text-[10px] font-semibold ${
                        active ? "bg-white/20 text-white" : "bg-[var(--color-orange-pale)] text-[var(--color-orange-deep)]"
                      }`}
                    >
                      {initialsOf(name)}
                    </span>
                    <span className="truncate font-medium">{name}</span>
                  </button>
                );
              })}
            </div>
            <div className="flex items-center gap-3 px-3 py-1.5 border-t border-black/5 dark:border-white/10 bg-[var(--color-light-gray)]/70 text-[10px] text-[var(--color-neutral-500)]">
              <span className="flex items-center gap-1">
                <kbd className="px-1 py-0.5 rounded bg-[var(--color-surface)] border border-black/10 dark:border-white/10 font-mono text-[9px]">↑↓</kbd> to navigate
              </span>
              <span className="flex items-center gap-1">
                <kbd className="px-1 py-0.5 rounded bg-[var(--color-surface)] border border-black/10 dark:border-white/10 font-mono text-[9px]">↵</kbd> to select
              </span>
              <span className="flex items-center gap-1">
                <kbd className="px-1 py-0.5 rounded bg-[var(--color-surface)] border border-black/10 dark:border-white/10 font-mono text-[9px]">esc</kbd> to dismiss
              </span>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between px-1.5 pb-1.5">
          <div className="flex items-center gap-0.5">
            <input
              ref={imageInputRef}
              type="file"
              multiple
              accept={IMAGE_MIME.join(",")}
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.length) addFiles(e.target.files);
                e.target.value = "";
                setAttachOpen(false);
              }}
            />
            <input
              ref={documentInputRef}
              type="file"
              multiple
              accept={DOCUMENT_MIME.join(",")}
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.length) addFiles(e.target.files);
                e.target.value = "";
                setAttachOpen(false);
              }}
            />
            <div ref={attachRef} className="relative">
              <ToolbarButton
                icon={<PaperclipIcon className="h-[18px] w-[18px]" />}
                label="Attach a file"
                onClick={() => setAttachOpen((o) => !o)}
                disabled={uploading}
              />
              {attachOpen && (
                <div
                  role="menu"
                  className="absolute z-20 bottom-9 left-0 min-w-[168px] bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-xl shadow-lg py-1"
                >
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => imageInputRef.current?.click()}
                    className="w-full text-left px-3 py-1.5 text-[13px] hover:bg-[var(--color-light-gray)] cursor-pointer flex items-center gap-2"
                  >
                    <span className="text-base leading-none">🖼</span>
                    <span>Image</span>
                    <span className="ml-auto text-[10px] text-[var(--color-neutral-500)]">
                      PNG · JPG
                    </span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => documentInputRef.current?.click()}
                    className="w-full text-left px-3 py-1.5 text-[13px] hover:bg-[var(--color-light-gray)] cursor-pointer flex items-center gap-2"
                  >
                    <span className="text-base leading-none">📄</span>
                    <span>Document</span>
                    <span className="ml-auto text-[10px] text-[var(--color-neutral-500)]">
                      PDF · DOCX · CSV…
                    </span>
                  </button>
                </div>
              )}
            </div>
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
