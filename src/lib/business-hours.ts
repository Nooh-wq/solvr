import type { WeeklyHours } from "@/lib/sla-schema";

// M2.2 — business-hours walker. Pure functions, no I/O. Given a start
// instant, a target duration in minutes, and a calendar, returns the
// UTC instant that many working minutes later, skipping non-working
// hours + holidays.
//
// Spec §3: "Do NOT calculate business-hours-adjusted dueAt on-read."
// This is called ONCE at policy application time; the result is
// stored on the TicketSla row. Read paths just compare `now` to
// `dueAt`.
//
// Implementation notes:
// - Timezone math via Intl.DateTimeFormat, no external dep.
// - Walks day-by-day rather than minute-by-minute — for a 24-hour
//   Mon-Fri 9-5 target we do 3-5 iterations, not 1440*3.

const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

type WallTime = {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
};

/**
 * Return the given UTC instant's wall-clock components in the target
 * timezone. Uses Intl.DateTimeFormat with a fixed formatToParts shape
 * so we never depend on locale ordering.
 */
export function utcToWall(instant: Date, tz: string): WallTime {
  // Fast path for UTC — Intl.DateTimeFormat is unreliable across
  // ICU builds (some Windows builds shift into the system tz even
  // when `timeZone: 'UTC'` is passed, producing next-day dueAt
  // values). Using Date's UTC accessors avoids the roundtrip.
  if (tz === "UTC") {
    return {
      year: instant.getUTCFullYear(),
      month: instant.getUTCMonth() + 1,
      day: instant.getUTCDate(),
      hour: instant.getUTCHours(),
      minute: instant.getUTCMinutes(),
      second: instant.getUTCSeconds(),
    };
  }
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(instant);
  const pick = (t: string) => parseInt(parts.find((p) => p.type === t)!.value, 10);
  return {
    year: pick("year"),
    month: pick("month"),
    day: pick("day"),
    // `en-US` hour12=false returns "24" for midnight — normalize.
    hour: pick("hour") % 24,
    minute: pick("minute"),
    second: pick("second"),
  };
}

/**
 * Inverse: given wall-clock components (interpreted in `tz`), return
 * the UTC instant. Handles DST folds by picking the first valid
 * interpretation — good enough since business hours are configured
 * in whole-hour buckets and never straddle a spring-forward gap.
 */
export function wallToUtc(w: WallTime, tz: string): Date {
  // Fast path for UTC — see utcToWall's UTC fast path.
  if (tz === "UTC") {
    return new Date(Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second));
  }
  // Trick: pretend the wall time is UTC to get a first-guess instant,
  // then measure the offset by re-reading it in `tz` and correcting.
  const guess = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  const back = utcToWall(new Date(guess), tz);
  const backGuess = Date.UTC(back.year, back.month - 1, back.day, back.hour, back.minute, back.second);
  const offsetMs = guess - backGuess;
  return new Date(guess + offsetMs);
}

