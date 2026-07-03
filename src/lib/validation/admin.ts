import { z } from "zod";

export const inviteUserSchema = z.object({
  name: z.string().min(1).max(120),
  email: z.string().email(),
  role: z.enum(["CLIENT", "AGENT", "ADMIN"]),
  company: z.string().max(120).optional(),
});

export const updateUserSchema = z.object({
  userId: z.string().cuid(),
  role: z.enum(["CLIENT", "AGENT", "ADMIN"]).optional(),
  // Toggles between ACTIVE/SUSPENDED only — approving/rejecting a PENDING
  // registration goes through approveUser()/rejectUser() instead, since
  // those also send a different email and are a distinct audited action.
  status: z.enum(["ACTIVE", "SUSPENDED"]).optional(),
});

export const userIdSchema = z.object({ userId: z.string().cuid() });

export const upsertCategorySchema = z.object({
  id: z.string().cuid().optional(),
  name: z.string().min(1).max(60),
  isActive: z.boolean().default(true),
});

export const updateBrandingSchema = z.object({
  productName: z.string().min(1).max(60),
  primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Must be a hex color like #FF6A00"),
  accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Must be a hex color like #000000"),
  logoUrl: z.string().url().optional().or(z.literal("")),
  supportEmail: z.string().email().optional().or(z.literal("")),
  emailFromName: z.string().max(80).optional().or(z.literal("")),
});

export const auditLogFilterSchema = z.object({
  action: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
});
