import { z } from "zod";

export const inviteUserSchema = z.object({
  name: z.string().trim().min(1, "Enter a name.").max(120, "Name is too long."),
  email: z.string().trim().email("Enter a valid email address (e.g. name@company.com)."),
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

// Bulk actions accept 1..500 user IDs (500 as a sanity cap so a runaway
// admin action doesn't build a monster transaction). All bulk actions
// return per-user success/failure — see spec §4 "bulk UX contract".
export const bulkUserIdsSchema = z.object({
  userIds: z.array(z.string().cuid()).min(1, "Select at least one person.").max(500, "Too many rows selected at once."),
});
export const bulkChangeRoleSchema = bulkUserIdsSchema.extend({
  role: z.enum(["CLIENT", "AGENT", "ADMIN"]),
});

// Letters (any language), digits, spaces, and a small set of punctuation
// that shows up in real category names ("Bugs & Fixes", "Tier-1 Support",
// "Billing/Invoices"). Rejects strings made entirely of symbols
// (e.g. "&^#@@^$*@@%") since it requires at least one letter.
const CATEGORY_NAME_CHARSET = /^[\p{L}\p{N} &'/.,()-]+$/u;

export const upsertCategorySchema = z.object({
  id: z.string().cuid().optional(),
  name: z
    .string()
    .trim()
    .min(2, "Category name must be at least 2 characters.")
    .max(60, "Category name is too long (max 60 characters).")
    .regex(CATEGORY_NAME_CHARSET, "Category name can only contain letters, numbers, spaces, and & ' / . , ( ) -")
    .refine((v) => /\p{L}/u.test(v), "Category name must contain at least one letter."),
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

export const analyticsFilterSchema = z.object({
  range: z.enum(["7d", "30d", "90d", "custom"]).default("30d"),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  channel: z.enum(["portal", "chatbot", "email"]).optional(),
  categoryId: z.string().cuid().optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).optional(),
  // "unassigned" is a sentinel distinct from the field simply being absent
  // (absent = all agents including unassigned; "unassigned" = only tickets
  // with no assignedToId).
  assignedToId: z.union([z.string().cuid(), z.literal("unassigned")]).optional(),
  // M13.1 — scope every widget to a single organization.
  organizationId: z.string().cuid().optional(),
});
export type AnalyticsFilter = z.infer<typeof analyticsFilterSchema>;
