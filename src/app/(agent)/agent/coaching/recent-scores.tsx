"use client";

import Link from "next/link";
import type { QaScoreDto } from "@/actions/qaScores";

export function RecentScores({ items }: { items: QaScoreDto[] }) {
  if (items.length === 0) {
    return (
      <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-8 text-center text-sm text-[var(--color-neutral-600)]">
        No scored replies yet.
      </div>
    );
  }
  return (
    <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-[var(--color-light-gray)] text-[11px] uppercase-label text-[var(--color-neutral-700)]">
          <tr>
            <th className="text-left font-semibold px-4 py-2.5">When</th>
            <th className="text-left font-semibold px-4 py-2.5">Ticket</th>
            <th className="text-left font-semibold px-4 py-2.5">Overall</th>
            <th className="text-left font-semibold px-4 py-2.5">Flags</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it) => (
            <tr key={it.id} className="border-t border-[var(--color-neutral-100)]">
              <td className="px-4 py-3 text-[var(--color-neutral-700)]">
                {new Date(it.createdAt).toLocaleString()}
              </td>
              <td className="px-4 py-3">
                {it.ticketReference ? (
                  <Link
                    href={`/agent/tickets/${it.ticketId}`}
                    className="text-[var(--color-primary)] hover:underline"
                  >
                    {it.ticketReference}
                  </Link>
                ) : (
                  "—"
                )}
              </td>
              <td className="px-4 py-3 font-semibold">{it.overall.toFixed(2)} / 5</td>
              <td className="px-4 py-3 text-[12px] text-[var(--color-neutral-700)]">
                {it.flaggedReasons.length ? (
                  <span className="text-amber-700">{it.flaggedReasons.join(", ")}</span>
                ) : (
                  "—"
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
