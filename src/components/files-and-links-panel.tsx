"use client";

import { useMemo, useState } from "react";
import { PaperclipIcon, LinkIcon, SearchIcon, ChevronDownIcon } from "@/components/icons";

export type PanelFile = {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  url: string;
  uploadedAt: string;
  uploadedByName: string | null;
};

const URL_PATTERN = /https?:\/\/[^\s<>"')]+/g;

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Collapsible "Files & links" section for the ticket right rail — every
 * attachment on the ticket, plus every link mentioned in the (visible)
 * conversation, searchable together. Links are extracted client-side from
 * message bodies rather than stored separately; messages passed in should
 * already reflect whatever internal-note visibility the viewer is allowed
 * (getTicket() filters those out for CLIENT at the query level).
 */
export function FilesAndLinksPanel({
  files,
  messages,
}: {
  files: PanelFile[];
  messages: { body: string; createdAt: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const links = useMemo(() => {
    const seen = new Set<string>();
    const found: { url: string; createdAt: string }[] = [];
    for (const m of messages) {
      const matches = m.body.match(URL_PATTERN);
      if (!matches) continue;
      for (const url of matches) {
        const key = `${url}|${m.createdAt}`;
        if (seen.has(key)) continue;
        seen.add(key);
        found.push({ url, createdAt: m.createdAt });
      }
    }
    return found.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [messages]);

  const q = query.trim().toLowerCase();
  const filteredFiles = q ? files.filter((f) => f.fileName.toLowerCase().includes(q)) : files;
  const filteredLinks = q ? links.filter((l) => l.url.toLowerCase().includes(q)) : links;
  const total = files.length + links.length;

  return (
    <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl mt-6 overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 cursor-pointer"
      >
        <span className="flex items-center gap-2 text-[13px] font-semibold">
          <PaperclipIcon className="h-4 w-4 text-[var(--color-neutral-600)]" />
          Files &amp; links
          <span className="text-[var(--color-neutral-400)] font-normal">({total})</span>
        </span>
        <ChevronDownIcon className={`h-4 w-4 text-[var(--color-neutral-500)] transition-transform duration-150 ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="border-t border-black/5 dark:border-white/10">
          {total > 0 && (
            <div className="p-2.5 border-b border-black/5 dark:border-white/10">
              <div className="relative">
                <SearchIcon className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-neutral-400)]" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search files & links…"
                  className="h-8 w-full pl-7 pr-3 text-[12px] border border-[var(--color-neutral-300)] bg-[var(--color-surface)] text-[var(--foreground)] rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30"
                />
              </div>
            </div>
          )}
          <div className="max-h-72 overflow-y-auto p-2 space-y-1">
            {total === 0 && <p className="text-[12px] text-[var(--color-neutral-500)] px-2 py-3 text-center">Nothing shared yet.</p>}
            {total > 0 && filteredFiles.length === 0 && filteredLinks.length === 0 && (
              <p className="text-[12px] text-[var(--color-neutral-500)] px-2 py-3 text-center">No matches.</p>
            )}
            {filteredFiles.map((f) => (
              <a
                key={f.id}
                href={f.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-black/[0.03] dark:hover:bg-white/[0.05] transition-colors duration-150"
              >
                <PaperclipIcon className="h-3.5 w-3.5 shrink-0 text-[var(--color-neutral-400)]" />
                <span className="min-w-0 flex-1">
                  <span className="block text-[12px] font-medium truncate">{f.fileName}</span>
                  <span className="block text-[10px] text-[var(--color-neutral-500)]">
                    {formatBytes(f.sizeBytes)} · {f.uploadedByName ?? "Unknown"}
                  </span>
                </span>
              </a>
            ))}
            {filteredLinks.map((l, i) => (
              <a
                key={`${l.url}-${i}`}
                href={l.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-black/[0.03] dark:hover:bg-white/[0.05] transition-colors duration-150"
              >
                <LinkIcon className="h-3.5 w-3.5 shrink-0 text-[var(--color-neutral-400)]" />
                <span className="min-w-0 flex-1 block text-[12px] text-[var(--color-primary)] truncate">{l.url}</span>
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
