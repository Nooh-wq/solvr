"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Prisma } from "@/generated/prisma";
import {
  createEscalationPath,
  updateEscalationPath,
  deleteEscalationPath,
} from "@/actions/escalations";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";

type DestKind = "TEAM" | "WEBHOOK" | "EMAIL" | "INTEGRATION";

type Row = {
  id: string;
  label: string;
  icon: string | null;
  categoryIds: string[];
  destKind: DestKind;
  destConfig: Prisma.JsonValue;
  active: boolean;
};

const DEST_LABELS: Record<DestKind, string> = {
  TEAM: "Assign to team group",
  WEBHOOK: "Call webhook",
  EMAIL: "Send email",
  INTEGRATION: "Marketplace integration (coming soon)",
};

const EXAMPLE_CONFIGS: Record<DestKind, string> = {
  TEAM: JSON.stringify({ groupId: "REPLACE_WITH_GROUP_ID", alsoSetPriority: "URGENT" }, null, 2),
  WEBHOOK: JSON.stringify({ url: "https://example.com/hooks/escalation", secret: "shared-secret" }, null, 2),
  EMAIL: JSON.stringify({ toEmails: ["ops@example.com"], subject: "Escalation" }, null, 2),
  INTEGRATION: JSON.stringify({ kind: "jira" }, null, 2),
};

export function EscalationPathsEditor({ initialRows }: { initialRows: Row[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [selectedId, setSelectedId] = useState<string | null>(initialRows[0]?.id ?? null);
  const [createOpen, setCreateOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [destKind, setDestKind] = useState<DestKind>("TEAM");
  const [categoryIdsText, setCategoryIdsText] = useState("");
  const [configText, setConfigText] = useState(EXAMPLE_CONFIGS.TEAM);

  const selected = initialRows.find((r) => r.id === selectedId) ?? null;

  function onCreate() {
    if (destKind === "INTEGRATION") {
      toast({ title: "Not available", description: "Marketplace hasn't shipped yet.", variant: "error" });
      return;
    }
    try {
      const destConfig = JSON.parse(configText);
      const categoryIds = categoryIdsText
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      startTransition(async () => {
        try {
          await createEscalationPath({
            label: label.trim(),
            categoryIds,
            destKind,
            destConfig,
            active: true,
          });
          setCreateOpen(false);
          setLabel("");
          setCategoryIdsText("");
          toast({ title: "Escalation path created", variant: "success" });
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
      toast({ title: "Invalid JSON in destination config", variant: "error" });
    }
  }

  function onToggle(row: Row) {
    startTransition(async () => {
      await updateEscalationPath({ id: row.id, active: !row.active });
      router.refresh();
    });
  }

  function onDelete(row: Row) {
    if (!confirm(`Delete escalation path "${row.label}"?`)) return;
    startTransition(async () => {
      await deleteEscalationPath(row.id);
      toast({ title: "Deleted", variant: "success" });
      router.refresh();
    });
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-6">
      <aside className="bg-[var(--color-surface)] border border-black/5 dark:border-white/10 rounded-2xl p-3 h-fit">
        <Button onClick={() => setCreateOpen((v) => !v)} className="w-full mb-3">
          {createOpen ? "Cancel" : "+ New path"}
        </Button>
        {createOpen && (
          <div className="mb-3 space-y-2 border-t border-black/5 dark:border-white/10 pt-3">
            <Input placeholder="Button label (e.g. Escalate to Dev)" value={label} onChange={(e) => setLabel(e.target.value)} />
            <Select
              value={destKind}
              onChange={(e) => {
                const k = e.target.value as DestKind;
                setDestKind(k);
                setConfigText(EXAMPLE_CONFIGS[k]);
              }}
            >
              {(Object.keys(DEST_LABELS) as DestKind[]).map((k) => (
                <option key={k} value={k} disabled={k === "INTEGRATION"}>
                  {DEST_LABELS[k]}
                </option>
              ))}
            </Select>
            <div>
              <label className="text-[11px] uppercase tracking-wider text-[var(--color-neutral-500)] font-semibold">
                Category IDs (comma-separated, empty = all)
              </label>
              <Input value={categoryIdsText} onChange={(e) => setCategoryIdsText(e.target.value)} placeholder="cat_abc, cat_def" />
            </div>
            <div>
              <label className="text-[11px] uppercase tracking-wider text-[var(--color-neutral-500)] font-semibold">
                Destination config (JSON)
              </label>
              <Textarea rows={5} value={configText} onChange={(e) => setConfigText(e.target.value)} className="font-mono text-[11px]" />
            </div>
            <Button onClick={onCreate} disabled={pending || !label.trim()} className="w-full">
              Save
            </Button>
          </div>
        )}
        {initialRows.length === 0 ? (
          <p className="px-3 py-2 text-[12px] text-[var(--color-neutral-500)]">No escalation paths yet.</p>
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
                  <span className="truncate flex-1 font-medium">{r.label}</span>
                </div>
                <div className={`text-[11px] mt-0.5 ${selectedId === r.id ? "text-white/80" : "text-[var(--color-neutral-500)]"}`}>
                  {DEST_LABELS[r.destKind]}
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
                  {DEST_LABELS[selected.destKind]}
                </div>
                <h2 className="text-xl font-semibold text-[var(--foreground)] mt-1">{selected.label}</h2>
                <p className="mt-1 text-[13px] text-[var(--color-neutral-600)]">
                  Visible on{" "}
                  {selected.categoryIds.length === 0
                    ? "all tickets"
                    : `tickets in ${selected.categoryIds.length} categor${selected.categoryIds.length === 1 ? "y" : "ies"}`}
                  .
                </p>
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
              <h3 className="text-[13px] font-semibold text-[var(--foreground)] mb-2">Destination config</h3>
              <pre className="text-[11px] font-mono bg-black/[0.03] dark:bg-white/[0.04] rounded-lg p-3 overflow-x-auto">
                {JSON.stringify(selected.destConfig, null, 2)}
              </pre>
            </div>
          </div>
        ) : (
          <p className="text-[13px] text-[var(--color-neutral-500)]">Select or create an escalation path.</p>
        )}
      </main>
    </div>
  );
}
