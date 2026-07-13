// src/lib/analytics/shared-cf-filter.ts
//
// Z10 §3 — filters custom-field data down to non-internal fields
// before it's rendered in a shared (per-org) dashboard. Pure helper:
// callers pass in the fields + values, get back only the surface-safe
// subset. Kept here (not inlined) so the "shared view drops internal
// fields" invariant has a single pinnable code path across surfaces.

export type CustomFieldForShare = {
  id: string;
  key: string;
  label: string;
  isInternal: boolean;
};

/**
 * Returns fields that may render in a shared view. isInternal=true is
 * always excluded, regardless of the value. Order preserved.
 */
export function filterFieldsForShare<T extends CustomFieldForShare>(fields: T[]): T[] {
  return fields.filter((f) => !f.isInternal);
}

/**
 * Companion to filterFieldsForShare — given a values map keyed by
 * definition id and the full list of definitions, drops values whose
 * definition is marked internal. Callers can use either the values
 * form or the fields form depending on what they hold.
 */
export function filterValuesForShare<V>(
  values: Record<string, V>,
  definitionsById: Map<string, CustomFieldForShare>
): Record<string, V> {
  const out: Record<string, V> = {};
  for (const [defId, v] of Object.entries(values)) {
    const def = definitionsById.get(defId);
    if (def && def.isInternal) continue;
    out[defId] = v;
  }
  return out;
}
