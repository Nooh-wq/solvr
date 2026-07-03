import { z } from "zod";

export const upsertKbArticleSchema = z.object({
  id: z.string().cuid().optional(),
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(20000),
  isPublished: z.boolean().default(false),
});

export const chatSendMessageSchema = z.object({
  conversationId: z.string().cuid().optional(),
  body: z.string().min(1).max(4000),
});
