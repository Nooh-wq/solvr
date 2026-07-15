"use client";

// M-admin — Command palette (Cmd/Ctrl + K).
//
// Two modes:
//   navigate (default): fuzzy-match label + keywords across ADMIN_PAGE_CATALOG
//   action (prefix `>`): quick actions that navigate to a page/modal
//
// Recent (empty input): last 5 visited admin pages from the same
// localStorage key the sidebar uses (Z7.2), so palette + sidebar
// agree on "recently viewed".

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ADMIN_PAGE_CATALOG, type AdminPageEntry } from "@/lib/admin-nav-catalog";

const RECENT_KEY = "solvr:admin-recently-viewed";

type ActionEntry = { id: string; label: string; run: (router: ReturnType<typeof useRouter>) => void };

const ACTIONS: ActionEntry[] = [
  { id: "invite-user", label: "Invite team member", run: (r) => r.push("/admin/team-members?invite=1") },
  { id: "create-field", label: "Create custom field", run: (r) => r.push("/admin/fields?new=1") },
  { id: "create-trigger", label: "Create trigger", run: (r) => r.push("/admin/triggers?new=1") },
  { id: "new-report", label: "New report", run: (r) => r.push("/admin/reports?new=1") },
  { id: "install-app", label: "Install app", run: (r) => r.push("/admin/apps/marketplace") },
];

function score(entry: AdminPageEntry, q: string): number {
  const s = q.toLowerCase();
  const label = entry.label.toLowerCase();
  if (label.includes(s)) return 100 - Math.abs(label.length - s.length);
  for (const k of entry.keywords) {
    if (k.toLowerCase().includes(s)) return 50;
  }
  return 0;
}

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [recent, setRecent] = useState<{ href: string; label: string }[]>([]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === "Escape" && open) {
        setOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setQ("");
    setCursor(0);
    try {
      const raw = localStorage.getItem(RECENT_KEY);
      if (raw) setRecent(JSON.parse(raw));
    } catch {
      /* ignore */
    }
    // Focus after paint.
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  const isActionMode = q.startsWith(">");
  const trimmed = isActionMode ? q.slice(1).trim() : q.trim();

  const results = useMemo(() => {
    if (!trimmed && !isActionMode) {
      // Empty input = recent.
      return recent.map((r) => ({ kind: "nav" as const, label: r.label, href: r.href, entry: null }));
    }
    if (isActionMode) {
      const filter = trimmed.toLowerCase();
      return ACTIONS.filter((a) => a.label.toLowerCase().includes(filter))
        .slice(0, 8)
        .map((a) => ({ kind: "action" as const, label: a.label, href: "", entry: null, action: a }));
    }
    return ADMIN_PAGE_CATALOG.map((e) => ({ e, s: score(e, trimmed) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 8)
      .map((x) => ({ kind: "nav" as const, label: x.e.label, href: x.e.href, entry: x.e }));
  }, [q, trimmed, isActionMode, recent]);

  function activate(index: number) {
    const r = results[index];
    if (!r) return;
    setOpen(false);
    if (r.kind === "action" && "action" in r) {
      r.action.run(router);
    } else if (r.kind === "nav") {
      router.push(r.href);
    }
  }

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center pt-24 bg-black/40"
      onClick={() => setOpen(false)}
    >
      <div
        role="dialog"
        aria-label="Command palette"
        className="w-[560px] max-w-[92vw] bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl shadow-xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setCursor(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setCursor((c) => Math.min(c + 1, Math.max(0, results.length - 1)));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setCursor((c) => Math.max(0, c - 1));
            } else if (e.key === "Enter") {
              e.preventDefault();
              activate(cursor);
            }
          }}
          placeholder='Jump to a page — or type ">" for actions'
          className="w-full px-4 py-3 text-[14px] bg-transparent outline-none border-b border-[var(--color-neutral-200)]"
        />
        {results.length === 0 ? (
          <div className="px-4 py-6 text-[12px] text-[var(--color-neutral-500)] text-center">
            {isActionMode ? "No matching actions" : trimmed ? "No matches" : "Type to search"}
          </div>
        ) : (
          <ul className="max-h-80 overflow-y-auto">
            {results.map((r, i) => (
              <li key={`${r.kind}-${r.label}-${i}`}>
                <button
                  onClick={() => activate(i)}
                  onMouseEnter={() => setCursor(i)}
                  className={`w-full text-left px-4 py-2.5 text-[13px] flex items-center justify-between ${
                    i === cursor ? "bg-[var(--color-neutral-100)]" : ""
                  }`}
                >
                  <span>{r.label}</span>
                  {r.kind === "nav" ? (
                    <span className="text-[11px] text-[var(--color-neutral-500)]">{r.href}</span>
                  ) : (
                    <span className="text-[11px] text-[var(--color-neutral-500)]">action</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="px-4 py-2 border-t border-[var(--color-neutral-200)] text-[10px] uppercase-label text-[var(--color-neutral-500)] flex justify-between">
          <span>{isActionMode ? "Action mode" : "Navigate mode"}</span>
          <span>↑↓ move · Enter open · Esc close</span>
        </div>
      </div>
    </div>
  );
}
