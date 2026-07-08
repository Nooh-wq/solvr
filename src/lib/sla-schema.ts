import { z } from "zod";

// M2.1 — SLA + calendar shapes. Kept as a shared lib so the admin
// editors, ticket-detail read path, and the sla.tick cron all validate
// against the same Zod schemas. Nothing here touches the DB.

// ---------------------------------------------------------------------------
// Policy
// ---------------------------------------------------------------------------

/**
 * One priority's targets. `null` for a target kind means "no SLA for
 * this priority/kind" — the writer skips creating a TicketSla row.
 * That's how a tenant declares "we only track first-response for
 * LOW, not resolution" without a separate schema switch.
 */
export const priorityTargetSchema = z.object({
  firstResponseMins: z.number().int().positive().max(60 * 24 * 30).nullable(),
  resolutionMins: z.number().int().positive().max(60 * 24 * 90).nullable(),
});

export const slaTargetsSchema = z.object({
  URGENT: priorityTargetSchema,
  HIGH: priorityTargetSchema,
  MEDIUM: priorityTargetSchema,
  LOW: priorityTargetSchema,
});

export type PriorityTarget = z.infer<typeof priorityTargetSchema>;
export type SlaTargets = z.infer<typeof slaTargetsSchema>;

export const createSlaPolicySchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  targets: slaTargetsSchema,
  isDefault: z.boolean().default(false),
  active: z.boolean().default(true),
});

export const updateSlaPolicySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(500).optional(),
  targets: slaTargetsSchema.optional(),
  isDefault: z.boolean().optional(),
  active: z.boolean().optional(),
});

// ---------------------------------------------------------------------------
// Calendar
// ---------------------------------------------------------------------------

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** A single time range within one day, e.g. ["09:00","17:00"]. */
export const timeRangeSchema = z
  .tuple([z.string().regex(HHMM), z.string().regex(HHMM)])
  .refine(([s, e]) => s < e, "start must be before end");

/**
 * Weekly hours keyed by 3-letter day. Empty array = closed on that
 * day. Multiple ranges = split shift (e.g. 09:00-12:00 + 13:00-17:00
 * with a lunch break). Matches how Zendesk / Freshdesk represent the
 * concept.
 */
export const weeklyHoursSchema = z.object({
  mon: z.array(timeRangeSchema).max(4).default([]),
  tue: z.array(timeRangeSchema).max(4).default([]),
  wed: z.array(timeRangeSchema).max(4).default([]),
  thu: z.array(timeRangeSchema).max(4).default([]),
  fri: z.array(timeRangeSchema).max(4).default([]),
  sat: z.array(timeRangeSchema).max(4).default([]),
  sun: z.array(timeRangeSchema).max(4).default([]),
});

export type WeeklyHours = z.infer<typeof weeklyHoursSchema>;

/** Holidays are ISO calendar dates in the calendar's tz. */
export const holidaysSchema = z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).max(200);

export const createBusinessCalendarSchema = z.object({
  name: z.string().min(1).max(120),
  timezone: z.string().min(1).max(64), // IANA — no exhaustive list; DB accepts anything Intl.DateTimeFormat does
  weeklyHours: weeklyHoursSchema,
  holidays: holidaysSchema.default([]),
  isDefault: z.boolean().default(false),
});

export const updateBusinessCalendarSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(120).optional(),
  timezone: z.string().min(1).max(64).optional(),
  weeklyHours: weeklyHoursSchema.optional(),
  holidays: holidaysSchema.optional(),
  isDefault: z.boolean().optional(),
});

// ---------------------------------------------------------------------------
// Sensible defaults for freshly-provisioned tenants (see M2 spec §5).
// ---------------------------------------------------------------------------

/**
 * Baseline "Standard SLA" mirroring the previous constant thresholds
 * (URGENT=1h, HIGH=4h, MEDIUM=8h, LOW=24h) — same numbers callers
 * used before M2 shipped, so existing analytics don't jump.
 */
export const DEFAULT_SLA_TARGETS: SlaTargets = {
  URGENT: { firstResponseMins: 60, resolutionMins: 240 },
  HIGH: { firstResponseMins: 4 * 60, resolutionMins: 16 * 60 },
  MEDIUM: { firstResponseMins: 8 * 60, resolutionMins: 24 * 60 },
  LOW: { firstResponseMins: 24 * 60, resolutionMins: 72 * 60 },
};

/**
 * Baseline "Mon-Fri 9-5 UTC" — a safe starting shape. Tenants can
 * edit any of it, but we never want a fresh tenant to see "no
 * calendar" and have the dueAt walker no-op.
 */
export const DEFAULT_WEEKLY_HOURS: WeeklyHours = {
  mon: [["09:00", "17:00"]],
  tue: [["09:00", "17:00"]],
  wed: [["09:00", "17:00"]],
  thu: [["09:00", "17:00"]],
  fri: [["09:00", "17:00"]],
  sat: [],
  sun: [],
};