/** "YYYY-MM-DD" in the calendar tz — the shape holidays uses. */
function isoDate(w: WallTime): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${w.year}-${pad(w.month)}-${pad(w.day)}`;
}

function dayKey(w: WallTime, tz: string): (typeof DAY_KEYS)[number] {
  // Recreate the same instant, then read the weekday via Intl.
  const inst = wallToUtc(w, tz);
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(inst);
  const map: Record<string, (typeof DAY_KEYS)[number]> = {
    Sun: "sun",
    Mon: "mon",
    Tue: "tue",
    Wed: "wed",
    Thu: "thu",
    Fri: "fri",
    Sat: "sat",
  };
  return map[weekday] ?? "mon";
}

function parseHHMM(hhmm: string): { hour: number; minute: number } {
  const [h, m] = hhmm.split(":").map(Number);
  return { hour: h, minute: m };
}

/**
 * Given a wall-time, walk forward day-by-day until we find a working
 * minute. Returns `{ wall, remainingRanges }` — `wall` is the first
 * working instant at or after the input; `remainingRanges` is the
 * list of `[start, end]` (in minutes-of-day) still to consume for
 * that day, already trimmed to start no earlier than `wall`.
 */
function nextWorkingWindow(
  from: WallTime,
  cal: { timezone: string; weeklyHours: WeeklyHours; holidays: string[] }
): { wall: WallTime; ranges: Array<[number, number]> } | null {
  const cursor: WallTime = { ...from };
  // Cap the walk so a mis-configured empty-week calendar can't loop
  // forever. Two weeks is plenty for any realistic single-target span.
  for (let i = 0; i < 21; i++) {
    const iso = isoDate(cursor);
    if (!cal.holidays.includes(iso)) {
      const dk = dayKey(cursor, cal.timezone);
      const dayRanges = cal.weeklyHours[dk] ?? [];
      if (dayRanges.length > 0) {
        const nowMins = cursor.hour * 60 + cursor.minute;
        const trimmed: Array<[number, number]> = [];
        for (const [s, e] of dayRanges) {
          const startMins = parseHHMM(s).hour * 60 + parseHHMM(s).minute;
          const endMins = parseHHMM(e).hour * 60 + parseHHMM(e).minute;
          // Only include ranges that haven't already fully elapsed.
          if (endMins <= nowMins) continue;
          const effectiveStart = Math.max(startMins, nowMins);
          trimmed.push([effectiveStart, endMins]);
        }
        if (trimmed.length > 0) {
          const first = trimmed[0][0];
          return {
            wall: { ...cursor, hour: Math.floor(first / 60), minute: first % 60, second: 0 },
            ranges: trimmed,
          };
        }
      }
    }
    // Roll to next day 00:00 wall-time.
    const nextInst = wallToUtc({ ...cursor, hour: 23, minute: 59, second: 59 }, cal.timezone);
    const nextWall = utcToWall(new Date(nextInst.getTime() + 60_000), cal.timezone);
    cursor.year = nextWall.year;
    cursor.month = nextWall.month;
    cursor.day = nextWall.day;
    cursor.hour = 0;
    cursor.minute = 0;
    cursor.second = 0;
  }
  return null;
}

/**
 * Public entry point. Adds `targetMins` working minutes to `start`,
 * respecting the calendar. Returns the resulting UTC instant.
 *
 * Falls back to a "raw" add (start + targetMins) if the calendar has
 * no working days at all — a mis-configuration, but better than
 * silently never returning.
 */
export function computeDueAt(params: {
  start: Date;
  targetMins: number;
  calendar: {
    timezone: string;
    weeklyHours: WeeklyHours;
    holidays: string[];
  };
}): Date {
  const { start, targetMins, calendar } = params;
  if (targetMins <= 0) return start;

  let remaining = targetMins;
  let cursor = utcToWall(start, calendar.timezone);

  for (let iter = 0; iter < 60; iter++) {
    const win = nextWorkingWindow(cursor, calendar);
    if (!win) {
      // Empty calendar or 3-week gap — degrade to raw add.
      return new Date(start.getTime() + targetMins * 60_000);
    }
    cursor = win.wall;
    for (const [rangeStart, rangeEnd] of win.ranges) {
      const cursorMins = cursor.hour * 60 + cursor.minute;
      const effStart = Math.max(rangeStart, cursorMins);
      const capacity = rangeEnd - effStart;
      if (remaining <= capacity) {
        const finalMins = effStart + remaining;
        return wallToUtc(
          { ...cursor, hour: Math.floor(finalMins / 60), minute: finalMins % 60, second: 0 },
          calendar.timezone
        );
      }
      remaining -= capacity;
      cursor = { ...cursor, hour: Math.floor(rangeEnd / 60), minute: rangeEnd % 60, second: 0 };
    }
    // Advance to next day 00:00.
    const nextInst = wallToUtc({ ...cursor, hour: 23, minute: 59, second: 59 }, calendar.timezone);
    const nextWall = utcToWall(new Date(nextInst.getTime() + 60_000), calendar.timezone);
    cursor = { year: nextWall.year, month: nextWall.month, day: nextWall.day, hour: 0, minute: 0, second: 0 };
  }
  // Safety net — shouldn't hit.
  return new Date(start.getTime() + targetMins * 60_000);
}

/**
 * How many working minutes are between `start` and `end`, given the
 * calendar. Used for the running-clock badge on the queue and the
 * countdown header. Returns 0 if end <= start.
 */
export function elapsedWorkingMinutes(params: {
  start: Date;
  end: Date;
  calendar: { timezone: string; weeklyHours: WeeklyHours; holidays: string[] };
}): number {
  const { start, end, calendar } = params;
  if (end.getTime() <= start.getTime()) return 0;
  let cursor = utcToWall(start, calendar.timezone);
  const target = end.getTime();
  let acc = 0;
  for (let iter = 0; iter < 60; iter++) {
    const win = nextWorkingWindow(cursor, calendar);
    if (!win) return acc;
    cursor = win.wall;
    for (const [rangeStart, rangeEnd] of win.ranges) {
      const cursorMins = cursor.hour * 60 + cursor.minute;
      const effStart = Math.max(rangeStart, cursorMins);
      // Convert range endpoints back to UTC to compare against `end`.
      const rangeEndUtc = wallToUtc(
        { ...cursor, hour: Math.floor(rangeEnd / 60), minute: rangeEnd % 60, second: 0 },
        calendar.timezone
      );
      if (rangeEndUtc.getTime() >= target) {
        const rangeStartUtc = wallToUtc(
          { ...cursor, hour: Math.floor(effStart / 60), minute: effStart % 60, second: 0 },
          calendar.timezone
        );
        acc += Math.max(0, Math.floor((target - Math.max(start.getTime(), rangeStartUtc.getTime())) / 60_000));
        return acc;
      }
      acc += rangeEnd - effStart;
      cursor = { ...cursor, hour: Math.floor(rangeEnd / 60), minute: rangeEnd % 60, second: 0 };
    }
    const nextInst = wallToUtc({ ...cursor, hour: 23, minute: 59, second: 59 }, calendar.timezone);
    const nextWall = utcToWall(new Date(nextInst.getTime() + 60_000), calendar.timezone);
    cursor = { year: nextWall.year, month: nextWall.month, day: nextWall.day, hour: 0, minute: 0, second: 0 };
  }
  return acc;
}
