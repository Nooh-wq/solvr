"use client";

// Z4.1 — Organizations list. Search + sort + pagination all client-side
// over a server-hydrated page, matching the Customers directory shape.

import Link from "next/link";
import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { SearchIcon, PlusIcon } from "@/components/icons";
import { useToast } from "@/components/ui/toast";
import { Modal } from "@/components/ui/modal";
import {
  createOrganizationAction,
  importOrganizationsCsv,
} from "@/actions/organizations";

export type OrgRowVM = {
  id: string;
  name: string;
  domain: string | null;
  userCount: number;
  ticketCount: number;
  openTicketCount: number;
  tags: Array<{ id: string; name: string; color: string }>;
  hasSlaPolicy: boolean;
  createdAt: string;
};

type SortKey = "name" | "userCount" | "ticketCount" | "openTicketCount";
type SortDir = "asc" | "desc";
const PAGE_SIZE = 25;

export function OrganizationsDirectory({ organizations }: { organizations: OrgRowVM[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("openTicketCount");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [page, setPage] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);
  const [csvPending, startCsvTransition] = useTransition();

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return organizations.filter(
      (o) =>
        q === "" ||
        o.name.toLowerCase().includes(q) ||
        (o.domain?.toLowerCase() ?? "").includes(q)
    );
  }, [organizations, search]);

  const sorted = useMemo(() => {
    const rows = [...filtered];
    rows.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "name": cmp = a.name.localeCompare(b.name); break;
        case "userCount": cmp = a.userCount - b.userCount; break;
        case "ticketCount": cmp = a.ticketCount - b.ticketCount; break;
        case "openTicketCount": cmp = a.openTicketCount - b.openTicketCount; break;
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

  function handleImportFile(file: File) {
    startCsvTransition(async () => {
      const csv = await file.text();
      const result = await importOrganizationsCsv({ csv });
      if ("ok" in result && result.ok === false) {
        toast({ title: "Import failed", description: result.error, variant: "error" });
        return;
      }
      const r = result as { succeeded: unknown[]; failed: Array<{ name: string; reason: string }> };
      const s = r.succeeded.length;
      const f = r.failed.length;
      if (f === 0) {
        toast({ title: `Imported ${s} organization${s === 1 ? "" : "s"}`, variant: "success" });
      } else {
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

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="relative">
          <SearchIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--color-neutral-500)] pointer-events-none" />
          <input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            placeholder="Search name or domain…"
            className="h-9 pl-8 pr-3 text-sm border border-[var(--color-neutral-300)] rounded-lg w-72 bg-[var(--color-surface)] text-[var(--foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30"
          />
        </div>
        <span className="text-[12px] text-[var(--color-neutral-500)] ml-1">
          {sorted.length} of {organizations.length}
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
            onClick={() => setCreateOpen(true)}
            className="h-9 px-3 text-[13px] font-medium bg-[var(--color-primary)] text-white rounded-lg cursor-pointer hover:opacity-90 inline-flex items-center gap-1.5"
          >
            <PlusIcon className="h-4 w-4" /> New organization
          </button>
        </div>
      </div>

      {sorted.length === 0 ? (
        <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-10 text-center text-sm text-[var(--color-neutral-600)]">
          No organizations match this search.
        </div>
      ) : (
        <>
          <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[12px] text-[var(--color-neutral-600)] bg-[var(--color-light-gray)]/60">
                  <Th onClick={() => toggleSort("name")} active={sortKey === "name"} dir={sortDir}>Name</Th>
                  <th className="px-4 py-2 font-medium">Domain</th>
                  <Th onClick={() => toggleSort("userCount")} active={sortKey === "userCount"} dir={sortDir}>Users</Th>
                  <Th onClick={() => toggleSort("ticketCount")} active={sortKey === "ticketCount"} dir={sortDir}>Tickets</Th>
                  <Th onClick={() => toggleSort("openTicketCount")} active={sortKey === "openTicketCount"} dir={sortDir}>Open</Th>
                  <th className="px-4 py-2 font-medium">Tags</th>
                  <th className="px-4 py-2 font-medium">SLA</th>
                </tr>
              </thead>
              <tbody>
                {paged.map((o) => (
                  <tr key={o.id} className="border-t border-[var(--color-neutral-200)] dark:border-white/5 hover:bg-[var(--color-light-gray)]/40 transition-colors">
                    <td className="px-4 py-3">
                      <Link href={`/admin/organizations/${o.id}`} className="text-[13px] font-medium hover:text-[var(--color-primary)]">
                        {o.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-[13px] text-[var(--color-neutral-600)]">
                      {o.domain ?? <span className="text-[var(--color-neutral-400)]">—</span>}
                    </td>
                    <td className="px-4 py-3 text-[13px] tabular-nums">{o.userCount}</td>
                    <td className="px-4 py-3 text-[13px] tabular-nums">{o.ticketCount}</td>
                    <td className="px-4 py-3 text-[13px] tabular-nums">
                      {o.openTicketCount === 0 ? (
                        <span className="text-[var(--color-neutral-500)]">0</span>
                      ) : (
                        <span className="font-medium">{o.openTicketCount}</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <TagsCell tags={o.tags} />
                    </td>
                    <td className="px-4 py-3 text-[12px]">
                      {o.hasSlaPolicy ? (
                        <span className="px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-700 dark:text-blue-300 font-medium">Custom</span>
                      ) : (
                        <span className="text-[var(--color-neutral-400)]">Default</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-3 text-[12px] text-[var(--color-neutral-600)]">
              <span>Page {page + 1} of {totalPages}</span>
              <div className="flex gap-2">
                <button type="button" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}
                  className="h-8 px-3 rounded-lg border border-[var(--color-neutral-300)] disabled:opacity-40 cursor-pointer hover:bg-[var(--color-light-gray)]">
                  Previous
                </button>
                <button type="button" disabled={page >= totalPages - 1} onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                  className="h-8 px-3 rounded-lg border border-[var(--color-neutral-300)] disabled:opacity-40 cursor-pointer hover:bg-[var(--color-light-gray)]">
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      )}

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Create organization">
        <CreateOrgForm
          onCreated={(id) => {
            setCreateOpen(false);
            router.push(`/admin/organizations/${id}`);
          }}
        />
      </Modal>
    </div>
  );
}

function CreateOrgForm({ onCreated }: { onCreated: (id: string) => void }) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [pending, startTransition] = useTransition();

  function submit() {
    if (name.trim() === "") return;
    startTransition(async () => {
      const res = await createOrganizationAction({
        name: name.trim(),
        domain: domain.trim() || null,
      });
      if ("ok" in res && res.ok) {
        onCreated(res.id);
      } else {
        toast({ title: "Couldn't create", description: "error" in res ? res.error : "", variant: "error" });
      }
    });
  }

  return (
    <div className="space-y-3">
      <div>
        <label className="text-[11px] font-semibold text-[var(--color-neutral-600)] uppercase tracking-wide">Name</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Northwind Retail"
          className="mt-1 w-full h-9 px-3 text-sm border border-[var(--color-neutral-300)] rounded-lg bg-[var(--background)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30"
        />
      </div>
      <div>
        <label className="text-[11px] font-semibold text-[var(--color-neutral-600)] uppercase tracking-wide">Domain (optional)</label>
        <input
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
          placeholder="northwind.com"
          className="mt-1 w-full h-9 px-3 text-sm border border-[var(--color-neutral-300)] rounded-lg bg-[var(--background)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30"
        />
        <p className="text-[11px] text-[var(--color-neutral-500)] mt-1">
          New users whose email matches this domain will auto-link here.
        </p>
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <button
          type="button"
          onClick={submit}
          disabled={pending || name.trim() === ""}
          className="h-9 px-4 text-[13px] font-medium bg-[var(--color-primary)] text-white rounded-lg cursor-pointer hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "Creating…" : "Create"}
        </button>
      </div>
    </div>
  );
}

function Th({ children, onClick, active, dir }: { children: React.ReactNode; onClick: () => void; active: boolean; dir: SortDir }) {
  return (
    <th className="px-4 py-2 font-medium cursor-pointer select-none hover:text-[var(--foreground)]" onClick={onClick}>
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
        <span key={t.id} className="px-1.5 py-0.5 rounded text-[10px] font-medium" style={{ backgroundColor: `${t.color}22`, color: t.color }}>
          {t.name}
        </span>
      ))}
      {extra > 0 && <span className="text-[10px] text-[var(--color-neutral-500)]">+{extra}</span>}
    </div>
  );
}
