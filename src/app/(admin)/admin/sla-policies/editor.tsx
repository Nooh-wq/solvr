"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createSlaPolicy, updateSlaPolicy, deleteSlaPolicy } from "@/actions/sla";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { DEFAULT_SLA_TARGETS, type SlaTargets } from "@/lib/sla-schema";

type Priority = "URGENT" | "HIGH" | "MEDIUM" | "LOW";
const PRIORITIES: Priority[] = ["URGENT", "HIGH", "MEDIUM", "LOW"];

type Row = {
  id: string;
  name: string;
  description: string | null;
  targets: SlaTargets;
  isDefault: boolean;
  active: boolean;
};

function TargetGrid({
  targets,
  onChange,
  disabled,
}: {
  targets: SlaTargets;
  onChange: (next: SlaTargets) => void;
  disabled?: boolean;
}) {
  return (
    <div className="rounded-xl border border-black/5 dark:border-white/10 overflow-hidden">
      <table className="w-full text-[12px]">
        <thead className="bg-black/[0.03] dark:bg-white/[0.04]">
          <tr>
            <th className="text-left px-3 py-2 font-medium text-[var(--color-neutral-600)]">Priority</th>
            <th className="text-left px-3 py-2 font-medium text-[var(--color-neutral-600)]">First response (min)</th>
            <th className="text-left px-3 py-2 font-medium text-[var(--color-neutral-600)]">Resolution (min)</th>
          </tr>
        </thead>
        <tbody>
          {PRIORITIES.map((p) => {
            const row = targets[p];
            const setField = (key: "firstResponseMins" | "resolutionMins", v: number | null) =>
              onChange({ ...targets, [p]: { ...row, [key]: v } });
            return (
              <tr key={p} className="border-t border-black/5 dark:border-white/10">
                <td className="px-3 py-2 font-medium">{p}</td>
                <td className="px-3 py-2">
                  <Input
                    type="number"
                    min={0}
                    disabled={disabled}
                    value={row.firstResponseMins ?? ""}
                    onChange={(e) =>
                      setField("firstResponseMins", e.target.value === "" ? null : Number(e.target.value))
                    }
                    placeholder="—"
                    className="w-28"
                  />
                </td>
                <td className="px-3 py-2">
                  <Input
                    type="number"
                    min={0}
                    disabled={disabled}
                    value={row.resolutionMins ?? ""}
                    onChange={(e) =>
                      setField("resolutionMins", e.target.value === "" ? null : Number(e.target.value))
                    }
                    placeholder="—"
                    className="w-28"
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

export function SlaPoliciesEditor({ initialRows }: { initialRows: Row[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [selectedId, setSelectedId] = useState<string | null>(initialRows[0]?.id ?? null);
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [targets, setTargets] = useState<SlaTargets>(DEFAULT_SLA_TARGETS);
  const [makeDefault, setMakeDefault] = useState(initialRows.length === 0);

  const selected = initialRows.find((r) => r.id === selectedId) ?? null;

  function onCreate() {
    startTransition(async () => {
      try {
        await createSlaPolicy({ name: name.trim(), targets, isDefault: makeDefault, active: true });
        setCreateOpen(false);
        setName("");
        setTargets(DEFAULT_SLA_TARGETS);
        toast({ title: "SLA policy created", variant: "success" });
        router.refresh();
      } catch (e) {
        toast({ title: "Couldn't create", description: e instanceof Error ? e.message : undefined, variant: "error" });
      }
    });
  }

  function onSaveTargets(row: Row, next: SlaTargets) {
    startTransition(async () => {
      try {
        await updateSlaPolicy({ id: row.id, targets: next });
        toast({ title: "Saved", variant: "success" });
        router.refresh();
      } catch (e) {
        toast({ title: "Couldn't save", description: e instanceof Error ? e.message : undefined, variant: "error" });
      }
    });
  }

  function onSetDefault(row: Row) {
    startTransition(async () => {
      await updateSlaPolicy({ id: row.id, isDefault: true });
      toast({ title: "Default updated", variant: "success" });
      router.refresh();
    });
  }

  function onToggleActive(row: Row) {
    startTransition(async () => {
      await updateSlaPolicy({ id: row.id, active: !row.active });
      router.refresh();
    });
  }

  function onDelete(row: Row) {
    if (!confirm(`Delete policy "${row.name}"?`)) return;
    startTransition(async () => {
      try {
        await deleteSlaPolicy(row.id);
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
          {createOpen ? "Cancel" : "+ New policy"}
        </Button>
        {createOpen && (
          <div className="space-y-2 mb-3 border-t border-black/5 dark:border-white/10 pt-3">
            <Input placeholder="Policy name" value={name} onChange={(e) => setName(e.target.value)} />
            <TargetGrid targets={targets} onChange={setTargets} />
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
          <p className="px-3 py-2 text-[12px] text-[var(--color-neutral-500)]">No SLA policies yet.</p>
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
                  {r.isDefault && <span className={`text-[10px] ${selectedId === r.id ? "text-white/80" : "text-[var(--color-primary)]"}`}>DEFAULT</span>}
                </div>
              </button>
            ))}
          </div>
        )}
      </aside>

      <main className="bg-[var(--color-surface)] border border-black/5 dark:border-white/10 rounded-2xl p-6">
        {selected ? (
          <div className="space-y-5">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-xl font-semibold text-[var(--foreground)]">{selected.name}</h2>
                {selected.description && (
                  <p className="mt-1 text-[13px] text-[var(--color-neutral-600)]">{selected.description}</p>
                )}
              </div>
              <div className="flex gap-2">
                {!selected.isDefault && (
                  <Button variant="secondary" onClick={() => onSetDefault(selected)} disabled={pending}>
                    Set as default
                  </Button>
                )}
                <Button variant="secondary" onClick={() => onToggleActive(selected)} disabled={pending}>
                  {selected.active ? "Deactivate" : "Activate"}
                </Button>
                <Button variant="danger" onClick={() => onDelete(selected)} disabled={pending}>
                  Delete
                </Button>
              </div>
            </div>

            <div>
              <h3 className="text-[13px] font-semibold text-[var(--foreground)] mb-2">Targets</h3>
              <TargetGrid
                targets={selected.targets}
                disabled={pending}
                onChange={(next) => onSaveTargets(selected, next)}
              />
              <p className="mt-2 text-[11px] text-[var(--color-neutral-500)]">
                Empty cell = no SLA for that priority/kind. Rows are only written to
                tickets when a target is set.
              </p>
            </div>
          </div>
        ) : (
          <p className="text-[13px] text-[var(--color-neutral-500)]">Select or create an SLA policy.</p>
        )}
      </main>
    </div>
  );
}
