"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { SearchIcon } from "@/components/icons";
import { searchAdmin, type AdminSearchResult } from "@/actions/adminSearch";

// Z7.3 — tenant-scoped admin search. Debounced 200ms, dropdown of pages
// + objects (users, orgs, groups, roles, macros, canned responses).
// Cross-tenant results are impossible: searchAdmin() runs under the
// caller's RLS scope.

export function AdminSearch() {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<AdminSearchResult[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [isPending, startTransition] = useTransition();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const router = useRouter();

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    const t = setTimeout(() => {
      startTransition(async () => {
        try {
          const rows = await searchAdmin(query.trim());
          setResults(rows);
          setActiveIdx(0);
        } catch {
          setResults([]);
        }
      });
    }, 200);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      // Cmd/Ctrl+K focuses the search input from anywhere in admin.
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, Math.max(0, results.length - 1)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      const r = results[activeIdx];
      if (r) {
        setOpen(false);
        setQuery("");
        router.push(r.href);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--color-neutral-500)]" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          placeholder="Search admin…"
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          className="w-full h-8 pl-8 pr-2 rounded-lg border border-black/5 dark:border-white/10 bg-black/[0.03] dark:bg-white/[0.04] text-[12px] text-[var(--foreground)] placeholder:text-[var(--color-neutral-500)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)] transition-colors"
        />
      </div>
      {open && query.trim().length > 0 && (
        <div className="absolute left-0 right-0 top-full mt-1 z-50 rounded-lg border border-black/5 dark:border-white/10 bg-[var(--color-surface)] shadow-[0_8px_28px_-8px_rgba(0,0,0,0.2)] overflow-hidden max-h-[60vh] overflow-y-auto">
          {isPending && results.length === 0 ? (
            <div className="px-3 py-3 text-[12px] text-[var(--color-neutral-500)]">Searching…</div>
          ) : results.length === 0 ? (
            <div className="px-3 py-3 text-[12px] text-[var(--color-neutral-500)]">No matches for &quot;{query}&quot;.</div>
          ) : (
            <ul className="py-1">
              {results.map((r, i) => (
                <li key={`${r.kind}-${r.href}-${i}`}>
                  <Link
                    href={r.href}
                    onClick={() => {
                      setOpen(false);
                      setQuery("");
                    }}
                    className={`flex items-center justify-between gap-3 px-3 py-2 text-[12px] transition-colors duration-150 ${
                      i === activeIdx
                        ? "bg-[var(--color-primary)] text-white"
                        : "text-[var(--foreground)] hover:bg-black/[0.045] dark:hover:bg-white/[0.06]"
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{r.title}</div>
                      {r.subtitle && (
                        <div className={`truncate text-[11px] ${i === activeIdx ? "text-white/80" : "text-[var(--color-neutral-500)]"}`}>
                          {r.subtitle}
                        </div>
                      )}
                    </div>
                    <span
                      className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
                        i === activeIdx ? "bg-white/20 text-white" : "bg-black/[0.05] dark:bg-white/[0.08] text-[var(--color-neutral-600)]"
                      }`}
                    >
                      {r.kind}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
