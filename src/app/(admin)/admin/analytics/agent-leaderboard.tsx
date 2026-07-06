"use client";

import { useState } from "react";

type Row = {
  agentId: string;
  agentName: string;
  handledCount: number;
  avgResolutionHours: number | null;
  avgCsatRating: number | null;
};
type SortKey = "handledCount" | "avgResolutionHours" | "avgCsatRating";

function SortableHeader({
  label,
  sk,
  active,
  onSelect,
}: {
  label: string;
  sk: SortKey;
  active: boolean;
  onSelect: (sk: SortKey) => void;
}) {
  return (
    <th
      onClick={() => onSelect(sk)}
      className="text-left font-semibold px-4 py-2.5 cursor-pointer select-none hover:text-[var(--foreground)]"
    >
      {label}
      {active && <span className="ml-1 text-[var(--color-neutral-400)]">▾</span>}
    </th>
  );
}

export function AgentLeaderboard({ rows }: { rows: Row[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("handledCount");

  if (rows.length === 0) {
    return <p className="text-[13px] text-[var(--color-neutral-500)]">No assigned tickets in this range.</p>;
  }

  const sorted = [...rows].sort((a, b) => {
    if (sortKey === "handledCount") return b.handledCount - a.handledCount;
    if (sortKey === "avgResolutionHours") return (a.avgResolutionHours ?? Infinity) - (b.avgResolutionHours ?? Infinity);
    return (b.avgCsatRating ?? -Infinity) - (a.avgCsatRating ?? -Infinity);
  });

  return (
    <div className="border border-[var(--color-neutral-300)] rounded-2xl overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-[var(--color-light-gray)] text-[11px] uppercase-label text-[var(--color-neutral-700)]">
            <tr>
              <th className="text-left font-semibold px-4 py-2.5">Agent</th>
              <SortableHeader label="Handled" sk="handledCount" active={sortKey === "handledCount"} onSelect={setSortKey} />
              <SortableHeader
                label="Avg resolution"
                sk="avgResolutionHours"
                active={sortKey === "avgResolutionHours"}
                onSelect={setSortKey}
              />
              <SortableHeader label="CSAT" sk="avgCsatRating" active={sortKey === "avgCsatRating"} onSelect={setSortKey} />
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.agentId} className="border-t border-black/5 dark:border-white/10">
                <td className="px-4 py-3 whitespace-nowrap">{r.agentName}</td>
                <td className="px-4 py-3 font-mono tabular-nums">{r.handledCount}</td>
                <td className="px-4 py-3 font-mono tabular-nums">
                  {r.avgResolutionHours !== null ? `${r.avgResolutionHours.toFixed(1)}h` : "—"}
                </td>
                <td className="px-4 py-3 font-mono tabular-nums">
                  {r.avgCsatRating !== null ? `${r.avgCsatRating.toFixed(1)}/5` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
