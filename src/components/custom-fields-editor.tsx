"use client";

// Z2 — Inline value editor for the ticket / user / org sidebar. Reads its
// initial state from listValuesForTarget's row shape and writes via
// upsertValue. Staff-only server-side (upsertValue is AGENT-gated); this
// component is only mounted from staff surfaces.

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Select } from "@/components/ui/input";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";
import { upsertValue, searchLookupTargets } from "@/actions/customFields";

type FieldType =
  | "TEXT"
  | "NUMBER"
  | "DATE"
  | "CHECKBOX"
  | "DROPDOWN"
  | "MULTISELECT"
  | "USER_LOOKUP"
  | "ORG_LOOKUP";

export type EditableRow = {
  definition: {
    id: string;
    key: string;
    label: string;
    type: FieldType;
    isActive: boolean;
    isRequired: boolean;
    options?: Array<{ id: string; value: string; label: string }>;
  };
  value: {
    valueText: string | null;
    valueNumber: string | null;
    valueDate: Date | null;
    valueBoolean: boolean | null;
    valueOptionId?: string | null;
    valueOptionIds?: string[];
    valueOptionLabels?: string[];
    valueLookupId?: string | null;
    valueLookupLabel?: string | null;
  } | null;
};

export function CustomFieldsEditor({
  title,
  rows,
  targetId,
  variant = "card",
}: {
  title: string;
  rows: EditableRow[];
  targetId: string;
  /** "flat" drops the card chrome — used by the ticket-detail rail
   *  where several sections share one outer card. */
  variant?: "card" | "flat";
}) {
  if (rows.length === 0) return null;
  if (variant === "flat") {
    return (
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-neutral-500)] mb-2">
          {title}
        </div>
        <div className="space-y-3">
          {rows.map((r) => (
            <EditableField key={r.definition.id} row={r} targetId={targetId} />
          ))}
        </div>
      </div>
    );
  }
  return (
    <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-4 mb-4">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-neutral-500)] mb-3">
        {title}
      </div>
      <div className="space-y-3">
        {rows.map((r) => (
          <EditableField key={r.definition.id} row={r} targetId={targetId} />
        ))}
      </div>
    </div>
  );
}

function displayValue(row: EditableRow): string {
  if (!row.value) return "—";
  switch (row.definition.type) {
    case "TEXT":
      return row.value.valueText ?? "—";
    case "NUMBER":
      return row.value.valueNumber ?? "—";
    case "DATE":
      return row.value.valueDate ? new Date(row.value.valueDate).toLocaleDateString() : "—";
    case "CHECKBOX":
      return row.value.valueBoolean === true ? "Yes" : row.value.valueBoolean === false ? "No" : "—";
    case "DROPDOWN":
    case "MULTISELECT": {
      const labels = row.value.valueOptionLabels ?? [];
      return labels.length > 0 ? labels.join(", ") : "—";
    }
    case "USER_LOOKUP":
    case "ORG_LOOKUP":
      return row.value.valueLookupId ? (row.value.valueLookupLabel ?? "(deleted)") : "—";
  }
}

