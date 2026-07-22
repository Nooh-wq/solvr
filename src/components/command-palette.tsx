"use client";

// M-admin — Command palette (Cmd/Ctrl + K).
//
// Modes:
//   navigate (default): fuzzy-match label + keywords across ADMIN_PAGE_CATALOG
//     plus a live server search across teammates, customers, orgs,
//     groups, roles, macros, canned responses (Phase 4g).
//   action (prefix `>`): quick actions that navigate to a page/modal
//
// Recent (empty input): last 5 visited admin pages from the same
// localStorage key the sidebar uses (Z7.2), so palette + sidebar
// agree on "recently viewed".

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ADMIN_PAGE_CATALOG, type AdminPageEntry } from "@/lib/admin-nav-catalog";
import { searchAdmin, type AdminSearchResult } from "@/actions/adminSearch";

const RECENT_KEY = "solvr:admin-recently-viewed";
const SEARCH_DEBOUNCE_MS = 220;

type ActionEntry = { id: string; label: string; run: (router: ReturnType<typeof useRouter>) => void };

const ACTIONS: ActionEntry[] = [
  { id: "invite-user", label: "Invite team member", run: (r) => r.push("/admin/team-members?invite=1") },
  { id: "create-field", label: "Create custom field", run: (r) => r.push("/admin/fields?new=1") },
  { id: "create-trigger", label: "Create trigger", run: (r) => r.push("/admin/triggers?new=1") },
  { id: "new-report", label: "New report", run: (r) => r.push("/admin/reports?new=1") },
  { id: "install-app", label: "Install app", run: (r) => r.push("/admin/apps/marketplace") },
  { id: "new-tag", label: "Create tag", run: (r) => r.push("/admin/objects/tags") },
  { id: "new-prompt", label: "Create AI prompt", run: (r) => r.push("/admin/ai/prompts") },
  { id: "system-health", label: "Open system health", run: (r) => r.push("/admin/super/health") },
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
  const [liveResults, setLiveResults] = useState<AdminSearchResult[]>([]);
  const [searching, setSearching] = useState(false);

  // Opening resets the palette state. Lives in the event handler (not an
  // effect) so no setState happens synchronously inside an effect body.
  const openPalette = useCallback(() => {
    setQ("");
    setCursor(0);
    setLiveResults([]);
    setSearching(false);
    try {
      const raw = localStorage.getItem(RECENT_KEY);
      setRecent(raw ? JSON.parse(raw) : []);
    } catch {
      /* ignore */
    }
    setOpen(true);
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (open) setOpen(false);
        else openPalette();
      } else if (e.key === "Escape" && open) {
        setOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, openPalette]);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [open]);

  const isActionMode = q.startsWith(">");
  const trimmed = isActionMode ? q.slice(1).trim() : q.trim();

  // Debounced live server search. Only fires in navigate mode with
  // non-trivial input to keep round-trips low. The synchronous state
  // transitions (clearing results, flipping the "searching" flag) happen
  // in the input's onChange handler — this effect only owns the async
  // round-trip.
  useEffect(() => {
    if (isActionMode || trimmed.length < 2) return;
    let cancelled = false;
    const handle = setTimeout(async () => {
      try {
        const res = await searchAdmin(trimmed);
        if (!cancelled) {
          // Strip out page-kind results — they're already in the catalog
          // match below, and duplication would confuse the arrow-key
          // cursor.
          setLiveResults(res.filter((r) => r.kind !== "page"));
        }
      } catch {
        if (!cancelled) setLiveResults([]);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [trimmed, isActionMode]);

  type Row =
    | { kind: "nav"; label: string; href: string; subtitle?: string }
    | { kind: "action"; label: string; action: ActionEntry }
    | { kind: "live"; label: string; href: string; subtitle?: string; badge: string };

  const results = useMemo<Row[]>(() => {
    if (!trimmed && !isActionMode) {
      return recent.map((r) => ({ kind: "nav" as const, label: r.label, href: r.href }));
    }
    if (isActionMode) {
      const filter = trimmed.toLowerCase();
      return ACTIONS.filter((a) => a.label.toLowerCase().includes(filter))
        .slice(0, 10)
        .map<Row>((a) => ({ kind: "action", label: a.label, action: a }));
    }
    const pageMatches = ADMIN_PAGE_CATALOG.map((e) => ({ e, s: score(e, trimmed) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 6)
      .map<Row>((x) => ({ kind: "nav", label: x.e.label, href: x.e.href, subtitle: x.e.href }));

    const live: Row[] = liveResults.slice(0, 12).map((r) => ({
      kind: "live",
      label: r.title,
      href: r.href,
      subtitle: r.subtitle,
      badge: r.kind,
    }));
    return [...pageMatches, ...live];
  }, [trimmed, isActionMode, recent, liveResults]);

  const activate = useCallback(
    (index: number) => {
      const r = results[index];
      if (!r) return;
      setOpen(false);
      if (r.kind === "action") {
        r.action.run(router);
      } else {
        router.push(r.href);
      }
    },
    [results, router]
  );

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center pt-24 bg-black/40"
      onClick={() => setOpen(false)}
    >
      <div
        role="dialog"
        aria-label="Command palette"
        className="w-[600px] max-w-[92vw] bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl shadow-xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => {
            const v = e.target.value;
            setQ(v);
            setCursor(0);
            const nextIsAction = v.startsWith(">");
            const nextTrimmed = (nextIsAction ? v.slice(1) : v).trim();
            if (nextIsAction || nextTrimmed.length < 2) {
              setLiveResults([]);
              setSearching(false);
            } else {
              setSearching(true);
            }
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
          placeholder={
            isActionMode
              ? "Action mode — pick a command"
              : "Search pages, people, orgs, tags — or type “>” for actions"
          }
          className="w-full px-4 py-3 text-[14px] bg-transparent outline-none border-b border-[var(--color-neutral-200)]"
        />
        {results.length === 0 ? (
          <div className="px-4 py-6 text-[12px] text-[var(--color-neutral-500)] text-center">
            {isActionMode
              ? "No matching actions"
              : trimmed
                ? searching
                  ? "Searching…"
                  : "No matches"
                : "Start typing to search"}
          </div>
        ) : (
          <ul className="max-h-96 overflow-y-auto">
            {results.map((r, i) => (
              <li key={`${r.kind}-${r.label}-${i}`}>
                <button
                  onClick={() => activate(i)}
                  onMouseEnter={() => setCursor(i)}
                  className={`w-full text-left px-4 py-2.5 text-[13px] flex items-center justify-between cursor-pointer ${
                    i === cursor ? "bg-[var(--color-neutral-100)]" : ""
                  }`}
                >
                  <span className="min-w-0 flex-1 truncate">
                    <span className="font-medium">{r.label}</span>
                    {"subtitle" in r && r.subtitle ? (
                      <span className="ml-2 text-[11px] text-[var(--color-neutral-500)]">{r.subtitle}</span>
                    ) : null}
                  </span>
                  <span className="text-[10px] uppercase-label text-[var(--color-neutral-500)] ml-2 whitespace-nowrap">
                    {r.kind === "action" ? "action" : r.kind === "live" ? r.badge : "page"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="px-4 py-2 border-t border-[var(--color-neutral-200)] text-[10px] uppercase-label text-[var(--color-neutral-500)] flex justify-between">
          <span>{isActionMode ? "Action mode" : searching ? "Searching…" : "Navigate mode"}</span>
          <span>↑↓ move · Enter open · Esc close</span>
        </div>
      </div>
    </div>
  );
}
