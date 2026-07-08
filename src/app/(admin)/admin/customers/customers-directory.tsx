"use client";

// Z3.1 + Z3.6 — Customers directory + CSV import/export.
// Client-side filter/sort/paginate over the server-hydrated list.
// Uses the same visual language as the retired /admin/team page's
// TeamDirectory so this feels like the same product.

import Link from "next/link";
import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Select } from "@/components/ui/input";
import { SearchIcon } from "@/components/icons";
import { useToast } from "@/components/ui/toast";
import { exportCustomersCsv, importCustomersCsv } from "@/actions/customersImport";
import { StatusIndicator } from "../team/status-indicator";
import type { UserStatus } from "@/generated/prisma";

export type CustomerRowVM = {
  id: string;
  name: string;
  email: string;
  status: UserStatus;
  organizationName: string | null;
  tags: Array<{ id: string; name: string; color: string }>;
  ticketCount: number;
  lastActiveAt: string | null;
  csatAvg: number | null;
  csatCount: number;
  avatarUrl: string | null;
};

type StatusFilter = UserStatus | "ALL";
type SortKey = "name" | "ticketCount" | "lastActiveAt" | "csatAvg";
type SortDir = "asc" | "desc";

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: "ALL", label: "All statuses" },
  { value: "ACTIVE", label: "Active" },
  { value: "INVITED", label: "Invited" },
  { value: "PENDING", label: "Pending" },
  { value: "SUSPENDED", label: "Deactivated" },
];

const PAGE_SIZE = 25;

