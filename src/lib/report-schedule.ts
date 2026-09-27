import type { SavedReportFrequency } from "@/generated/prisma";

// M13 gap 1 — schedule maths shared between the CRUD actions and the
// dispatcher cron. Frequency + hour-of-day is the whole surface: the
// enum guarantees "cadence I know how to advance", and hour is what
// admins actually configure (delivery time in the tenant's server tz).
//
// Kept as a pure function so callers can pass their own `now` in tests.

export function computeNextRunAt(
  frequency: SavedReportFrequency,
  hour: number,
  lastRunAt: Date | null,
  now: Date = new Date()
): Date | null {
  if (frequency === "NONE") return null;
  const anchor = lastRunAt ?? now;
  const next = new Date(anchor);
  next.setHours(hour, 0, 0, 0);
  // If the anchor's send-time has already passed for its calendar
  // day, roll forward. This is the common case for a brand-new
  // report (lastRunAt=null): a report created at 14:00 with
  // scheduleHour=9 fires at 09:00 tomorrow, not "in five minutes ago."
  if (next <= anchor) {
    next.setDate(next.getDate() + 1);
  }
  // Advance by the cadence relative to that anchor date.
  switch (frequency) {
    case "DAILY":
      break; // Already at "the next hour occurrence."
    case "WEEKLY":
      // Push +7 days from the anchor when computing after a real
      // send; on first save (lastRunAt=null) send the day after
      // creation, which is the natural user expectation.
      if (lastRunAt) next.setDate(next.getDate() + 6); // (already +1)
      break;
    case "MONTHLY":
      if (lastRunAt) {
        const m = next.getMonth();
        next.setMonth(m + 1);
        // Guard against Feb 30 → Mar 2 style rollovers.
        if (next.getMonth() !== ((m + 1) % 12)) next.setDate(0);
      }
      break;
  }
  return next;
}
