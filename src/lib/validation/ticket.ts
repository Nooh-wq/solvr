import { z } from "zod";

// HTML <select> filter dropdowns submit "" for their "All ___" option (an
// empty query param), which z.enum(...).optional() rejects outright — it only
// accepts a valid enum value or the key being absent entirely, not "". This
// wraps a schema so "" is treated the same as "not provided".
const emptyToUndefined = <T extends z.ZodTypeAny>(schema: T) => z.preprocess((val) => (val === "" ? undefined : val), schema);

export const createTicketSchema = z.object({
  title: z.string().min(3).max(200),
  description: z.string().min(1).max(20000),
  categoryId: z.string().cuid().optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).default("MEDIUM"),
});

export const replySchema = z.object({
  ticketId: z.string().cuid(),
  body: z.string().min(1).max(20000),
  attachmentIds: z.array(z.string().cuid()).max(10).optional(),
});

export const agentReplySchema = replySchema.extend({
  isInternal: z.boolean().default(false),
});

export const updateTicketSchema = z.object({
  ticketId: z.string().cuid(),
  status: z.enum(["OPEN", "IN_PROGRESS", "PENDING", "RESOLVED", "CLOSED"]).optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).optional(),
  assignedToId: z.string().cuid().nullable().optional(),
});

export const ticketFilterSchema = z.object({
  status: emptyToUndefined(z.enum(["OPEN", "IN_PROGRESS", "PENDING", "RESOLVED", "CLOSED"]).optional()),
  priority: emptyToUndefined(z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).optional()),
  categoryId: emptyToUndefined(z.string().cuid().optional()),
  assignedToId: z.string().optional(), // "" (no filter) and "unassigned" (sentinel) are both meaningful strings here
  search: z.string().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
});

export const ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024;
export const ATTACHMENT_ALLOWED_MIME = [
  "image/png",
  "image/jpeg",
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/zip",
];