export function CustomersDirectory({ customers }: { customers: CustomerRowVM[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("ALL");
  const [sortKey, setSortKey] = useState<SortKey>("lastActiveAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [page, setPage] = useState(0);
  const [csvPending, startCsvTransition] = useTransition();

  function handleExport() {
    startCsvTransition(async () => {
      const result = await exportCustomersCsv();
      if (!("ok" in result) || !result.ok) {
        toast({ title: "Export failed", description: "error" in result ? result.error : "", variant: "error" });
        return;
      }
      const blob = new Blob([result.csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = result.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    });
  }

  function handleImportFile(file: File) {
    startCsvTransition(async () => {
      const csv = await file.text();
      const result = await importCustomersCsv({ csv });
      if ("ok" in result && result.ok === false) {
        toast({ title: "Import failed", description: result.error, variant: "error" });
        return;
      }
      const r = result as { succeeded: unknown[]; failed: Array<{ email: string; reason: string; row: number }> };
      const s = r.succeeded.length;
      const f = r.failed.length;
      if (f === 0) {
        toast({ title: `Imported ${s} customer${s === 1 ? "" : "s"}`, variant: "success" });
      } else {
        // Group failures by reason so a big failed import doesn't spam
        // the toast — same summarize() UX as the team bulk actions.
        const byReason = new Map<string, number>();
        for (const row of r.failed) byReason.set(row.reason, (byReason.get(row.reason) ?? 0) + 1);
        const summary = [...byReason.entries()]
          .map(([reason, n]) => (n === 1 ? reason : `${reason} (${n})`))
          .join("; ");
        toast({
          title: `Imported ${s} of ${s + f}`,
          description: `${f} skipped: ${summary}`,
          variant: s === 0 ? "error" : "success",
        });
      }
      router.refresh();
    });
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return customers.filter(
      (c) =>
        (status === "ALL" || c.status === status) &&
        (q === "" ||
          c.name.toLowerCase().includes(q) ||
          c.email.toLowerCase().includes(q) ||
          (c.organizationName?.toLowerCase() ?? "").includes(q))
    );
  }, [customers, search, status]);

  const sorted = useMemo(() => {
    const rows = [...filtered];
    rows.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "name":
          cmp = a.name.localeCompare(b.name);
          break;
        case "ticketCount":
          cmp = a.ticketCount - b.ticketCount;
          break;
        case "csatAvg": {
          // Nulls last regardless of direction — never-rated shouldn't
          // beat a real 5.0.
          const av = a.csatAvg;
          const bv = b.csatAvg;
          if (av === null && bv === null) cmp = 0;
          else if (av === null) cmp = 1;
          else if (bv === null) cmp = -1;
          else cmp = av - bv;
          break;
        }
        case "lastActiveAt": {
          const at = a.lastActiveAt ? new Date(a.lastActiveAt).getTime() : null;
          const bt = b.lastActiveAt ? new Date(b.lastActiveAt).getTime() : null;
          if (at === null && bt === null) cmp = 0;
          else if (at === null) cmp = 1;
          else if (bt === null) cmp = -1;
          else cmp = at - bt;
          break;
        }
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return rows;
  }, [filtered, sortKey, sortDir]);

  const pageStart = page * PAGE_SIZE;
  const paged = sorted.slice(pageStart, pageStart + PAGE_SIZE);
  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));

  function toggleSort(key: SortKey) {
    if (key === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir(key === "name" ? "asc" : "desc");
    }
    setPage(0);
  }

  return (
    <div>
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="relative">
          <SearchIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--color-neutral-500)] pointer-events-none" />
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
            placeholder="Search name, email, or organization…"
            className="h-9 pl-8 pr-3 text-sm border border-[var(--color-neutral-300)] rounded-lg w-80 bg-[var(--color-surface)] text-[var(--foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30"
          />
        </div>
        <Select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as StatusFilter);
            setPage(0);
          }}
          className="h-9 w-44"
        >
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
        <span className="text-[12px] text-[var(--color-neutral-500)] ml-1">
          {sorted.length} of {customers.length}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleImportFile(file);
              // Reset so re-importing the same file re-fires onChange.
              e.target.value = "";
            }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={csvPending}
            className="h-9 px-3 text-[13px] font-medium border border-[var(--color-neutral-300)] rounded-lg cursor-pointer hover:bg-[var(--color-light-gray)] disabled:opacity-50"
          >
            Import CSV
          </button>
          <button
            type="button"
            onClick={handleExport}
            disabled={csvPending}
            className="h-9 px-3 text-[13px] font-medium border border-[var(--color-neutral-300)] rounded-lg cursor-pointer hover:bg-[var(--color-light-gray)] disabled:opacity-50"
          >
            Export CSV
          </button>
        </div>
      </div>

      {sorted.length === 0 ? (
        <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-10 text-center text-sm text-[var(--color-neutral-600)]">
          No customers match these filters.
        </div>
      ) : (
        <>
          <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[12px] text-[var(--color-neutral-600)] bg-[var(--color-light-gray)]/60">
                  <Th onClick={() => toggleSort("name")} active={sortKey === "name"} dir={sortDir}>
                    Name
                  </Th>
                  <th className="px-4 py-2 font-medium">Organization</th>
                  <th className="px-4 py-2 font-medium">Tags</th>
                  <Th
                    onClick={() => toggleSort("ticketCount")}
                    active={sortKey === "ticketCount"}
                    dir={sortDir}
                  >
                    Tickets
                  </Th>
                  <Th
                    onClick={() => toggleSort("csatAvg")}
                    active={sortKey === "csatAvg"}
                    dir={sortDir}
                  >
                    CSAT
                  </Th>
                  <Th
                    onClick={() => toggleSort("lastActiveAt")}
                    active={sortKey === "lastActiveAt"}
                    dir={sortDir}
                  >
                    Last active
                  </Th>
                </tr>
              </thead>
              <tbody>
                {paged.map((c) => (
                  <tr
                    key={c.id}
                    className="border-t border-[var(--color-neutral-200)] dark:border-white/5 hover:bg-[var(--color-light-gray)]/40 transition-colors"
                  >
                    <td className="px-4 py-3">
                      <Link
                        href={`/admin/users/${c.id}`}
                        className="flex items-center gap-3 cursor-pointer group"
                      >
                        <Avatar name={c.name} url={c.avatarUrl} />
                        <div className="min-w-0">
                          <div className="text-[13px] font-medium text-[var(--foreground)] group-hover:text-[var(--color-primary)] truncate">
                            {c.name}
                          </div>
                          <div className="text-[11px] text-[var(--color-neutral-500)] flex items-center gap-1.5 truncate">
                            <StatusIndicator status={c.status} />
                            <span className="truncate">{c.email}</span>
                          </div>
                        </div>
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-[13px] text-[var(--color-neutral-700)]">
                      {c.organizationName ?? <span className="text-[var(--color-neutral-400)]">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      <TagsCell tags={c.tags} />
                    </td>
                    <td className="px-4 py-3 text-[13px] tabular-nums">{c.ticketCount}</td>
                    <td className="px-4 py-3 text-[13px] tabular-nums">
                      {c.csatAvg === null ? (
                        <span className="text-[var(--color-neutral-400)]">—</span>
                      ) : (
                        <span>
                          {c.csatAvg.toFixed(1)}
                          <span className="text-[var(--color-neutral-500)]"> · {c.csatCount}</span>
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-[13px] text-[var(--color-neutral-600)]">
                      {formatRelative(c.lastActiveAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-3 text-[12px] text-[var(--color-neutral-600)]">
              <span>
                Page {page + 1} of {totalPages}
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={page === 0}
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  className="h-8 px-3 rounded-lg border border-[var(--color-neutral-300)] disabled:opacity-40 cursor-pointer hover:bg-[var(--color-light-gray)]"
                >
                  Previous
                </button>
                <button
                  type="button"
                  disabled={page >= totalPages - 1}
                  onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                  className="h-8 px-3 rounded-lg border border-[var(--color-neutral-300)] disabled:opacity-40 cursor-pointer hover:bg-[var(--color-light-gray)]"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Th({
  children,
  onClick,
  active,
  dir,
}: {
  children: React.ReactNode;
  onClick: () => void;
  active: boolean;
  dir: SortDir;
}) {
  return (
    <th
      className="px-4 py-2 font-medium cursor-pointer select-none hover:text-[var(--foreground)]"
      onClick={onClick}
    >
      <span className="inline-flex items-center gap-1">
        {children}
        {active && <span className="text-[10px]">{dir === "asc" ? "▲" : "▼"}</span>}
      </span>
    </th>
  );
}

function TagsCell({ tags }: { tags: Array<{ id: string; name: string; color: string }> }) {
  if (tags.length === 0) return <span className="text-[var(--color-neutral-400)]">—</span>;
  const shown = tags.slice(0, 3);
  const extra = tags.length - shown.length;
  return (
    <div className="flex flex-wrap gap-1">
      {shown.map((t) => (
        <span
          key={t.id}
          className="px-1.5 py-0.5 rounded text-[10px] font-medium"
          style={{ backgroundColor: `${t.color}22`, color: t.color }}
        >
          {t.name}
        </span>
      ))}
      {extra > 0 && (
        <span className="text-[10px] text-[var(--color-neutral-500)]">+{extra}</span>
      )}
    </div>
  );
}

function Avatar({ name, url }: { name: string; url: string | null }) {
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? "")
    .join("");
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt={name} className="h-8 w-8 rounded-full object-cover" />;
  }
  return (
    <div className="h-8 w-8 rounded-full bg-[var(--color-primary)]/10 text-[var(--color-primary)] text-[11px] font-semibold flex items-center justify-center">
      {initials || "?"}
    </div>
  );
}

function formatRelative(iso: string | null): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  const delta = Date.now() - t;
  const day = 86_400_000;
  if (delta < day) return "today";
  if (delta < day * 2) return "yesterday";
  if (delta < day * 30) return `${Math.floor(delta / day)}d ago`;
  if (delta < day * 365) return `${Math.floor(delta / (day * 30))}mo ago`;
  return `${Math.floor(delta / (day * 365))}y ago`;
}
