"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  adminCreateTag,
  adminDeleteTag,
  adminMergeTags,
  adminUpdateTag,
  type AdminTagRow,
} from "@/actions/adminTags";

const DEFAULT_COLORS = [
  "#7A7A7A",
  "#E11D48",
  "#F97316",
  "#F59E0B",
  "#10B981",
  "#0EA5E9",
  "#6366F1",
  "#8B5CF6",
  "#EC4899",
];

export function TagsEditor({ initialTags }: { initialTags: AdminTagRow[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(DEFAULT_COLORS[0]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState<string>(DEFAULT_COLORS[0]);
  const [mergeMode, setMergeMode] = useState(false);
  const [selectedForMerge, setSelectedForMerge] = useState<Set<string>>(new Set());
  const [mergeTarget, setMergeTarget] = useState<string>("");

  function refresh() {
    router.refresh();
  }

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setError(null);
    start(async () => {
      const res = await adminCreateTag({ name: newName.trim(), color: newColor });
      if (!res.ok) {
        setError(res.error);
      } else {
        setNewName("");
        refresh();
      }
    });
  }

  function handleSave(id: string) {
    setError(null);
    start(async () => {
      const res = await adminUpdateTag({ id, name: editName.trim(), color: editColor });
      if (!res.ok) {
        setError(res.error);
      } else {
        setEditingId(null);
        refresh();
      }
    });
  }

  function handleDelete(tag: AdminTagRow) {
    if (
      !confirm(
        tag.usage > 0
          ? `Delete "${tag.name}"? It's assigned to ${tag.usage} record(s). Assignments will be removed.`
          : `Delete "${tag.name}"?`
      )
    )
      return;
    setError(null);
    start(async () => {
      const res = await adminDeleteTag(tag.id);
      if (!res.ok) {
        setError(res.error);
      } else {
        refresh();
      }
    });
  }

  function toggleMergeSelect(id: string) {
    const next = new Set(selectedForMerge);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedForMerge(next);
  }

  function handleMerge() {
    if (!mergeTarget || selectedForMerge.size === 0) return;
    const sources = Array.from(selectedForMerge).filter((id) => id !== mergeTarget);
    if (sources.length === 0) return;
    if (!confirm(`Merge ${sources.length} tag(s) into the target? This cannot be undone.`)) return;
    setError(null);
    start(async () => {
      const res = await adminMergeTags({ sourceIds: sources, targetId: mergeTarget });
      if (!res.ok) {
        setError(res.error);
      } else {
        setMergeMode(false);
        setSelectedForMerge(new Set());
        setMergeTarget("");
        refresh();
      }
    });
  }

  return (
    <div className="space-y-6">
      {error ? (
        <div className="p-3 rounded-lg bg-[var(--color-danger)]/10 text-[var(--color-danger)] text-[13px]">
          {error}
        </div>
      ) : null}

      <form
        onSubmit={handleCreate}
        className="p-4 bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl flex flex-wrap items-end gap-3"
      >
        <div className="flex-1 min-w-[220px]">
          <label className="text-[11px] uppercase-label text-[var(--color-neutral-600)]">New tag</label>
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="e.g. billing"
            className="mt-1 w-full px-3 py-2 rounded-lg border border-[var(--color-neutral-300)] bg-transparent text-[13px]"
            maxLength={48}
          />
        </div>
        <div>
          <label className="text-[11px] uppercase-label text-[var(--color-neutral-600)]">Color</label>
          <div className="mt-1 flex gap-1">
            {DEFAULT_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setNewColor(c)}
                aria-label={c}
                className={`w-6 h-6 rounded-full cursor-pointer border-2 ${
                  newColor === c ? "border-[var(--color-neutral-900)]" : "border-transparent"
                }`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        </div>
        <button
          type="submit"
          disabled={pending || !newName.trim()}
          className="text-[12px] font-medium px-4 py-2 rounded-lg bg-[var(--color-primary)] text-[var(--color-on-primary)] disabled:opacity-50 cursor-pointer"
        >
          Create tag
        </button>
      </form>

      <div className="flex items-center justify-between">
        <div className="text-[13px] text-[var(--color-neutral-600)]">
          {initialTags.length} tag{initialTags.length === 1 ? "" : "s"}
        </div>
        <button
          type="button"
          onClick={() => {
            setMergeMode(!mergeMode);
            setSelectedForMerge(new Set());
            setMergeTarget("");
          }}
          className="text-[12px] font-medium px-3 py-1.5 rounded-lg border border-[var(--color-neutral-300)] hover:bg-[var(--color-neutral-100)] cursor-pointer"
        >
          {mergeMode ? "Cancel merge" : "Merge duplicates"}
        </button>
      </div>

      {mergeMode ? (
        <div className="p-3 rounded-lg bg-[var(--color-neutral-100)] text-[13px] flex items-center gap-3">
          <span>Tick sources, then pick a target to merge into.</span>
          <select
            value={mergeTarget}
            onChange={(e) => setMergeTarget(e.target.value)}
            className="px-2 py-1 rounded border border-[var(--color-neutral-300)] bg-transparent text-[12px]"
          >
            <option value="">Choose target…</option>
            {initialTags.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={pending || !mergeTarget || selectedForMerge.size === 0}
            onClick={handleMerge}
            className="text-[12px] font-medium px-3 py-1.5 rounded-lg bg-[var(--color-primary)] text-[var(--color-on-primary)] disabled:opacity-50 cursor-pointer"
          >
            Merge {selectedForMerge.size}
          </button>
        </div>
      ) : null}

      {initialTags.length === 0 ? (
        <div className="p-10 text-center text-[13px] text-[var(--color-neutral-600)] bg-[var(--color-surface)] border border-dashed border-[var(--color-neutral-300)] rounded-2xl">
          No tags yet. Create your first tag above.
        </div>
      ) : (
        <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-[var(--color-light-gray)] text-[11px] uppercase-label text-[var(--color-neutral-700)]">
              <tr>
                {mergeMode ? <th className="w-8"></th> : null}
                <th className="text-left font-semibold px-4 py-2.5">Tag</th>
                <th className="text-left font-semibold px-4 py-2.5">Usage</th>
                <th className="text-left font-semibold px-4 py-2.5">Breakdown</th>
                <th className="text-right font-semibold px-4 py-2.5">Actions</th>
              </tr>
            </thead>
            <tbody>
              {initialTags.map((tag) => {
                const isEditing = editingId === tag.id;
                return (
                  <tr key={tag.id} className="border-t border-[var(--color-neutral-100)]">
                    {mergeMode ? (
                      <td className="px-2 py-3 text-center">
                        <input
                          type="checkbox"
                          checked={selectedForMerge.has(tag.id)}
                          onChange={() => toggleMergeSelect(tag.id)}
                          disabled={tag.id === mergeTarget}
                        />
                      </td>
                    ) : null}
                    <td className="px-4 py-3">
                      {isEditing ? (
                        <div className="flex items-center gap-2">
                          <input
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            className="px-2 py-1 rounded border border-[var(--color-neutral-300)] bg-transparent text-[13px]"
                          />
                          <div className="flex gap-1">
                            {DEFAULT_COLORS.map((c) => (
                              <button
                                key={c}
                                type="button"
                                onClick={() => setEditColor(c)}
                                aria-label={c}
                                className={`w-5 h-5 rounded-full cursor-pointer border-2 ${
                                  editColor === c ? "border-[var(--color-neutral-900)]" : "border-transparent"
                                }`}
                                style={{ backgroundColor: c }}
                              />
                            ))}
                          </div>
                        </div>
                      ) : (
                        <span
                          className="inline-flex items-center gap-2 px-2.5 py-0.5 rounded-full text-[12px] font-medium"
                          style={{ backgroundColor: tag.color + "22", color: tag.color }}
                        >
                          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: tag.color }} />
                          {tag.name}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-[12px]">{tag.usage}</td>
                    <td className="px-4 py-3 text-[11px] text-[var(--color-neutral-600)]">
                      {Object.entries(tag.usageByType)
                        .filter(([, n]) => n > 0)
                        .map(([k, n]) => `${k.toLowerCase().replace("_", " ")}: ${n}`)
                        .join(" · ") || "—"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {isEditing ? (
                        <div className="inline-flex gap-2">
                          <button
                            type="button"
                            disabled={pending}
                            onClick={() => handleSave(tag.id)}
                            className="text-[12px] font-medium px-3 py-1.5 rounded-lg bg-[var(--color-primary)] text-[var(--color-on-primary)] cursor-pointer disabled:opacity-50"
                          >
                            Save
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingId(null)}
                            className="text-[12px] font-medium px-3 py-1.5 rounded-lg border border-[var(--color-neutral-300)] cursor-pointer"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <div className="inline-flex gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setEditingId(tag.id);
                              setEditName(tag.name);
                              setEditColor(tag.color);
                            }}
                            className="text-[12px] font-medium px-3 py-1.5 rounded-lg border border-[var(--color-neutral-300)] hover:bg-[var(--color-neutral-100)] cursor-pointer"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            disabled={pending}
                            onClick={() => handleDelete(tag)}
                            className="text-[12px] font-medium px-3 py-1.5 rounded-lg border border-[var(--color-danger)] text-[var(--color-danger)] hover:bg-[var(--color-danger)]/10 cursor-pointer disabled:opacity-50"
                          >
                            Delete
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
