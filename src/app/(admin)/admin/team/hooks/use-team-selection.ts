"use client";

import { useCallback, useMemo, useState } from "react";

// Row-selection state for the bulk-action bar. Set-based so add/remove is
// O(1); component treats the Set as immutable and re-creates it on every
// change so React actually re-renders (React's structural comparison
// wouldn't catch a mutated in-place Set).

export function useTeamSelection(allIds: string[]) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const clear = useCallback(() => setSelected(new Set()), []);

  const allSelectableIds = useMemo(() => new Set(allIds), [allIds]);

  const allSelected = useMemo(
    () => allSelectableIds.size > 0 && [...allSelectableIds].every((id) => selected.has(id)),
    [allSelectableIds, selected]
  );

  const toggleAll = useCallback(() => {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(allSelectableIds));
    }
  }, [allSelected, allSelectableIds]);

  return { selected, toggle, toggleAll, allSelected, clear, count: selected.size };
}
