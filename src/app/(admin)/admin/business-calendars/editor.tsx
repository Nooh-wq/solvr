"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createBusinessCalendar,
  updateBusinessCalendar,
  deleteBusinessCalendar,
} from "@/actions/sla";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { DEFAULT_WEEKLY_HOURS, type WeeklyHours } from "@/lib/sla-schema";

const DAYS: Array<{ key: keyof WeeklyHours; label: string }> = [
  { key: "mon", label: "Monday" },
  { key: "tue", label: "Tuesday" },
  { key: "wed", label: "Wednesday" },
  { key: "thu", label: "Thursday" },
  { key: "fri", label: "Friday" },
  { key: "sat", label: "Saturday" },
  { key: "sun", label: "Sunday" },
];

type Row = {
  id: string;
  name: string;
  timezone: string;
  weeklyHours: WeeklyHours;
  holidays: string[];
  isDefault: boolean;
};

/** Simple per-day open/close editor. One time range per day is enough for the vast majority of tenants; the schema allows multiple. */
function WeeklyHoursEditor({
  hours,
  onChange,
}: {
  hours: WeeklyHours;
  onChange: (next: WeeklyHours) => void;
}) {
  return (
    <div className="rounded-xl border border-black/5 dark:border-white/10 overflow-hidden">
      <table className="w-full text-[12px]">
        <thead className="bg-black/[0.03] dark:bg-white/[0.04]">
          <tr>
            <th className="text-left px-3 py-2 font-medium text-[var(--color-neutral-600)]">Day</th>
            <th className="text-left px-3 py-2 font-medium text-[var(--color-neutral-600)]">Open</th>
            <th className="text-left px-3 py-2 font-medium text-[var(--color-neutral-600)]">Close</th>
            <th className="text-left px-3 py-2 font-medium text-[var(--color-neutral-600)]">Closed?</th>
          </tr>
        </thead>
        <tbody>
          {DAYS.map(({ key, label }) => {
            const ranges = hours[key] ?? [];
            const first = ranges[0] ?? ["09:00", "17:00"];
            const closed = ranges.length === 0;
            const setDay = (open: string | null, close: string | null, close_?: boolean) => {
              if (close_) {
                onChange({ ...hours, [key]: [] });
              } else {
                onChange({ ...hours, [key]: [[open ?? first[0], close ?? first[1]]] });
              }
            };
            return (
              <tr key={key} className="border-t border-black/5 dark:border-white/10">
                <td className="px-3 py-2 font-medium">{label}</td>
                <td className="px-3 py-2">
                  <Input
                    type="time"
                    value={first[0]}
                    disabled={closed}
                    onChange={(e) => setDay(e.target.value, first[1])}
                    className="w-24"
                  />
                </td>
                <td className="px-3 py-2">
                  <Input
                    type="time"
                    value={first[1]}
                    disabled={closed}
                    onChange={(e) => setDay(first[0], e.target.value)}
                    className="w-24"
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    type="checkbox"
                    checked={closed}
                    onChange={(e) => setDay(null, null, e.target.checked)}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function BusinessCalendarsEditor({ initialRows }: { initialRows: Row[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [selectedId, setSelectedId] = useState<string | null>(initialRows[0]?.id ?? null);
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [timezone, setTimezone] = useState("UTC");
  const [hours, setHours] = useState<WeeklyHours>(DEFAULT_WEEKLY_HOURS);
  const [makeDefault, setMakeDefault] = useState(initialRows.length === 0);

  const selected = initialRows.find((r) => r.id === selectedId) ?? null;

  function onCreate() {
    startTransition(async () => {
      try {
        await createBusinessCalendar({
          name: name.trim(),
          timezone,
          weeklyHours: hours,
          holidays: [],
          isDefault: makeDefault,
        });
        setCreateOpen(false);
        setName("");
        setTimezone("UTC");
        setHours(DEFAULT_WEEKLY_HOURS);
        toast({ title: "Calendar created", variant: "success" });
        router.refresh();
      } catch (e) {
        toast({ title: "Couldn't create", description: e instanceof Error ? e.message : undefined, variant: "error" });
      }
    });
  }

  function onSaveHours(row: Row, next: WeeklyHours) {
    startTransition(async () => {
      await updateBusinessCalendar({ id: row.id, weeklyHours: next });
      toast({ title: "Saved", variant: "success" });
      router.refresh();
    });
  }

  function onRenameOrTz(row: Row, next: { name?: string; timezone?: string }) {
    startTransition(async () => {
      await updateBusinessCalendar({ id: row.id, ...next });
      router.refresh();
    });
  }

  function onSetDefault(row: Row) {
    startTransition(async () => {
      await updateBusinessCalendar({ id: row.id, isDefault: true });
      toast({ title: "Default updated", variant: "success" });
      router.refresh();
    });
  }

  function onDelete(row: Row) {
    if (!confirm(`Delete calendar "${row.name}"?`)) return;
    startTransition(async () => {
      try {
        await deleteBusinessCalendar(row.id);
        toast({ title: "Deleted", variant: "success" });
        router.refresh();
      } catch (e) {
        toast({ title: "Couldn't delete", description: e instanceof Error ? e.message : undefined, variant: "error" });
      }
    });
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-6">
      <aside className="bg-[var(--color-surface)] border border-black/5 dark:border-white/10 rounded-2xl p-3 h-fit">
        <Button onClick={() => setCreateOpen((v) => !v)} className="w-full mb-3">
          {createOpen ? "Cancel" : "+ New calendar"}
        </Button>
        {createOpen && (
          <div className="space-y-2 mb-3 border-t border-black/5 dark:border-white/10 pt-3">
            <Input placeholder="Calendar name" value={name} onChange={(e) => setName(e.target.value)} />
            <div>
              <label className="text-[11px] uppercase tracking-wider text-[var(--color-neutral-500)] font-semibold">Timezone (IANA)</label>
              <Input value={timezone} onChange={(e) => setTimezone(e.target.value)} placeholder="e.g. America/Los_Angeles" />
            </div>
            <WeeklyHoursEditor hours={hours} onChange={setHours} />
            <label className="flex items-center gap-2 text-[12px]">
              <input type="checkbox" checked={makeDefault} onChange={(e) => setMakeDefault(e.target.checked)} />
              Set as tenant default
            </label>
            <Button onClick={onCreate} disabled={pending || !name.trim()} className="w-full">
              Save
            </Button>
          </div>
        )}
        {initialRows.length === 0 ? (
          <p className="px-3 py-2 text-[12px] text-[var(--color-neutral-500)]">No calendars yet.</p>
        ) : (
          <div className="space-y-1">
            {initialRows.map((r) => (
              <button
                key={r.id}
                onClick={() => setSelectedId(r.id)}
                className={`w-full text-left px-3 py-2 rounded-lg text-[13px] transition-colors ${
                  selectedId === r.id
                    ? "bg-[var(--color-primary)] text-white"
                    : "hover:bg-black/[0.045] dark:hover:bg-white/[0.06]"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="truncate flex-1 font-medium">{r.name}</span>
                  {r.isDefault && <span className={`text-[10px] ${selectedId === r.id ? "text-white/80" : "text-[var(--color-primary)]"}`}>DEFAULT</span>}
                </div>
                <div className={`text-[11px] ${selectedId === r.id ? "text-white/80" : "text-[var(--color-neutral-500)]"}`}>
                  {r.timezone}
                </div>
              </button>
            ))}
          </div>
        )}
      </aside>

      <main className="bg-[var(--color-surface)] border border-black/5 dark:border-white/10 rounded-2xl p-6">
        {selected ? (
          <div className="space-y-5">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1 space-y-2">
                <Input
                  value={selected.name}
                  onChange={(e) => onRenameOrTz(selected, { name: e.target.value })}
                  className="text-xl font-semibold"
                />
                <div>
                  <label className="text-[11px] uppercase tracking-wider text-[var(--color-neutral-500)] font-semibold">Timezone (IANA)</label>
                  <Input
                    value={selected.timezone}
                    onChange={(e) => onRenameOrTz(selected, { timezone: e.target.value })}
                  />
                </div>
              </div>
              <div className="flex gap-2">
                {!selected.isDefault && (
                  <Button variant="secondary" onClick={() => onSetDefault(selected)} disabled={pending}>
                    Set as default
                  </Button>
                )}
                <Button variant="danger" onClick={() => onDelete(selected)} disabled={pending}>
                  Delete
                </Button>
              </div>
            </div>
            <div>
              <h3 className="text-[13px] font-semibold text-[var(--foreground)] mb-2">Weekly hours</h3>
              <WeeklyHoursEditor hours={selected.weeklyHours} onChange={(next) => onSaveHours(selected, next)} />
            </div>
          </div>
        ) : (
          <p className="text-[13px] text-[var(--color-neutral-500)]">Select or create a business calendar.</p>
        )}
      </main>
    </div>
  );
}
