"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createMacro, updateMacro, deleteMacro } from "@/actions/macros";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import type { MacroAction } from "@/lib/macros";
import { describeAction } from "@/lib/macros";

type Row = {
  id: string;
  name: string;
  description: string | null;
  actions: MacroAction[];
  isShared: boolean;
  isOwned: boolean;
};

const STATUS_OPTIONS = [
  { value: "OPEN", label: "Open" },
  { value: "IN_PROGRESS", label: "In progress" },
  { value: "PENDING", label: "Pending" },
  { value: "RESOLVED", label: "Resolved" },
  { value: "CLOSED", label: "Closed" },
] as const;

export function MacrosEditor({
  initialRows,
  canShare,
}: {
  initialRows: Row[];
  canShare: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [selectedId, setSelectedId] = useState<string | null>(initialRows[0]?.id ?? null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createShared, setCreateShared] = useState(false);
  const [pending, startTransition] = useTransition();

  const rows = initialRows;
  const selected = rows.find((r) => r.id === selectedId) ?? null;

  function onCreate() {
    const name = createName.trim();
    if (!name) return;
    startTransition(async () => {
      try {
        const res = await createMacro({
          name,
          shared: createShared,
          actions: [{ type: "add_internal_note", body: "Change me — this is a placeholder note." }],
        });
        setCreateOpen(false);
        setCreateName("");
        setCreateShared(false);
        setSelectedId(res.id);
        toast({ title: "Macro created", variant: "success" });
        router.refresh();
      } catch (e) {
        toast({
          title: "Couldn't create",
          description: e instanceof Error ? e.message : undefined,
          variant: "error",
        });
      }
    });
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6">
      <aside className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-3 space-y-1 h-fit">
        {rows.length === 0 ? (
          <p className="px-3 py-2 text-[12px] text-[var(--color-neutral-500)]">
            No macros yet.
          </p>
        ) : (
          rows.map((r) => (
            <button
              key={r.id}
              onClick={() => setSelectedId(r.id)}
              className={`w-full text-left px-3 py-2 rounded-lg text-[13px] transition-colors cursor-pointer ${
                r.id === selectedId
                  ? "bg-[var(--color-primary)] text-white"
                  : "text-[var(--foreground)] hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
              }`}
            >
              <div className="font-medium truncate">{r.name}</div>
              <div
                className={`text-[10px] uppercase tracking-wide ${
                  r.id === selectedId ? "text-white/80" : "text-[var(--color-neutral-500)]"
                }`}
              >
                {r.isShared ? "Shared" : "Personal"} · {r.actions.length} action
                {r.actions.length === 1 ? "" : "s"}
              </div>
            </button>
          ))
        )}
        <button
          onClick={() => setCreateOpen(true)}
          className="w-full mt-2 px-3 py-2 rounded-lg text-[13px] font-medium border border-dashed border-[var(--color-neutral-400)] text-[var(--color-neutral-600)] hover:text-[var(--foreground)] hover:border-[var(--color-neutral-600)] cursor-pointer"
        >
          + New macro
        </button>
      </aside>

      <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-6 min-h-[400px]">
        {selected ? (
          <MacroEditor
            key={selected.id}
            row={selected}
            onDeleted={() => {
              setSelectedId(rows.find((r) => r.id !== selected.id)?.id ?? null);
              router.refresh();
            }}
          />
        ) : (
          <div className="text-[13px] text-[var(--color-neutral-500)]">
            Select or create a macro to edit.
          </div>
        )}
      </div>

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="New macro">
        <Input
          value={createName}
          onChange={(e) => setCreateName(e.target.value)}
          placeholder="Macro name"
          autoFocus
        />
        {canShare && (
          <label className="mt-3 flex items-start gap-2 text-[12px]">
            <input
              type="checkbox"
              checked={createShared}
              onChange={(e) => setCreateShared(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-[var(--color-primary)] cursor-pointer"
            />
            <span>
              <span className="block font-medium">Share with team</span>
              <span className="block text-[var(--color-neutral-500)]">
                Any agent can apply it; only admins can edit or delete.
              </span>
            </span>
          </label>
        )}
        <div className="flex justify-end gap-2 mt-3">
          <Button variant="secondary" onClick={() => setCreateOpen(false)}>
            Cancel
          </Button>
          <Button onClick={onCreate} disabled={pending || !createName.trim()}>
            {pending ? "Creating…" : "Create"}
          </Button>
        </div>
      </Modal>
    </div>
  );
}

function MacroEditor({ row, onDeleted }: { row: Row; onDeleted: () => void }) {
  const router = useRouter();
  const { toast } = useToast();
  const [name, setName] = useState(row.name);
  const [description, setDescription] = useState(row.description ?? "");
  const [actions, setActions] = useState<MacroAction[]>(row.actions);
  const [pending, startTransition] = useTransition();

  const canEdit = row.isOwned || row.isShared;
  const dirty =
    name !== row.name ||
    description !== (row.description ?? "") ||
    JSON.stringify(actions) !== JSON.stringify(row.actions);

  function addAction(type: MacroAction["type"]) {
    if (actions.length >= 20) return;
    if (type === "add_internal_note") {
      setActions([...actions, { type, body: "" }]);
    } else if (type === "change_status") {
      setActions([...actions, { type, status: "IN_PROGRESS" }]);
    } else {
      setActions([...actions, { type, body: "" }]);
    }
  }

  function updateAction(i: number, patch: Partial<MacroAction>) {
    setActions(actions.map((a, idx) => (idx === i ? ({ ...a, ...patch } as MacroAction) : a)));
  }

  function removeAction(i: number) {
    setActions(actions.filter((_, idx) => idx !== i));
  }

  function save() {
    startTransition(async () => {
      try {
        await updateMacro({ id: row.id, name, description, actions });
        toast({ title: "Macro saved", variant: "success" });
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

  function remove() {
    if (!confirm(`Delete "${row.name}"?`)) return;
    startTransition(async () => {
      try {
        await deleteMacro(row.id);
        toast({ title: "Deleted", variant: "success" });
        onDeleted();
      } catch (e) {
        toast({
          title: "Couldn't delete",
          description: e instanceof Error ? e.message : undefined,
          variant: "error",
        });
      }
    });
  }

  return (
    <div>
      <div className="flex items-start justify-between gap-4 mb-4">
        <div className="flex-1 min-w-0 space-y-3">
          <div>
            <label className="text-[11px] uppercase tracking-wide text-[var(--color-neutral-500)]">
              Name
            </label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={!canEdit || pending}
              className="mt-1"
            />
          </div>
          <div>
            <label className="text-[11px] uppercase tracking-wide text-[var(--color-neutral-500)]">
              Description (optional)
            </label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={!canEdit || pending}
              className="mt-1"
              placeholder="What this macro does"
            />
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0 pt-5">
          {canEdit && (
            <Button variant="secondary" onClick={remove} disabled={pending}>
              Delete
            </Button>
          )}
          <Button onClick={save} disabled={pending || !dirty || !canEdit || actions.length === 0}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>

      <label className="text-[11px] uppercase tracking-wide text-[var(--color-neutral-500)]">
        Actions
      </label>
      <div className="mt-2 space-y-3">
        {actions.map((a, i) => (
          <div
            key={i}
            className="border border-[var(--color-neutral-300)] rounded-xl p-3"
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] uppercase tracking-wide text-[var(--color-neutral-500)]">
                {i + 1}. {actionTypeLabel(a.type)}
              </span>
              <button
                type="button"
                onClick={() => removeAction(i)}
                disabled={!canEdit || pending}
                className="text-[11px] text-[var(--color-neutral-500)] hover:text-red-600 cursor-pointer disabled:cursor-not-allowed"
              >
                Remove
              </button>
            </div>
            {(a.type === "add_internal_note" || a.type === "insert_reply_template") && (
              <Textarea
                rows={3}
                value={a.body}
                onChange={(e) => updateAction(i, { body: e.target.value })}
                disabled={!canEdit || pending}
                placeholder={
                  a.type === "insert_reply_template"
                    ? "Hi {{ticket.requester.name}}, thanks for reaching out…"
                    : "Internal note body"
                }
              />
            )}
            {a.type === "change_status" && (
              <Select
                value={a.status}
                onChange={(e) => updateAction(i, { status: e.target.value as MacroAction extends { status: infer S } ? S : never })}
                disabled={!canEdit || pending}
              >
                {STATUS_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            )}
            <p className="text-[11px] text-[var(--color-neutral-500)] mt-2">
              {describeAction(a)}
            </p>
          </div>
        ))}
      </div>

      {canEdit && actions.length < 20 && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => addAction("add_internal_note")}
          >
            + Internal note
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => addAction("change_status")}
          >
            + Change status
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => addAction("insert_reply_template")}
          >
            + Insert reply template
          </Button>
        </div>
      )}
    </div>
  );
}

function actionTypeLabel(t: MacroAction["type"]): string {
  switch (t) {
    case "add_internal_note":
      return "Add internal note";
    case "change_status":
      return "Change status";
    case "insert_reply_template":
      return "Insert reply template";
  }
}
