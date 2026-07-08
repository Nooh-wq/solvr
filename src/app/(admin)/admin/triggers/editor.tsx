"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createTrigger, updateRule, deleteRule } from "@/actions/rules";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import {
  TRIGGER_EVENT_LABELS,
  ACTION_LABELS,
  describeAction,
  type TriggerEvent,
  type ConditionGroup,
  type RuleAction,
} from "@/lib/rule-schema";

type Row = {
  id: string;
  name: string;
  description: string | null;
  triggerEvent: TriggerEvent;
  conditions: ConditionGroup;
  actions: RuleAction[];
  active: boolean;
  lastRunAt: string | null;
};

const EVENT_OPTIONS = (Object.entries(TRIGGER_EVENT_LABELS) as [TriggerEvent, string][]).map(
  ([value, label]) => ({ value, label })
);

const EXAMPLE_CONDITIONS = JSON.stringify(
  {
    match: "all",
    conditions: [
      { field: "priority", op: "eq", value: "URGENT" },
    ],
  },
  null,
  2
);

const EXAMPLE_ACTIONS = JSON.stringify(
  [{ type: "add_tag", tag: "auto-tagged" }],
  null,
  2
);

export function TriggersEditor({ initialRows }: { initialRows: Row[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [selectedId, setSelectedId] = useState<string | null>(initialRows[0]?.id ?? null);
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [event, setEvent] = useState<TriggerEvent>("TICKET_CREATED");
  const [conditionsText, setConditionsText] = useState(EXAMPLE_CONDITIONS);
  const [actionsText, setActionsText] = useState(EXAMPLE_ACTIONS);

  const selected = initialRows.find((r) => r.id === selectedId) ?? null;

  function onCreate() {
    try {
      const conditions = JSON.parse(conditionsText);
      const actions = JSON.parse(actionsText);
      startTransition(async () => {
        try {
          await createTrigger({
            name: name.trim(),
            triggerEvent: event,
            conditions,
            actions,
            active: true,
          });
          setCreateOpen(false);
          setName("");
          toast({ title: "Trigger created", variant: "success" });
          router.refresh();
        } catch (e) {
          toast({
            title: "Couldn't create",
            description: e instanceof Error ? e.message : undefined,
            variant: "error",
          });
        }
      });
    } catch {
      toast({ title: "Invalid JSON", description: "Check the conditions/actions.", variant: "error" });
    }
  }

  function onToggle(row: Row) {
    startTransition(async () => {
      await updateRule({ id: row.id, active: !row.active });
      router.refresh();
    });
  }

  function onDelete(row: Row) {
    if (!confirm(`Delete trigger "${row.name}"?`)) return;
    startTransition(async () => {
      await deleteRule(row.id);
      toast({ title: "Deleted", variant: "success" });
      router.refresh();
    });
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-6">
      <aside className="bg-[var(--color-surface)] border border-black/5 dark:border-white/10 rounded-2xl p-3 h-fit">
        <Button onClick={() => setCreateOpen((v) => !v)} className="w-full mb-3">
          {createOpen ? "Cancel" : "+ New trigger"}
        </Button>
        {createOpen && (
          <div className="mb-3 space-y-2 border-t border-black/5 dark:border-white/10 pt-3">
            <Input placeholder="Trigger name" value={name} onChange={(e) => setName(e.target.value)} />
            <Select value={event} onChange={(e) => setEvent(e.target.value as TriggerEvent)}>
              {EVENT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
            <div>
              <label className="text-[11px] uppercase tracking-wider text-[var(--color-neutral-500)] font-semibold">
                Conditions (JSON)
              </label>
              <Textarea rows={5} value={conditionsText} onChange={(e) => setConditionsText(e.target.value)} className="font-mono text-[11px]" />
            </div>
            <div>
              <label className="text-[11px] uppercase tracking-wider text-[var(--color-neutral-500)] font-semibold">
                Actions (JSON)
              </label>
              <Textarea rows={5} value={actionsText} onChange={(e) => setActionsText(e.target.value)} className="font-mono text-[11px]" />
            </div>
            <Button onClick={onCreate} disabled={pending || !name.trim()} className="w-full">
              Save
            </Button>
          </div>
        )}
        {initialRows.length === 0 ? (
          <p className="px-3 py-2 text-[12px] text-[var(--color-neutral-500)]">No triggers yet.</p>
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
                  <span className={`h-1.5 w-1.5 rounded-full ${r.active ? "bg-green-500" : "bg-neutral-400"}`} />
                  <span className="truncate flex-1 font-medium">{r.name}</span>
                </div>
                <div className={`text-[11px] mt-0.5 ${selectedId === r.id ? "text-white/80" : "text-[var(--color-neutral-500)]"}`}>
                  {TRIGGER_EVENT_LABELS[r.triggerEvent]}
                </div>
              </button>
            ))}
          </div>
        )}
      </aside>

      <main className="bg-[var(--color-surface)] border border-black/5 dark:border-white/10 rounded-2xl p-6">
        {selected ? (
          <div className="space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-[11px] uppercase tracking-wider text-[var(--color-neutral-500)] font-semibold">
                  {TRIGGER_EVENT_LABELS[selected.triggerEvent]}
                </div>
                <h2 className="text-xl font-semibold text-[var(--foreground)] mt-1">{selected.name}</h2>
                {selected.description && (
                  <p className="mt-1 text-[13px] text-[var(--color-neutral-600)]">{selected.description}</p>
                )}
              </div>
              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => onToggle(selected)} disabled={pending}>
                  {selected.active ? "Deactivate" : "Activate"}
                </Button>
                <Button variant="danger" onClick={() => onDelete(selected)} disabled={pending}>
                  Delete
                </Button>
              </div>
            </div>

            <div>
              <h3 className="text-[13px] font-semibold text-[var(--foreground)] mb-2">Actions</h3>
              <ol className="space-y-1">
                {selected.actions.map((a, i) => (
                  <li key={i} className="text-[13px] text-[var(--color-neutral-700)]">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="text-[11px] font-mono text-[var(--color-neutral-500)]">{i + 1}.</span>
                      <span className="rounded bg-black/[0.045] dark:bg-white/[0.06] px-1.5 py-0.5 text-[11px] font-medium">
                        {ACTION_LABELS[a.type]}
                      </span>
                      <span>{describeAction(a)}</span>
                    </span>
                  </li>
                ))}
              </ol>
            </div>

            <div>
              <h3 className="text-[13px] font-semibold text-[var(--foreground)] mb-2">Conditions</h3>
              <pre className="text-[11px] font-mono bg-black/[0.03] dark:bg-white/[0.04] rounded-lg p-3 overflow-x-auto">
                {JSON.stringify(selected.conditions, null, 2)}
              </pre>
            </div>

            {selected.lastRunAt && (
              <div className="text-[11px] text-[var(--color-neutral-500)]">
                Last fired {new Date(selected.lastRunAt).toLocaleString()}
              </div>
            )}
          </div>
        ) : (
          <p className="text-[13px] text-[var(--color-neutral-500)]">Select or create a trigger.</p>
        )}
      </main>
    </div>
  );
}
