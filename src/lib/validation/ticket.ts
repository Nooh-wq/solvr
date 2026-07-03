import { z } from "zod";

export const createTicketSchema = z.object({
  title: z.string().min(3).max(200),
  description: z.string().min(1).max(20000),
  categoryId: z.string().cuid().optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).default("MEDIUM"),
});

export const replySchema = z.object({
  ticketId: z.string().cuid(),
  body: z.string().min(1).max(20000),
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
  status: z.enum(["OPEN", "IN_PROGRESS", "PENDING", "RESOLVED", "CLOSED"]).optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).optional(),
  categoryId: z.string().cuid().optional(),
  assignedToId: z.string().optional(), // "unassigned" sentinel allowed
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