function EditableField({ row, targetId }: { row: EditableRow; targetId: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();

  function save(patch: SavePatch & { fieldDefinitionId: string; targetId: string }) {
    startTransition(async () => {
      try {
        // valueDate is stored as a "YYYY-MM-DD" string client-side; the
        // action's Zod schema will transform it back to a Date. TypeScript
        // sees the post-transform shape, so cast here rather than pre-parse.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await upsertValue(patch as any);
        toast({ title: "Saved", description: row.definition.label, variant: "success" });
        setEditing(false);
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
    <div className="text-sm">
      <div className="text-[var(--color-neutral-500)] text-xs mb-1">{row.definition.label}</div>
      {editing ? (
        <ValueInput
          row={row}
          disabled={pending}
          onCancel={() => setEditing(false)}
          onSave={(patch) =>
            save({
              fieldDefinitionId: row.definition.id,
              targetId,
              ...patch,
            })
          }
        />
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="text-[var(--foreground)] hover:bg-[var(--color-neutral-100)] rounded px-1 -mx-1 text-left w-full cursor-pointer"
        >
          {displayValue(row)}
        </button>
      )}
    </div>
  );
}

type SavePatch = {
  valueText?: string | null;
  valueNumber?: number | null;
  valueDate?: string | null;
  valueBoolean?: boolean | null;
  valueOptionId?: string | null;
  valueOptionIds?: string[] | null;
  valueLookupId?: string | null;
};

function ValueInput({
  row,
  disabled,
  onSave,
  onCancel,
}: {
  row: EditableRow;
  disabled: boolean;
  onSave: (patch: SavePatch) => void;
  onCancel: () => void;
}) {
  const t = row.definition.type;

  switch (t) {
    case "TEXT":
      return (
        <InlineText
          initial={row.value?.valueText ?? ""}
          disabled={disabled}
          onSave={(v) => onSave({ valueText: v })}
          onCancel={onCancel}
        />
      );
    case "NUMBER":
      return (
        <InlineText
          initial={row.value?.valueNumber ?? ""}
          disabled={disabled}
          type="number"
          onSave={(v) => onSave({ valueNumber: v === "" ? null : Number(v) })}
          onCancel={onCancel}
        />
      );
    case "DATE":
      return (
        <InlineText
          initial={
            row.value?.valueDate
              ? new Date(row.value.valueDate).toISOString().slice(0, 10)
              : ""
          }
          disabled={disabled}
          type="date"
          onSave={(v) => onSave({ valueDate: v || null })}
          onCancel={onCancel}
        />
      );
    case "CHECKBOX":
      return (
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={disabled}
            onClick={() => onSave({ valueBoolean: true })}
            className="px-2 py-1 text-xs rounded border border-[var(--color-neutral-300)] hover:bg-[var(--color-light-gray)]"
          >
            Yes
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onSave({ valueBoolean: false })}
            className="px-2 py-1 text-xs rounded border border-[var(--color-neutral-300)] hover:bg-[var(--color-light-gray)]"
          >
            No
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="text-xs text-[var(--color-neutral-500)] hover:underline ml-auto"
          >
            Cancel
          </button>
        </div>
      );
    case "DROPDOWN": {
      const opts = row.definition.options ?? [];
      return (
        <div className="flex items-center gap-2">
          <Select
            defaultValue={row.value?.valueOptionId ?? ""}
            onChange={(e) => onSave({ valueOptionId: e.target.value || null })}
            disabled={disabled}
            className="flex-1 h-8 min-w-0"
          >
            <option value="">Select…</option>
            {opts.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </Select>
          <button
            type="button"
            onClick={onCancel}
            className="text-xs text-[var(--color-neutral-500)] hover:underline"
          >
            Cancel
          </button>
        </div>
      );
    }
    case "MULTISELECT": {
      const opts = row.definition.options ?? [];
      const initial = new Set(row.value?.valueOptionIds ?? []);
      return (
        <MultiselectInput
          opts={opts}
          initial={initial}
          disabled={disabled}
          onSave={(ids) => onSave({ valueOptionIds: ids })}
          onCancel={onCancel}
        />
      );
    }
    case "USER_LOOKUP":
    case "ORG_LOOKUP":
      return (
        <LookupInput
          scope={t === "USER_LOOKUP" ? "USER" : "ORG"}
          initialLabel={row.value?.valueLookupLabel ?? ""}
          disabled={disabled}
          onSave={(id) => onSave({ valueLookupId: id })}
          onCancel={onCancel}
        />
      );
  }
}

function InlineText({
  initial,
  disabled,
  type = "text",
  onSave,
  onCancel,
}: {
  initial: string;
  disabled: boolean;
  type?: string;
  onSave: (v: string) => void;
  onCancel: () => void;
}) {
  const [val, setVal] = useState(initial);
  return (
    <div className="flex items-center gap-2">
      <input
        autoFocus
        type={type}
        value={val}
        disabled={disabled}
        onChange={(e) => setVal(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onSave(val);
          if (e.key === "Escape") onCancel();
        }}
        onBlur={() => onSave(val)}
        className="flex-1 h-8 rounded border border-[var(--color-neutral-300)] bg-[var(--color-surface)] px-2 text-sm"
      />
    </div>
  );
}

function MultiselectInput({
  opts,
  initial,
  disabled,
  onSave,
  onCancel,
}: {
  opts: Array<{ id: string; label: string }>;
  initial: Set<string>;
  disabled: boolean;
  onSave: (ids: string[]) => void;
  onCancel: () => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set(initial));
  return (
    <div>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {opts.map((o) => {
          const on = selected.has(o.id);
          return (
            <button
              type="button"
              key={o.id}
              disabled={disabled}
              onClick={() => {
                const next = new Set(selected);
                if (on) next.delete(o.id);
                else next.add(o.id);
                setSelected(next);
              }}
              className={`px-2 py-0.5 rounded-full text-[11px] font-medium border transition-colors cursor-pointer ${
                on
                  ? "bg-[var(--color-primary)] text-white border-[var(--color-primary)]"
                  : "bg-[var(--color-surface)] border-[var(--color-neutral-300)] hover:bg-[var(--color-light-gray)]"
              }`}
            >
              {o.label}
            </button>
          );
        })}
      </div>
      <div className="flex gap-2 text-xs">
        <button
          type="button"
          onClick={() => onSave([...selected])}
          disabled={disabled}
          className="text-[var(--color-primary)] hover:underline"
        >
          Save
        </button>
        <button type="button" onClick={onCancel} className="text-[var(--color-neutral-500)] hover:underline">
          Cancel
        </button>
      </div>
    </div>
  );
}

function LookupInput({
  scope,
  initialLabel,
  disabled,
  onSave,
  onCancel,
}: {
  scope: "USER" | "ORG";
  initialLabel: string;
  disabled: boolean;
  onSave: (id: string | null) => void;
  onCancel: () => void;
}) {
  const [query, setQuery] = useState(initialLabel);
  const [results, setResults] = useState<Array<{ id: string; label: string; sublabel?: string }>>([]);
  const [loading, setLoading] = useState(false);
  const timer = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setLoading(true);
      searchLookupTargets(scope, query)
        .then(setResults)
        .finally(() => setLoading(false));
    }, 200);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [query, scope]);

  return (
    <div className="space-y-1">
      <input
        autoFocus
        value={query}
        disabled={disabled}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && onCancel()}
        placeholder={scope === "USER" ? "Search users…" : "Search organizations…"}
        className="w-full h-8 rounded border border-[var(--color-neutral-300)] bg-[var(--color-surface)] px-2 text-sm"
      />
      <div className="max-h-40 overflow-auto rounded border border-[var(--color-neutral-200)]">
        {loading ? (
          <div className="text-xs text-[var(--color-neutral-500)] p-2">Searching…</div>
        ) : results.length === 0 ? (
          <div className="text-xs text-[var(--color-neutral-500)] p-2">No matches.</div>
        ) : (
          results.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => onSave(r.id)}
              className="block w-full text-left px-2 py-1.5 text-sm hover:bg-[var(--color-light-gray)] cursor-pointer"
            >
              <div>{r.label}</div>
              {r.sublabel ? (
                <div className="text-[11px] text-[var(--color-neutral-500)]">{r.sublabel}</div>
              ) : null}
            </button>
          ))
        )}
      </div>
      <div className="flex justify-between text-xs">
        <button
          type="button"
          onClick={() => onSave(null)}
          className="text-[var(--color-neutral-500)] hover:underline"
        >
          Clear
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="text-[var(--color-neutral-500)] hover:underline"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
