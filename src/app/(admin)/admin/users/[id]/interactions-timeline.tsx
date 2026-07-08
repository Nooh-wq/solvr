"use client";

// Z3.3 — Tickets-only interactions timeline. Z3.4 layers in chat
// conversations + KB article views; the props shape already accepts
// both so the page component stays stable across sub-pieces.

import Link from "next/link";
import { useMemo, useState } from "react";
import type { TicketStatus, Priority } from "@/generated/prisma";

type Ticket = {
  id: string;
  reference: string;
  title: string;
  status: TicketStatus;
  priority: Priority;
  createdAt: Date;
  updatedAt: Date;
  csatRating: number | null;
};
type Chat = { id: string; startedAt: Date; endedAt: Date | null; ticketId: string | null };
type KbView = { id: string; articleTitle: string; viewedAt: Date };

type Item =
  | { kind: "ticket"; date: Date; data: Ticket }
  | { kind: "chat"; date: Date; data: Chat }
  | { kind: "kb"; date: Date; data: KbView };

type FilterKind = "all" | "ticket" | "chat" | "kb";

export function InteractionsTimeline({
  tickets,
  chats,
  kbViews,
}: {
  tickets: Ticket[];
  chats: Chat[];
  kbViews: KbView[];
}) {
  const [filter, setFilter] = useState<FilterKind>("all");
  const items: Item[] = useMemo(() => {
    const all: Item[] = [
      // Dates from the server component arrive as strings under `use client`
      // props round-tripping — coerce back to Date defensively.
      ...tickets.map(
        (t) =>
          ({ kind: "ticket", date: new Date(t.updatedAt), data: t }) as Item
      ),
      ...chats.map(
        (c) =>
          ({ kind: "chat", date: new Date(c.startedAt), data: c }) as Item
      ),
      ...kbViews.map(
        (k) => ({ kind: "kb", date: new Date(k.viewedAt), data: k }) as Item
      ),
    ];
    all.sort((a, b) => b.date.getTime() - a.date.getTime());
    return all.filter((i) => filter === "all" || i.kind === filter);
  }, [tickets, chats, kbViews, filter]);

  return (
    <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-[13px] font-semibold">Interactions</h2>
        <div className="flex gap-1 text-[11px]">
          {(
            [
              ["all", "All"],
              ["ticket", "Tickets"],
              ["chat", "Chats"],
              ["kb", "KB"],
            ] as const
          ).map(([k, l]) => (
            <button
              key={k}
              type="button"
              onClick={() => setFilter(k)}
              className={`px-2 h-6 rounded-md cursor-pointer transition-colors ${
                filter === k
                  ? "bg-[var(--color-primary)] text-white"
                  : "text-[var(--color-neutral-600)] hover:bg-[var(--color-light-gray)]"
              }`}
            >
              {l}
            </button>
          ))}
        </div>
      </div>

      {items.length === 0 ? (
        <div className="text-[13px] text-[var(--color-neutral-500)] py-6 text-center">
          No {filter === "all" ? "" : filter + " "}interactions yet.
        </div>
      ) : (
        <ul className="divide-y divide-[var(--color-neutral-200)] dark:divide-white/5 -mx-2">
          {items.map((i) => (
            <li key={`${i.kind}-${keyOf(i)}`} className="px-2 py-3">
              {renderItem(i)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function keyOf(i: Item): string {
  if (i.kind === "ticket") return i.data.id;
  if (i.kind === "chat") return i.data.id;
  return i.data.id;
}

function renderItem(i: Item) {
  if (i.kind === "ticket") {
    const t = i.data;
    return (
      <Link href={`/agent/tickets/${t.id}`} className="flex items-start gap-3 group">
        <TypeDot color="bg-blue-500" />
        <div className="min-w-0 flex-1">
          <div className="text-[13px] text-[var(--foreground)] group-hover:text-[var(--color-primary)] truncate">
            <span className="text-[var(--color-neutral-500)] mr-1.5">{t.reference}</span>
            {t.title}
          </div>
          <div className="text-[11px] text-[var(--color-neutral-500)] mt-0.5 flex items-center gap-2">
            <span>{ticketStatusLabel(t.status)}</span>
            <span>·</span>
            <span>{formatDate(i.date)}</span>
            {t.csatRating !== null && (
              <>
                <span>·</span>
                <span>CSAT {t.csatRating}/5</span>
              </>
            )}
          </div>
        </div>
      </Link>
    );
  }
  if (i.kind === "chat") {
    return (
      <div className="flex items-start gap-3">
        <TypeDot color="bg-emerald-500" />
        <div className="min-w-0 flex-1">
          <div className="text-[13px]">Chat conversation</div>
          <div className="text-[11px] text-[var(--color-neutral-500)] mt-0.5">
            {formatDate(i.date)}
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-start gap-3">
      <TypeDot color="bg-amber-500" />
      <div className="min-w-0 flex-1">
        <div className="text-[13px] truncate">Read: {i.data.articleTitle}</div>
        <div className="text-[11px] text-[var(--color-neutral-500)] mt-0.5">
          {formatDate(i.date)}
        </div>
      </div>
    </div>
  );
}

function TypeDot({ color }: { color: string }) {
  return <span className={`mt-1.5 h-2 w-2 rounded-full ${color} shrink-0`} />;
}

function ticketStatusLabel(s: TicketStatus): string {
  return s.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatDate(d: Date): string {
  const delta = Date.now() - d.getTime();
  const day = 86_400_000;
  if (delta < day) return "today";
  if (delta < day * 2) return "yesterday";
  if (delta < day * 7) return `${Math.floor(delta / day)}d ago`;
  return d.toLocaleDateString();
}
