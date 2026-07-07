// Z2.1 — Read-only render of custom-field values on ticket/user/org detail
// sidebars. Data is pre-fetched server-side via listValuesForTarget and
// passed in as a plain array so this can be a server component itself.
// A definition with no value renders as "—"; inactive definitions render
// only if they still hold a value (historical data).

type FieldType = "TEXT" | "NUMBER" | "DATE" | "CHECKBOX";

export type CustomFieldRow = {
  definition: {
    id: string;
    key: string;
    label: string;
    type: FieldType;
    isActive: boolean;
    isRequired: boolean;
  };
  value: {
    valueText: string | null;
    valueNumber: string | null;
    valueDate: Date | null;
    valueBoolean: boolean | null;
  } | null;
};

function formatValue(row: CustomFieldRow): string {
  if (!row.value) return "—";
  switch (row.definition.type) {
    case "TEXT":
      return row.value.valueText ?? "—";
    case "NUMBER":
      return row.value.valueNumber ?? "—";
    case "DATE":
      return row.value.valueDate ? row.value.valueDate.toLocaleDateString() : "—";
    case "CHECKBOX":
      return row.value.valueBoolean === true ? "Yes" : row.value.valueBoolean === false ? "No" : "—";
  }
}

export function CustomFieldsPanel({
  title = "Custom fields",
  rows,
}: {
  title?: string;
  rows: CustomFieldRow[];
}) {
  if (rows.length === 0) return null;
  return (
    <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-4 mb-4">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-neutral-500)] mb-3">
        {title}
      </div>
      <dl className="space-y-2">
        {rows.map((r) => (
          <div key={r.definition.id} className="text-sm">
            <dt className="text-[var(--color-neutral-500)] text-xs">{r.definition.label}</dt>
            <dd className="text-[var(--foreground)]">{formatValue(r)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
