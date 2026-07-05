"use client";

import { useEffect, useMemo, useState } from "react";
import { SearchIcon, PaperclipIcon } from "@/components/icons";

export type MessageAttachment = {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  fileUrl: string; // already a ready-to-use (signed) URL
};

export type ConversationMessage = {
  id: string;
  body: string;
  senderRole: string;
  isInternal: boolean;
  createdAt: string; // ISO
  sender: { name: string; avatarUrl: string | null } | null;
  attachments?: MessageAttachment[];
};

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** Inline attachment: an actual thumbnail for images, a file chip (name + size) for everything else. */
function AttachmentPreview({ attachment, onLight }: { attachment: MessageAttachment; onLight: boolean }) {
  if (attachment.mimeType.startsWith("image/")) {
    return (
      <a href={attachment.fileUrl} target="_blank" rel="noopener noreferrer" className="block mt-2 max-w-[220px]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={attachment.fileUrl} alt={attachment.fileName} className="rounded-lg border border-black/10 dark:border-white/10 max-h-40 object-cover" />
      </a>
    );
  }
  return (
    <a
      href={attachment.fileUrl}
      target="_blank"
      rel="noopener noreferrer"
      className={`mt-2 flex items-center gap-2 rounded-lg px-2.5 py-2 text-[12px] transition-colors duration-150 ${
        onLight ? "bg-white/15 hover:bg-white/25 text-white" : "bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/15 text-[var(--foreground)]"
      }`}
    >
      <PaperclipIcon className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate font-medium">{attachment.fileName}</span>
      <span className={`shrink-0 ${onLight ? "text-white/70" : "text-[var(--color-neutral-500)]"}`}>{formatBytes(attachment.sizeBytes)}</span>
    </a>
  );
}

function initials(name: string) {
  return name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function dayLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const yest = new Date();
  yest.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yest.toDateString()) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
}

function timeLabel(iso: string) {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/** Highlights case-insensitive matches of `q` within `text`. */
function highlightPlain(text: string, q: string, keyOffset = 0): React.ReactNode[] {
  if (!q) return [text];
  const parts: React.ReactNode[] = [];
  const lower = text.toLowerCase();
  const ql = q.toLowerCase();
  let i = 0;
  let key = keyOffset;
  while (i < text.length) {
    const idx = lower.indexOf(ql, i);
    if (idx === -1) {
      parts.push(text.slice(i));
      break;
    }
    if (idx > i) parts.push(text.slice(i, idx));
    parts.push(
      <mark key={key++} className="bg-[var(--color-orange-pale)] text-[var(--color-orange-deep)] rounded px-0.5">
        {text.slice(idx, idx + q.length)}
      </mark>
    );
    i = idx + q.length;
  }
  return parts;
}

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Inline formatting written by MessageComposer (**bold**, *italic*,
 * __underline__) plus @mentions of known participants, layered with the
 * existing search highlight — all in one left-to-right scan so they compose
 * instead of clobbering each other. Deliberately builds React elements
 * directly (never dangerouslySetInnerHTML), so arbitrary HTML in a message
 * body is never a rendering concern.
 */
function renderInline(text: string, query: string, mentionNames: string[]): React.ReactNode[] {
  if (!text) return [];
  const mentionAlt = mentionNames.length
    ? mentionNames
        .slice()
        .sort((a, b) => b.length - a.length)
        .map(escapeRegExp)
        .join("|")
    : null;
  const pattern = new RegExp(`\\*\\*(.+?)\\*\\*|__(.+?)__|\\*(.+?)\\*${mentionAlt ? `|@(${mentionAlt})` : ""}`, "g");

  const nodes: React.ReactNode[] = [];
  let last = 0;
  let key = 0;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(text))) {
    if (m.index > last) {
      nodes.push(...highlightPlain(text.slice(last, m.index), query, key));
      key += 1000;
    }
    if (m[1] !== undefined) nodes.push(<strong key={key++}>{m[1]}</strong>);
    else if (m[2] !== undefined) nodes.push(<u key={key++}>{m[2]}</u>);
    else if (m[3] !== undefined) nodes.push(<em key={key++}>{m[3]}</em>);
    else if (m[4] !== undefined)
      nodes.push(
        <span key={key++} className="font-semibold text-[var(--color-primary)] bg-[var(--color-orange-pale)] rounded px-1">
          @{m[4]}
        </span>
      );
    last = pattern.lastIndex;
  }
  if (last < text.length) nodes.push(...highlightPlain(text.slice(last), query, key));
  return nodes;
}

