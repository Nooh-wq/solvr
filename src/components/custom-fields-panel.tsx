// Read-only render of custom-field values on ticket/user/org detail
// sidebars. Data is pre-fetched server-side via listValuesForTarget and
// passed in as a plain array so this can be a server component itself.
// A definition with no value renders as "—"; inactive definitions render
// only if they still hold a value (historical data).

type FieldType =
  | "TEXT"
  | "NUMBER"
  | "DATE"
  | "CHECKBOX"
  | "DROPDOWN"
  | "MULTISELECT"
  | "USER_LOOKUP"
  | "ORG_LOOKUP";

export type CustomFieldRow = {
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
    case "DROPDOWN":
    case "MULTISELECT": {
      const labels = row.value.valueOptionLabels ?? [];
      return labels.length > 0 ? labels.join(", ") : "—";
    }
    case "USER_LOOKUP":
    case "ORG_LOOKUP":
      // When the wrapper entity has been deleted since the value was written,
      // valueLookupLabel is null — fall back to a lightweight "deleted"
      // marker rather than leaking a raw id.
      return row.value.valueLookupId
        ? (row.value.valueLookupLabel ?? "(deleted)")
        : "—";
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
