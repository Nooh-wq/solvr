"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { createPrompt, deletePrompt, updatePrompt, type PromptRow } from "@/actions/promptTemplates";

type Variable = { key: string; label: string; defaultValue?: string };

const BLANK: {
  name: string;
  description: string;
  body: string;
  variables: Variable[];
} = { name: "", description: "", body: "", variables: [] };

function extractPlaceholders(body: string): string[] {
  const re = /\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g;
  const set = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) set.add(m[1]);
  return Array.from(set);
}

export function PromptsEditor({ initialPrompts }: { initialPrompts: PromptRow[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [selectedId, setSelectedId] = useState<string | null>(initialPrompts[0]?.id ?? null);
  const [draft, setDraft] = useState<typeof BLANK>(
    initialPrompts[0]
      ? {
          name: initialPrompts[0].name,
          description: initialPrompts[0].description ?? "",
          body: initialPrompts[0].body,
          variables: initialPrompts[0].variables,
        }
      : BLANK
  );
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const detectedPlaceholders = useMemo(() => extractPlaceholders(draft.body), [draft.body]);
  const missingVars = detectedPlaceholders.filter((k) => !draft.variables.find((v) => v.key === k));

  function selectPrompt(p: PromptRow | null) {
    setError(null);
    setMessage(null);
    if (!p) {
      setSelectedId(null);
      setDraft(BLANK);
      return;
    }
    setSelectedId(p.id);
    setDraft({
      name: p.name,
      description: p.description ?? "",
      body: p.body,
      variables: p.variables,
    });
  }

  function addVariable(key?: string) {
    const k = (key ?? "").trim();
    if (!k) return;
    if (draft.variables.find((v) => v.key === k)) return;
    setDraft({
      ...draft,
      variables: [...draft.variables, { key: k, label: k.replace(/_/g, " ") }],
    });
  }

  function updateVariable(i: number, patch: Partial<Variable>) {
    const next = draft.variables.slice();
    next[i] = { ...next[i], ...patch };
    setDraft({ ...draft, variables: next });
  }

  function removeVariable(i: number) {
    const next = draft.variables.slice();
    next.splice(i, 1);
    setDraft({ ...draft, variables: next });
  }

  function save() {
    setError(null);
    setMessage(null);
    start(async () => {
      const payload = {
        name: draft.name.trim(),
        description: draft.description.trim() || undefined,
        body: draft.body,
        variables: draft.variables,
      };
      const res = selectedId
        ? await updatePrompt({ id: selectedId, ...payload })
        : await createPrompt(payload);
      if (!res.ok) {
        setError(res.error);
      } else {
        setMessage("Saved.");
        router.refresh();
      }
    });
  }

  function remove() {
    if (!selectedId) return;
    if (!confirm(`Delete "${draft.name}"?`)) return;
    setError(null);
    start(async () => {
      await deletePrompt(selectedId);
      selectPrompt(null);
      router.refresh();
    });
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
      <aside className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-2 h-max">
        <button
          type="button"
          onClick={() => selectPrompt(null)}
          className={`w-full text-left px-3 py-2 rounded-lg text-[13px] font-medium cursor-pointer ${
            selectedId === null
              ? "bg-[var(--color-primary)] text-[var(--color-on-primary)]"
              : "hover:bg-[var(--color-neutral-100)]"
          }`}
        >
          + New prompt
        </button>
        <div className="mt-2 space-y-1 max-h-[500px] overflow-y-auto">
          {initialPrompts.length === 0 ? (
            <div className="p-3 text-[12px] text-[var(--color-neutral-500)] text-center">
              No prompts yet.
            </div>
          ) : (
            initialPrompts.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => selectPrompt(p)}
                className={`w-full text-left px-3 py-2 rounded-lg text-[13px] cursor-pointer ${
                  selectedId === p.id
                    ? "bg-[var(--color-neutral-100)] font-medium"
                    : "hover:bg-[var(--color-neutral-100)]"
                }`}
              >
                <div className="truncate">{p.name}</div>
                {p.description ? (
                  <div className="text-[11px] text-[var(--color-neutral-500)] truncate">
                    {p.description}
                  </div>
                ) : null}
              </button>
            ))
          )}
        </div>
      </aside>

      <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-5 space-y-4">
        {error ? (
          <div className="p-3 rounded-lg bg-[var(--color-danger)]/10 text-[var(--color-danger)] text-[13px]">
            {error}
          </div>
        ) : null}
        {message ? (
          <div className="p-3 rounded-lg bg-[var(--color-success)]/10 text-[var(--color-success)] text-[13px]">
            {message}
          </div>
        ) : null}

        <div>
          <label className="text-[11px] uppercase-label text-[var(--color-neutral-600)] block mb-1">
            Name
          </label>
          <input
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            placeholder="e.g. Empathy opener"
            className="w-full px-3 py-2 rounded-lg border border-[var(--color-neutral-300)] bg-transparent text-[13px]"
            maxLength={120}
          />
        </div>

        <div>
          <label className="text-[11px] uppercase-label text-[var(--color-neutral-600)] block mb-1">
            Description (optional)
          </label>
          <input
            value={draft.description}
            onChange={(e) => setDraft({ ...draft, description: e.target.value })}
            placeholder="What is this prompt for?"
            className="w-full px-3 py-2 rounded-lg border border-[var(--color-neutral-300)] bg-transparent text-[13px]"
            maxLength={500}
          />
        </div>

        <div>
          <label className="text-[11px] uppercase-label text-[var(--color-neutral-600)] block mb-1">
            Prompt body
          </label>
          <textarea
            value={draft.body}
            onChange={(e) => setDraft({ ...draft, body: e.target.value })}
            placeholder={`Draft a warm reply to this customer named {{customer_name}} about {{issue}}.`}
            rows={8}
            className="w-full px-3 py-2 rounded-lg border border-[var(--color-neutral-300)] bg-transparent text-[13px] font-mono"
            maxLength={4000}
          />
          <div className="text-[11px] text-[var(--color-neutral-500)] mt-1">
            Use {"{{ variable_name }}"} for values agents fill in.
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-[11px] uppercase-label text-[var(--color-neutral-600)]">
              Variables
            </label>
            {missingVars.length > 0 ? (
              <button
                type="button"
                onClick={() => missingVars.forEach(addVariable)}
                className="text-[11px] font-medium text-[var(--color-primary)] cursor-pointer"
              >
                Add {missingVars.length} detected in body
              </button>
            ) : null}
          </div>
          {draft.variables.length === 0 ? (
            <div className="p-3 rounded-lg bg-[var(--color-neutral-100)] text-[12px] text-[var(--color-neutral-600)]">
              No variables. Add {"{{ }}"} placeholders to the body first.
            </div>
          ) : (
            <div className="space-y-2">
              {draft.variables.map((v, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <code className="text-[11px] font-mono px-2 py-1 rounded bg-[var(--color-neutral-100)]">
                    {"{{"}
                    {v.key}
                    {"}}"}
                  </code>
                  <input
                    value={v.label}
                    onChange={(e) => updateVariable(i, { label: e.target.value })}
                    placeholder="Label"
                    className="px-2 py-1 rounded border border-[var(--color-neutral-300)] bg-transparent text-[12px] flex-1"
                  />
                  <input
                    value={v.defaultValue ?? ""}
                    onChange={(e) => updateVariable(i, { defaultValue: e.target.value })}
                    placeholder="Default (optional)"
                    className="px-2 py-1 rounded border border-[var(--color-neutral-300)] bg-transparent text-[12px] flex-1"
                  />
                  <button
                    type="button"
                    onClick={() => removeVariable(i)}
                    className="text-[11px] text-[var(--color-danger)] px-2 py-1 cursor-pointer"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex justify-between pt-2 border-t border-[var(--color-neutral-200)]">
          <div>
            {selectedId ? (
              <button
                type="button"
                disabled={pending}
                onClick={remove}
                className="text-[12px] font-medium px-3 py-1.5 rounded-lg border border-[var(--color-danger)] text-[var(--color-danger)] hover:bg-[var(--color-danger)]/10 cursor-pointer disabled:opacity-50"
              >
                Delete
              </button>
            ) : null}
          </div>
          <button
            type="button"
            disabled={pending || !draft.name.trim() || !draft.body.trim()}
            onClick={save}
            className="text-[12px] font-medium px-4 py-2 rounded-lg bg-[var(--color-primary)] text-[var(--color-on-primary)] disabled:opacity-50 cursor-pointer"
          >
            {selectedId ? "Save changes" : "Create prompt"}
          </button>
        </div>
      </div>
    </div>
  );
}
