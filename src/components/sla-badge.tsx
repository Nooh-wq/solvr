"use client";

import { useEffect, useState } from "react";

// M2.3 — SLA badge for queue rows + countdown for ticket detail.
// Reads pre-computed TicketSla rows. Never renders anything when the
// input array is empty — the spec's graceful-degradation contract.
//
// Displays in the viewing agent's timezone via native Intl. If the
// tenant later exposes a per-agent tz preference we read it here; for
// now the browser's tz is fine (matches what an operator sees in
// every other system view).

export type TicketSlaLite = {
  kind: "FIRST_RESPONSE" | "RESOLUTION";
  targetMins: number;
  dueAt: string;
  pausedMs: number;
  pauseStartedAt: string | null;
  warnedAt: string | null;
  breachedAt: string | null;
  satisfiedAt: string | null;
};

type Health = "healthy" | "due-soon" | "overdue" | "paused" | "met";

function health(row: TicketSlaLite, now: number): Health {
  if (row.satisfiedAt) return "met";
  if (row.pauseStartedAt) return "paused";
  const due = new Date(row.dueAt).getTime();
  if (now >= due) return "overdue";
  const remaining = due - now;
  if (remaining <= 60 * 60 * 1000) return "due-soon"; // last hour
  return "healthy";
}

const HEALTH_STYLES: Record<Health, string> = {
  healthy: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300 border-emerald-500/30",
  "due-soon": "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/40",
  overdue: "bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/40",
  paused: "bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/30",
  met: "bg-black/[0.04] dark:bg-white/[0.06] text-[var(--color-neutral-600)] border-black/5 dark:border-white/10",
};

/** "in 2h 15m" / "45m overdue" — humanised, no library. */
function formatDelta(ms: number, overdue: boolean): string {
  const abs = Math.max(0, Math.abs(ms));
  const totalMins = Math.round(abs / 60_000);
  const days = Math.floor(totalMins / (60 * 24));
  const hours = Math.floor((totalMins % (60 * 24)) / 60);
  const mins = totalMins % 60;
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (parts.length === 0 || mins > 0) parts.push(`${mins}m`);
  const rendered = parts.join(" ");
  return overdue ? `${rendered} overdue` : `in ${rendered}`;
}

function useNow(ms = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

/**
 * Compact single-badge for queue rows. Picks the worst-health SLA row
 * on the ticket (usually FIRST_RESPONSE while pending, then RESOLUTION
 * after reply). Renders nothing if the ticket has no rows.
 */
export function SlaBadge({ rows }: { rows: TicketSlaLite[] }) {
  const now = useNow();
  if (rows.length === 0) return null;
  const ranked = [...rows].sort((a, b) => {
    const order: Record<Health, number> = { overdue: 0, "due-soon": 1, paused: 2, healthy: 3, met: 4 };
    return order[health(a, now)] - order[health(b, now)];
  });
  const primary = ranked[0];
  const h = health(primary, now);
  if (h === "met") return null; // Nothing to draw once satisfied — queue stays clean.

  const due = new Date(primary.dueAt).getTime();
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-medium ${HEALTH_STYLES[h]}`}
      title={`${primary.kind === "FIRST_RESPONSE" ? "First response" : "Resolution"} due ${new Date(primary.dueAt).toLocaleString()}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${h === "overdue" ? "bg-red-500" : h === "due-soon" ? "bg-amber-500" : h === "paused" ? "bg-blue-500" : "bg-emerald-500"}`} />
      {h === "paused" ? "Paused" : formatDelta(due - now, h === "overdue")}
    </span>
  );
}

/**
 * Ticket-detail countdown header. Renders one row per TicketSla kind
 * (FIRST_RESPONSE + RESOLUTION). Nothing when the array is empty.
 */
export function SlaCountdown({ rows }: { rows: TicketSlaLite[] }) {
  const now = useNow();
  if (rows.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 mt-1">
      {rows.map((r) => {
        const h = health(r, now);
        const due = new Date(r.dueAt).getTime();
        const label = r.kind === "FIRST_RESPONSE" ? "First response" : "Resolution";
        return (
          <span
            key={r.kind}
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium ${HEALTH_STYLES[h]}`}
            title={new Date(r.dueAt).toLocaleString()}
          >
            <span className="opacity-70">{label}</span>
            <span>·</span>
            <span className="font-semibold">
              {h === "met"
                ? "Met"
                : h === "paused"
                  ? "Paused"
                  : formatDelta(due - now, h === "overdue")}
            </span>
          </span>
        );
      })}
    </div>
  );
}
