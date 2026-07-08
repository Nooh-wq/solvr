"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { StatusBadge, PriorityLabel } from "@/components/ui/badge";
import { SlaBadge } from "@/components/sla-badge";
import { SearchIcon } from "@/components/icons";
import { Select, Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { createView, deleteView, setDefaultView, updateView } from "@/actions/views";
import type { TicketStatus, Priority } from "@/generated/prisma";

// Z6.1 — Views workspace. Left rail lists the agent's saved views;
// selecting one navigates to /agent?view=<id> so a bookmark keeps
// working, the URL is copy-shareable, and the server re-runs the
// filter authoritatively. The right side is the same queue table
// as before with instant client-side filtering on top of whatever
// the server prefiltered.

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
  // M2.3 — SLA rows for this ticket. Empty array = graceful degrade
  // (no badge rendered). One entry per active TicketSla row.
  sla?: import("@/components/sla-badge").TicketSlaLite[];
};

type ViewFilters = {
  status?: TicketStatus;
  priority?: Priority;
  categoryId?: string;
  assignedToId?: string;
  search?: string;
};

type ViewSort = { key: "updatedAt" | "createdAt" | "priority"; dir: "asc" | "desc" };

type ViewRow = {
  id: string;
  name: string;
  isDefault: boolean;
  isShared: boolean;
  count: number;
  filters: ViewFilters;
  sort: ViewSort;
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

const ASSIGNEE_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "All assignees" },
  { value: "me", label: "Me" },
  { value: "unassigned", label: "Unassigned" },
];

