"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { StatusBadge, PriorityLabel } from "@/components/ui/badge";
import { SearchIcon } from "@/components/icons";
import type { TicketStatus, Priority } from "@/generated/prisma";

type QueueTicket = {
  id: string;
  reference: string;
  title: string;
  clientName: string;
  categoryName: string | null;
  priority: Priority;
  status: TicketStatus;
  assigneeName: string | null;
  updatedAt: string;
};

const STATUS_OPTIONS: { value: TicketStatus | "ALL"; label: string }[] = [
  { value: "ALL", label: "All statuses" },
  { value: "OPEN", label: "Open" },
  { value: "IN_PROGRESS", label: "In progress" },
  { value: "PENDING", label: "Pending" },
  { value: "RESOLVED", label: "Resolved" },
  { value: "CLOSED", label: "Closed" },
];

const PRIORITY_OPTIONS: { value: Priority | "ALL"; label: string }[] = [
  { value: "ALL", label: "All priorities" },
  { value: "LOW", label: "Low" },
  { value: "MEDIUM", label: "Medium" },
  { value: "HIGH", label: "High" },
  { value: "URGENT", label: "Urgent" },
];

/** Instant client-side filtering — no "Filter" submit button, mirrors the Team directory's filter UX. */
export function QueueDirectory({ tickets }: { tickets: QueueTicket[] }) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<TicketStatus | "ALL">("ALL");
  const [priority, setPriority] = useState<Priority | "ALL">("ALL");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tickets.filter(
      (t) =>
        (status === "ALL" || t.status === status) &&
        (priority === "ALL" || t.priority === priority) &&
        (q === "" || t.title.toLowerCase().includes(q) || t.clientName.toLowerCase().includes(q) || t.reference.toLowerCase().includes(q))
    );
  }, [tickets, search, status, priority]);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-5">
        <div className="relative">
          <SearchIcon className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-neutral-400)]" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search title or client…"
            className="h-9 pl-9 pr-3 text-sm border border-[var(--color-neutral-300)] rounded-xl w-64 bg-[var(--color-surface)] text-[var(--foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30"
          />
        </div>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as TicketStatus | "ALL")}
          className="h-9 px-2.5 text-sm border border-[var(--color-neutral-300)] rounded-xl bg-[var(--color-surface)] text-[var(--foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30"
        >
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <select
          value={priority}
          onChange={(e) => setPriority(e.target.value as Priority | "ALL")}
          className="h-9 px-2.5 text-sm border border-[var(--color-neutral-300)] rounded-xl bg-[var(--color-surface)] text-[var(--foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30"
        >
          {PRIORITY_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <span className="text-[12px] text-[var(--color-neutral-500)] ml-1">
          {filtered.length} of {tickets.length}
        </span>
      </div>

      <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl overflow-hidden">
        {filtered.length === 0 ? (
          <p className="p-8 text-center text-sm text-[var(--color-neutral-600)]">No tickets match these filters.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[var(--color-light-gray)] text-[11px] uppercase-label text-[var(--color-neutral-700)]">
                <tr>
                  <th className="text-left font-semibold px-4 py-2.5">Reference</th>
                  <th className="text-left font-semibold px-4 py-2.5">Title</th>
                  <th className="text-left font-semibold px-4 py-2.5">Client</th>
                  <th className="text-left font-semibold px-4 py-2.5">Category</th>
                  <th className="text-left font-semibold px-4 py-2.5">Priority</th>
                  <th className="text-left font-semibold px-4 py-2.5">Status</th>
                  <th className="text-left font-semibold px-4 py-2.5">Assignee</th>
                  <th className="text-left font-semibold px-4 py-2.5">Updated</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((t) => (
                  <tr key={t.id} className="border-t border-[var(--color-neutral-100)] hover:bg-[var(--color-light-gray)]">
                    <td className="px-4 py-3">
                      <Link href={`/agent/tickets/${t.id}`} className="font-mono text-[12px] text-[var(--color-primary)]">
                        {t.reference}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <Link href={`/agent/tickets/${t.id}`}>{t.title}</Link>
                    </td>
                    <td className="px-4 py-3 text-[var(--color-neutral-600)]">{t.clientName}</td>
                    <td className="px-4 py-3 text-[var(--color-neutral-600)]">{t.categoryName ?? "—"}</td>
                    <td className="px-4 py-3">
                      <PriorityLabel priority={t.priority} />
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={t.status} />
                    </td>
                    <td className="px-4 py-3 text-[var(--color-neutral-600)]">{t.assigneeName ?? "Unassigned"}</td>
                    <td className="px-4 py-3 text-[var(--color-neutral-600)]">{new Date(t.updatedAt).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
