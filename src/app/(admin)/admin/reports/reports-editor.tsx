"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  backfillTicketRollup,
  createSavedReport,
  deleteSavedReport,
  exportSavedReportCsv,
  updateSavedReport,
  type SavedReportRow,
} from "@/actions/reports";
import { createShareLink } from "@/actions/analyticsShare";
import { Input, Textarea, Select } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import type { AnalyticsFilter } from "@/lib/validation/admin";

// M13.7 — inline editor for the reports list. Each row expands to edit;
// bottom form adds new. The filter shape is a subset of AnalyticsFilter
// so an admin doesn't have to memorize every knob to build a useful
// snapshot.

type FilterEditable = {
  range: AnalyticsFilter["range"];
  channel?: string;
  priority?: string;
  categoryId?: string;
  organizationId?: string;
};

export function ReportsEditor({
  initialReports,
  categories,
  organizations,
}: {
  initialReports: SavedReportRow[];
  categories: { id: string; name: string }[];
  organizations: { id: string; name: string }[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [filters, setFilters] = useState<FilterEditable>({ range: "30d" });
  const [recipients, setRecipients] = useState("");
  const [scheduleFrequency, setScheduleFrequency] = useState<"NONE" | "DAILY" | "WEEKLY" | "MONTHLY">("NONE");
  const [scheduleHour, setScheduleHour] = useState<number>(9);
  const [pending, startTransition] = useTransition();

  function submit() {
    if (!name.trim() || pending) return;
    startTransition(async () => {
      try {
        const recipientEmails = recipients
          .split(/[\s,]+/)
          .map((s) => s.trim())
          .filter((s) => s.length > 0 && s.includes("@"));
        await createSavedReport({
          name,
          description: description.trim() || undefined,
          filters: {
            range: filters.range,
            ...(filters.channel && { channel: filters.channel as AnalyticsFilter["channel"] }),
            ...(filters.priority && { priority: filters.priority as AnalyticsFilter["priority"] }),
            ...(filters.categoryId && { categoryId: filters.categoryId }),
            ...(filters.organizationId && { organizationId: filters.organizationId }),
          },
          recipientEmails,
          scheduleFrequency,
          scheduleHour,
        });
        toast({ title: "Report saved", variant: "success" });
        setName("");
        setDescription("");
        setFilters({ range: "30d" });
        setRecipients("");
        setScheduleFrequency("NONE");
        setScheduleHour(9);
        router.refresh();
      } catch (e) {
        toast({
          title: "Couldn't save",
          description: e instanceof Error ? e.message : undefined,
          variant: "error",
        });
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-[var(--color-neutral-300)] bg-[var(--color-surface)] overflow-hidden">
        <div className="px-5 py-3 border-b border-[var(--color-neutral-200)]">
          <h2 className="text-sm font-semibold">Saved reports</h2>
          <p className="text-[11px] text-[var(--color-neutral-500)]">
            Each report bundles a filter combination. Export as CSV on
            demand; scheduled email delivery is a follow-up.
          </p>
        </div>
        {initialReports.length === 0 ? (
          <div className="px-5 py-8 text-[13px] text-[var(--color-neutral-500)] italic">
            No saved reports yet. Add one below.
          </div>
        ) : (
          <ul className="divide-y divide-[var(--color-neutral-200)]">
            {initialReports.map((r) => (
              <ReportRow key={r.id} report={r} />
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-2xl border border-[var(--color-neutral-300)] bg-[var(--color-surface)] p-5 space-y-3">
        <h3 className="text-sm font-semibold">Add report</h3>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[12px] font-medium mb-1.5">Name</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Weekly Northwind bug watch" />
          </div>
          <div>
            <label className="block text-[12px] font-medium mb-1.5">Range</label>
            <Select
              value={filters.range}
              onChange={(e) => setFilters({ ...filters, range: e.target.value as AnalyticsFilter["range"] })}
            >
              <option value="7d">Last 7 days</option>
              <option value="30d">Last 30 days</option>
              <option value="90d">Last 90 days</option>
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="block text-[12px] font-medium mb-1.5">Channel</label>
            <Select
              value={filters.channel ?? ""}
              onChange={(e) => setFilters({ ...filters, channel: e.target.value || undefined })}
            >
              <option value="">Any</option>
              <option value="portal">Portal</option>
              <option value="chatbot">Chatbot</option>
              <option value="email">Email</option>
            </Select>
          </div>
          <div>
            <label className="block text-[12px] font-medium mb-1.5">Priority</label>
            <Select
              value={filters.priority ?? ""}
              onChange={(e) => setFilters({ ...filters, priority: e.target.value || undefined })}
            >
              <option value="">Any</option>
              <option value="LOW">Low</option>
              <option value="MEDIUM">Medium</option>
              <option value="HIGH">High</option>
              <option value="URGENT">Urgent</option>
            </Select>
          </div>
          <div>
            <label className="block text-[12px] font-medium mb-1.5">Category</label>
            <Select
              value={filters.categoryId ?? ""}
              onChange={(e) => setFilters({ ...filters, categoryId: e.target.value || undefined })}
            >
              <option value="">Any</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <div>
          <label className="block text-[12px] font-medium mb-1.5">Organization</label>
          <Select
            value={filters.organizationId ?? ""}
            onChange={(e) => setFilters({ ...filters, organizationId: e.target.value || undefined })}
          >
            <option value="">Any</option>
            {organizations.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </Select>
        </div>

        <div>
          <label className="block text-[12px] font-medium mb-1.5">Description</label>
          <Textarea
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What this snapshot tracks."
          />
        </div>

        <div>
          <label className="block text-[12px] font-medium mb-1.5">
            Email recipients{" "}
            <span className="text-[var(--color-neutral-500)] font-normal">
              (used when a schedule is set)
            </span>
          </label>
          <Input
            value={recipients}
            onChange={(e) => setRecipients(e.target.value)}
            placeholder="ops@company.com, lead@company.com"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[12px] font-medium mb-1.5">Schedule</label>
            <Select
              value={scheduleFrequency}
              onChange={(e) =>
                setScheduleFrequency(e.target.value as "NONE" | "DAILY" | "WEEKLY" | "MONTHLY")
              }
            >
              <option value="NONE">Off (on-demand only)</option>
              <option value="DAILY">Daily</option>
              <option value="WEEKLY">Weekly</option>
              <option value="MONTHLY">Monthly</option>
            </Select>
          </div>
          <div>
            <label className="block text-[12px] font-medium mb-1.5">Delivery hour (0–23)</label>
            <Input
              type="number"
              min={0}
              max={23}
              value={scheduleHour}
              onChange={(e) => setScheduleHour(parseInt(e.target.value || "9", 10))}
              disabled={scheduleFrequency === "NONE"}
            />
          </div>
        </div>

        <Button variant="primary" onClick={submit} disabled={!name.trim() || pending}>
          {pending ? "Saving…" : "Save report"}
        </Button>
      </div>
    </div>
  );
}

function ReportRow({ report }: { report: SavedReportRow }) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  function exportCsv() {
    startTransition(async () => {
      try {
        const csv = await exportSavedReportCsv({ id: report.id });
        const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${report.name.replace(/[^a-z0-9-]+/gi, "_")}.csv`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        router.refresh();
      } catch (e) {
        toast({
          title: "Export failed",
          description: e instanceof Error ? e.message : undefined,
          variant: "error",
        });
      }
    });
  }

  function remove() {
    if (!confirm(`Delete "${report.name}"?`)) return;
    startTransition(async () => {
      try {
        await deleteSavedReport({ id: report.id });
        toast({ title: "Deleted", variant: "success" });
        router.refresh();
      } catch (e) {
        toast({
          title: "Couldn't delete",
          description: e instanceof Error ? e.message : undefined,
          variant: "error",
        });
      }
    });
  }

  function shareLink() {
    startTransition(async () => {
      try {
        const { url } = await createShareLink({ filters: report.filters });
        await navigator.clipboard.writeText(url);
        toast({ title: "Share link copied", description: "Valid for 30 days.", variant: "success" });
      } catch (e) {
        toast({
          title: "Couldn't create share link",
          description: e instanceof Error ? e.message : undefined,
          variant: "error",
        });
      }
    });
  }

  const filterQs = new URLSearchParams();
  filterQs.set("range", report.filters.range);
  if (report.filters.channel) filterQs.set("channel", report.filters.channel);
  if (report.filters.priority) filterQs.set("priority", report.filters.priority);
  if (report.filters.categoryId) filterQs.set("categoryId", report.filters.categoryId);
  if (report.filters.organizationId) filterQs.set("organizationId", report.filters.organizationId);
  if (report.filters.assignedToId) filterQs.set("assignedToId", report.filters.assignedToId);

  return (
    <li className="px-5 py-3">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="text-[13px] font-medium truncate">{report.name}</div>
            {report.recipientEmails.length > 0 && (
              <span className="text-[10px] uppercase tracking-wide rounded-full border border-[var(--color-neutral-300)] text-[var(--color-neutral-600)] px-1.5 py-0.5">
                {report.recipientEmails.length} recipient{report.recipientEmails.length === 1 ? "" : "s"}
              </span>
            )}
            {report.scheduleFrequency !== "NONE" && (
              <span className="text-[10px] uppercase tracking-wide rounded-full border border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 px-1.5 py-0.5">
                {report.scheduleFrequency.toLowerCase()} @ {String(report.scheduleHour).padStart(2, "0")}:00
              </span>
            )}
          </div>
          {report.description && (
            <p className="text-[12px] text-[var(--color-neutral-600)] mt-0.5">{report.description}</p>
          )}
          <div className="text-[11px] text-[var(--color-neutral-500)] mt-1 flex flex-wrap gap-x-3">
            <span>{report.filters.range}</span>
            {report.filters.channel && <span>channel: {report.filters.channel}</span>}
            {report.filters.priority && <span>priority: {report.filters.priority}</span>}
            {report.filters.categoryId && <span>category: {report.filters.categoryId}</span>}
            {report.filters.organizationId && <span>org: {report.filters.organizationId}</span>}
            {report.nextRunAt && <span>next email: {new Date(report.nextRunAt).toLocaleString()}</span>}
            {report.lastRunAt && <span>last: {new Date(report.lastRunAt).toLocaleString()}</span>}
          </div>
        </div>
        <div className="flex gap-2 shrink-0">
          <Link
            href={`/admin/analytics?${filterQs.toString()}`}
            className="text-[12px] text-[var(--color-primary)] hover:underline self-center"
          >
            Open
          </Link>
          <Button
            variant="secondary"
            onClick={exportCsv}
            disabled={pending}
            className="text-[12px] px-2.5 py-1"
          >
            {pending ? "…" : "Export CSV"}
          </Button>
          <Button
            variant="secondary"
            onClick={shareLink}
            disabled={pending}
            className="text-[12px] px-2.5 py-1"
          >
            Share
          </Button>
          <Button
            variant="ghost"
            onClick={remove}
            disabled={pending}
            className="text-[12px] px-2.5 py-1 text-red-600"
          >
            Delete
          </Button>
        </div>
      </div>
    </li>
  );
}