/** "- "/"1. " lines (written by MessageComposer's list buttons) render as real <ul>/<ol>; everything else is a paragraph line. */
function renderMessageBody(text: string, query: string, mentionNames: string[]): React.ReactNode {
  const lines = text.split("\n");
  const blocks: React.ReactNode[] = [];
  let i = 0;
  let key = 0;
  while (i < lines.length) {
    const isBullet = (l: string) => /^[•-]\s+/.test(l);
    const isOrdered = (l: string) => /^\d+\.\s+/.test(l);
    if (isBullet(lines[i])) {
      const items: string[] = [];
      while (i < lines.length && isBullet(lines[i])) {
        items.push(lines[i].replace(/^[•-]\s+/, ""));
        i++;
      }
      blocks.push(
        <ul key={key++} className="list-disc pl-4 my-1 space-y-0.5">
          {items.map((it, idx) => (
            <li key={idx}>{renderInline(it, query, mentionNames)}</li>
          ))}
        </ul>
      );
      continue;
    }
    if (isOrdered(lines[i])) {
      const items: string[] = [];
      while (i < lines.length && isOrdered(lines[i])) {
        items.push(lines[i].replace(/^\d+\.\s+/, ""));
        i++;
      }
      blocks.push(
        <ol key={key++} className="list-decimal pl-4 my-1 space-y-0.5">
          {items.map((it, idx) => (
            <li key={idx}>{renderInline(it, query, mentionNames)}</li>
          ))}
        </ol>
      );
      continue;
    }
    blocks.push(
      <span key={key++}>
        {renderInline(lines[i], query, mentionNames)}
        {i < lines.length - 1 ? <br /> : null}
      </span>
    );
    i++;
  }
  return blocks;
}

/**
 * Shared chat-style conversation thread, used by both the agent workspace
 * and the client portal so the two sides render identically (just mirrored).
 * `mySenderRoles` decides which messages align right ("our side") for
 * whoever is currently looking at the screen — an agent passes
 * ["AGENT","ADMIN","SUPER_ADMIN"], a client passes ["CLIENT"]. The opening
 * ticket description is always authored by the client, so it's positioned
 * via the same isOurSide("CLIENT") check as any other message — meaning a
 * client sees their own opening message on the right, while an agent sees
 * it on the left, exactly like every reply that follows.
 */
// 4s was too aggressive for the production DB's connection budget (a
// session-mode Supabase pooler capped at 15 clients — see DEPLOYMENT.md) and
// contributed to a real outage: every open ticket page was opening a fresh
// pooled connection 15x/minute, on top of normal traffic, on a serverless
// host where connections aren't shared across invocations the way a
// long-running server would. 15s keeps replies feeling close to live without
// hammering that budget.
const POLL_MS = 15_000;