export function QueueWorkspace({
  views,
  activeViewId,
  tickets,
  openCount,
  unassignedCount,
  canShareViews,
}: {
  views: ViewRow[];
  activeViewId: string | null;
  tickets: QueueTicket[];
  openCount: number;
  unassignedCount: number;
  /** Z6.5 — only admins can create shared views (permission catalog wiring to follow). */
  canShareViews: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const activeView = views.find((v) => v.id === activeViewId) ?? null;

  // Client-side filters seed from the active view's filters when one is
  // selected; otherwise start empty (the "All tickets" fallback surface).
  const [status, setStatus] = useState<TicketStatus | "ALL">(
    activeView?.filters.status ?? "ALL"
  );
  const [priority, setPriority] = useState<Priority | "ALL">(
    activeView?.filters.priority ?? "ALL"
  );
  const [assignee, setAssignee] = useState<string>(
    activeView?.filters.assignedToId ?? ""
  );
  const [search, setSearch] = useState<string>(activeView?.filters.search ?? "");

  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [saveShared, setSaveShared] = useState(false);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tickets.filter(
      (t) =>
        (status === "ALL" || t.status === status) &&
        (priority === "ALL" || t.priority === priority) &&
        (assignee === "" ||
          (assignee === "unassigned" ? t.assigneeName === null : true)) &&
        (q === "" ||
          t.title.toLowerCase().includes(q) ||
          t.clientName.toLowerCase().includes(q) ||
          t.reference.toLowerCase().includes(q))
    );
  }, [tickets, status, priority, assignee, search]);

  function selectView(id: string | null) {
    const href = id ? `/agent?view=${encodeURIComponent(id)}` : "/agent";
    router.push(href);
  }

  function currentFilters(): ViewFilters {
    return {
      status: status === "ALL" ? undefined : status,
      priority: priority === "ALL" ? undefined : priority,
      assignedToId: assignee === "" ? undefined : assignee,
      search: search.trim() === "" ? undefined : search.trim(),
    };
  }

  function onSave() {
    const name = saveName.trim();
    if (!name) return;
    startTransition(async () => {
      try {
        const res = await createView({
          name,
          filters: currentFilters(),
          sort: { key: "updatedAt", dir: "desc" },
          shared: saveShared,
        });
        setSaveOpen(false);
        setSaveName("");
        setSaveShared(false);
        toast({ title: `Saved view "${name}"`, variant: "success" });
        router.push(`/agent?view=${res.id}`);
      } catch (e) {
        toast({
          title: "Couldn't save view",
          description: e instanceof Error ? e.message : undefined,
          variant: "error",
        });
      }
    });
  }

  function onUpdateFilters() {
    if (!activeView) return;
    startTransition(async () => {
      try {
        await updateView({ id: activeView.id, filters: currentFilters() });
        toast({ title: "View updated", variant: "success" });
        router.refresh();
      } catch (e) {
        toast({
          title: "Couldn't update view",
          description: e instanceof Error ? e.message : undefined,
          variant: "error",
        });
      }
    });
  }

  function onDelete(id: string, name: string) {
    if (!confirm(`Delete view "${name}"?`)) return;
    startTransition(async () => {
      try {
        await deleteView(id);
        toast({ title: `Deleted "${name}"`, variant: "success" });
        if (activeViewId === id) router.push("/agent");
        else router.refresh();
      } catch (e) {
        toast({
          title: "Couldn't delete view",
          description: e instanceof Error ? e.message : undefined,
          variant: "error",
        });
      }
    });
  }

  function onPin(id: string) {
    startTransition(async () => {
      try {
        await setDefaultView(id);
        toast({ title: "Set as default view", variant: "success" });
        router.refresh();
      } catch (e) {
        toast({
          title: "Couldn't pin view",
          description: e instanceof Error ? e.message : undefined,
          variant: "error",
        });
      }
    });
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-6">
      {/* Views rail */}
      <aside className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-3 space-y-1 h-fit">
        <div className="px-2 pt-1 pb-2 text-[11px] uppercase tracking-wide text-[var(--color-neutral-500)]">
          Views
        </div>
        <button
          onClick={() => selectView(null)}
          className={`w-full text-left px-3 py-2 rounded-lg text-[13px] transition-colors cursor-pointer ${
            activeViewId === null
              ? "bg-[var(--color-primary)] text-white"
              : "text-[var(--foreground)] hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
          }`}
        >
          All tickets
        </button>
        {views.map((v) => {
          const isActive = v.id === activeViewId;
          return (
            <div key={v.id} className="group relative">
              <button
                onClick={() => selectView(v.id)}
                className={`w-full text-left pl-3 pr-16 py-2 rounded-lg text-[13px] transition-colors cursor-pointer flex items-center gap-2 group-hover:pr-20 ${
                  isActive
                    ? "bg-[var(--color-primary)] text-white"
                    : "text-[var(--foreground)] hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
                }`}
              >
                <span className="truncate flex-1 min-w-0">{v.name}</span>
                <span
                  className={`text-[11px] font-mono shrink-0 ${
                    isActive ? "text-white/80" : "text-[var(--color-neutral-500)]"
                  }`}
                >
                  {v.count}
                </span>
                {v.isShared && (
                  <span
                    className={`text-[9px] uppercase tracking-wide font-semibold shrink-0 px-1 py-px rounded ${
                      isActive
                        ? "bg-white/25 text-white"
                        : "bg-[var(--color-neutral-100)] dark:bg-white/[0.08] text-[var(--color-neutral-500)]"
                    }`}
                    title="Shared view"
                  >
                    Shared
                  </span>
                )}
                {v.isDefault && (
                  <span
                    className={`text-[11px] shrink-0 ${
                      isActive ? "text-white/80" : "text-[var(--color-neutral-500)]"
                    }`}
                    title="Default view"
                  >
                    ★
                  </span>
                )}
              </button>
              {/* Row actions overlay — absolutely positioned so they never
                  add width, and revealed on group hover. Solid bg keeps
                  them readable when they cover a truncated name. */}
              <div className="pointer-events-none absolute inset-y-0 right-1 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 group-hover:pointer-events-auto transition-opacity">
                <button
                  onClick={(e) => { e.stopPropagation(); onPin(v.id); }}
                  disabled={v.isDefault || pending}
                  title={v.isDefault ? "Already default" : "Set as default"}
                  className={`h-7 w-7 flex items-center justify-center rounded-md text-[15px] leading-none disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer ${
                    isActive
                      ? "text-white/80 hover:bg-white/15"
                      : "text-[var(--color-neutral-500)] hover:text-[var(--foreground)] hover:bg-black/[0.06] dark:hover:bg-white/[0.08]"
                  }`}
                >
                  ★
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); onDelete(v.id, v.name); }}
                  disabled={pending}
                  title="Delete view"
                  className={`h-7 w-7 flex items-center justify-center rounded-md text-[16px] leading-none cursor-pointer ${
                    isActive
                      ? "text-white/80 hover:bg-white/15"
                      : "text-[var(--color-neutral-500)] hover:text-red-600 hover:bg-red-500/10"
                  }`}
                >
                  ×
                </button>
              </div>
            </div>
          );
        })}
        <button
          onClick={() => setSaveOpen(true)}
          className="w-full mt-2 px-3 py-2 rounded-lg text-[13px] font-medium border border-dashed border-[var(--color-neutral-400)] text-[var(--color-neutral-600)] hover:text-[var(--foreground)] hover:border-[var(--color-neutral-600)] cursor-pointer"
        >
          + Save current filters
        </button>
      </aside>

      {/* Main queue */}
      <div>
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-baseline gap-3 min-w-0">
            <h1 className="text-2xl font-bold truncate">
              {activeView ? activeView.name : "All tickets"}
            </h1>
            {activeView?.isDefault && (
              <span className="text-[11px] text-[var(--color-neutral-500)]">Default</span>
            )}
          </div>
          <div className="flex gap-4 text-[13px] text-[var(--color-neutral-600)]">
            <span>
              <strong className="text-[var(--foreground)]">{openCount}</strong> open
            </span>
            <span>
              <strong className="text-[var(--foreground)]">{unassignedCount}</strong> unassigned
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 mb-5">
          <div className="relative">
            <SearchIcon className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-neutral-400)]" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search title, client, ref…"
              className="h-9 pl-9 pr-3 text-sm border border-[var(--color-neutral-300)] rounded-xl w-64 bg-[var(--color-surface)] text-[var(--foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30"
            />
          </div>
          <Select
            value={status}
            onChange={(e) => setStatus(e.target.value as TicketStatus | "ALL")}
            className="h-9 w-40"
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
          <Select
            value={priority}
            onChange={(e) => setPriority(e.target.value as Priority | "ALL")}
            className="h-9 w-40"
          >
            {PRIORITY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
          <Select
            value={assignee}
            onChange={(e) => setAssignee(e.target.value)}
            className="h-9 w-40"
          >
            {ASSIGNEE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
          {activeView && (
            <Button
              variant="secondary"
              size="sm"
              onClick={onUpdateFilters}
              disabled={pending}
            >
              Save changes to view
            </Button>
          )}
          <span className="text-[12px] text-[var(--color-neutral-500)] ml-1">
            {filtered.length} of {tickets.length}
          </span>
        </div>

        <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl overflow-hidden">
          {filtered.length === 0 ? (
            <p className="p-8 text-center text-sm text-[var(--color-neutral-600)]">
              No tickets match these filters.
            </p>
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
                    <tr
                      key={t.id}
                      className="border-t border-[var(--color-neutral-100)] hover:bg-[var(--color-light-gray)]"
                    >
                      <td className="px-4 py-3">
                        <Link
                          href={`/agent/tickets/${t.id}`}
                          className="font-mono text-[12px] text-[var(--color-primary)]"
                        >
                          {t.reference}
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <Link href={`/agent/tickets/${t.id}`}>{t.title}</Link>
                      </td>
                      <td className="px-4 py-3 text-[var(--color-neutral-600)]">
                        {t.clientName}
                      </td>
                      <td className="px-4 py-3 text-[var(--color-neutral-600)]">
                        {t.categoryName ?? "—"}
                      </td>
                      <td className="px-4 py-3">
                        <PriorityLabel priority={t.priority} />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <StatusBadge status={t.status} />
                          {t.sla && t.sla.length > 0 && <SlaBadge rows={t.sla} />}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-[var(--color-neutral-600)]">
                        {t.assigneeName ?? "Unassigned"}
                      </td>
                      <td className="px-4 py-3 text-[var(--color-neutral-600)]">
                        {new Date(t.updatedAt).toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <Modal
        open={saveOpen}
        onClose={() => setSaveOpen(false)}
        title="Save as view"
      >
        <Input
          value={saveName}
          onChange={(e) => setSaveName(e.target.value)}
          placeholder="e.g. My open tickets"
          autoFocus
        />
        {canShareViews && (
          <label className="mt-3 flex items-start gap-2 text-[12px]">
            <input
              type="checkbox"
              checked={saveShared}
              onChange={(e) => setSaveShared(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-[var(--color-primary)] cursor-pointer"
            />
            <span>
              <span className="block font-medium">Share with team</span>
              <span className="block text-[var(--color-neutral-500)]">
                All agents on this tenant can select it; only admins can edit or delete.
              </span>
            </span>
          </label>
        )}
        {!canShareViews && (
          <p className="text-[11px] text-[var(--color-neutral-500)] mt-3">
            Personal views are visible only to you.
          </p>
        )}
        <div className="flex justify-end gap-2 mt-3">
          <Button variant="secondary" onClick={() => setSaveOpen(false)}>
            Cancel
          </Button>
          <Button onClick={onSave} disabled={pending || !saveName.trim()}>
            {pending ? "Saving…" : "Save view"}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