export function ConversationThread({
  description,
  clientName,
  messages: initialMessages,
  mySenderRoles,
  composer,
  mentionNames = [],
  onPoll,
}: {
  description: string;
  clientName: string;
  messages: ConversationMessage[];
  mySenderRoles: string[];
  composer?: React.ReactNode;
  /** Known participant display names — used only to recognize @mentions already written into a message body when rendering it back. See page.tsx's participantNames(), which also feeds MessageComposer's autocomplete list. */
  mentionNames?: string[];
  /** Polled every few seconds so a reply from the other side shows up without a manual refresh — see getTicketMessages()/getGuestTicketMessages(). Omit to disable polling. */
  onPoll?: () => Promise<ConversationMessage[] | null>;
}) {
  const [query, setQuery] = useState("");
  const [showInternal, setShowInternal] = useState(true);
  const [messages, setMessages] = useState(initialMessages);
  // Tracks the last `initialMessages` reference so a fresh one (e.g. after
  // router.refresh() on the sender's own send) can override whatever the poll
  // last fetched — both are equally "current", but this keeps the sender's
  // own reply appearing instantly instead of waiting for a tick. Adjusting
  // state directly during render (React's recommended pattern for this,
  // rather than a useEffect) avoids an extra render pass.
  const [prevInitialMessages, setPrevInitialMessages] = useState(initialMessages);
  if (initialMessages !== prevInitialMessages) {
    setPrevInitialMessages(initialMessages);
    setMessages(initialMessages);
  }

  useEffect(() => {
    if (!onPoll) return;
    let cancelled = false;
    const interval = setInterval(async () => {
      try {
        const fresh = await onPoll();
        if (!cancelled && fresh) setMessages(fresh);
      } catch {
        // Transient network/DB hiccup — skip this tick, the next one recovers.
      }
    }, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [onPoll]);

  const isOurSide = (role: string) => mySenderRoles.includes(role);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return messages.filter((m) => {
      if (!showInternal && m.isInternal) return false;
      if (q && !m.body.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [messages, query, showInternal]);

  const internalCount = messages.filter((m) => m.isInternal).length;

  // Group consecutive messages by calendar day for date separators.
  const groups: { day: string; items: ConversationMessage[] }[] = [];
  for (const m of filtered) {
    const day = dayLabel(m.createdAt);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.items.push(m);
    else groups.push({ day, items: [m] });
  }

  return (
    <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl overflow-hidden flex flex-col">
      {/* Toolbar: search + internal toggle (the toggle only ever renders when
          there are internal notes to hide — never the case for a client
          viewer, since getTicket() already filters those out server-side). */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-black/5 dark:border-white/10 bg-[var(--color-surface)]/60">
        <div className="relative flex-1 max-w-xs">
          <SearchIcon className="h-4 w-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-neutral-400)]" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search messages…"
            className="h-8 w-full pl-8 pr-3 text-[13px] border border-[var(--color-neutral-300)] bg-[var(--color-surface)] text-[var(--foreground)] rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30"
          />
        </div>
        {internalCount > 0 && (
          <button
            onClick={() => setShowInternal((v) => !v)}
            className={`h-8 px-3 text-[12px] font-medium rounded-lg border transition-colors duration-150 cursor-pointer ${
              showInternal
                ? "bg-[var(--color-orange-pale)] border-[var(--color-orange-core)]/40 text-[var(--color-orange-deep)]"
                : "bg-[var(--color-surface)] border-[var(--color-neutral-300)] text-[var(--color-neutral-600)]"
            }`}
          >
            {showInternal ? "Hide" : "Show"} internal ({internalCount})
          </button>
        )}
      </div>

      <div className="p-4 space-y-4 max-h-[560px] overflow-y-auto">
        {/* Original request as the opening client message */}
        {!query && (
          <Bubble side={isOurSide("CLIENT") ? "right" : "left"} name={clientName} initials={initials(clientName)}>
            <div className="whitespace-pre-wrap">{renderMessageBody(description, "", mentionNames)}</div>
          </Bubble>
        )}

        {groups.length === 0 && (
          <p className="text-center text-[13px] text-[var(--color-neutral-500)] py-6">
            {query ? "No messages match your search." : "No replies yet."}
          </p>
        )}

        {groups.map((g) => (
          <div key={g.day} className="space-y-3">
            <div className="flex items-center gap-3 my-2">
              <div className="flex-1 h-px bg-[var(--color-neutral-100)]" />
              <span className="text-[11px] font-medium text-[var(--color-neutral-400)]">{g.day}</span>
              <div className="flex-1 h-px bg-[var(--color-neutral-100)]" />
            </div>

            {g.items.map((m) => {
              const name = m.sender?.name ?? m.senderRole;
              if (m.isInternal) {
                return (
                  <div key={m.id} className="rounded-xl border border-[var(--color-orange-core)]/30 bg-[var(--color-orange-pale)]/60 p-3">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="uppercase-label text-[10px] text-[var(--color-orange-deep)] font-semibold">Internal note</span>
                      <span className="text-[11px] text-[var(--color-neutral-600)]">{name}</span>
                      <span className="text-[11px] text-[var(--color-neutral-400)] ml-auto">{timeLabel(m.createdAt)}</span>
                    </div>
                    <div className="text-[13px] whitespace-pre-wrap">{renderMessageBody(m.body, query, mentionNames)}</div>
                    {m.attachments?.map((a) => (
                      <AttachmentPreview key={a.id} attachment={a} onLight={false} />
                    ))}
                  </div>
                );
              }
              const ours = isOurSide(m.senderRole);
              return (
                <Bubble
                  key={m.id}
                  side={ours ? "right" : "left"}
                  name={name}
                  initials={initials(name)}
                  avatarUrl={m.sender?.avatarUrl ?? null}
                  time={timeLabel(m.createdAt)}
                >
                  <div className="whitespace-pre-wrap">{renderMessageBody(m.body, query, mentionNames)}</div>
                  {m.attachments?.map((a) => (
                    <AttachmentPreview key={a.id} attachment={a} onLight={ours} />
                  ))}
                </Bubble>
              );
            })}
          </div>
        ))}
      </div>

      {composer && <div className="border-t border-black/5 dark:border-white/10 p-3">{composer}</div>}
    </div>
  );
}

function Bubble({
  side,
  name,
  initials,
  avatarUrl,
  time,
  children,
}: {
  side: "left" | "right";
  name: string;
  initials: string;
  avatarUrl?: string | null;
  time?: string;
  children: React.ReactNode;
}) {
  const right = side === "right";
  return (
    <div className={`flex gap-2.5 ${right ? "flex-row-reverse" : ""}`}>
      {avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={avatarUrl} alt="" className="h-8 w-8 rounded-full object-cover shrink-0" />
      ) : (
        <span
          className={`h-8 w-8 rounded-full shrink-0 flex items-center justify-center text-[11px] font-semibold ${
            right ? "bg-[var(--color-primary)] text-white" : "bg-[var(--color-neutral-100)] text-[var(--color-neutral-700)]"
          }`}
        >
          {initials}
        </span>
      )}
      <div className={`min-w-0 max-w-[78%] ${right ? "items-end text-right" : ""} flex flex-col`}>
        <div className={`flex items-center gap-2 mb-1 ${right ? "flex-row-reverse" : ""}`}>
          <span className="text-[12px] font-semibold">{name}</span>
          {time && <span className="text-[11px] text-[var(--color-neutral-400)]">{time}</span>}
        </div>
        <div
          className={`text-[13px] leading-relaxed px-3.5 py-2.5 rounded-2xl ${
            right
              ? "bg-[var(--color-primary)] text-white rounded-tr-sm"
              : "bg-[var(--color-light-gray)] text-[var(--foreground)] rounded-tl-sm"
          }`}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
