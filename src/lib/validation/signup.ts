import { z } from "zod";
import { passwordSchema } from "./password";

// Reserved slugs that would collide with real routes/subdomains. Kept
// broad — cheap to reserve now, painful to reclaim later.
const RESERVED_SLUGS = new Set([
  "www", "api", "app", "admin", "auth", "signup", "login", "register",
  "mail", "email", "smtp", "imap", "webhook", "status", "docs", "help",
  "support", "blog", "assets", "static", "public", "internal", "root",
  "test", "staging", "dev", "prod", "production", "billing", "stralis",
  "solvr",
]);

export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, "Workspace URL must be at least 3 characters.")
  .max(30, "Workspace URL must be 30 characters or fewer.")
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    "Only lowercase letters, numbers, and hyphens (not at the start or end)."
  )
  .refine((v) => !RESERVED_SLUGS.has(v), "This workspace URL is reserved — pick another.");

// Tenant signup (spec: Zendesk-style — anyone can register a new workspace
// and becomes its SUPER_ADMIN owner). Distinct from the per-tenant
// registerClient flow, which creates CLIENT-role end-customers inside an
// existing tenant.
export const tenantSignupSchema = z.object({
  tenantName: z.string().trim().min(2, "Company name must be at least 2 characters.").max(60, "Company name is too long."),
  slug: slugSchema,
  adminName: z.string().trim().min(1, "Enter your full name.").max(120, "Name is too long."),
  adminEmail: z.string().trim().toLowerCase().email("Enter a valid email address."),
  password: passwordSchema,
});
export type TenantSignupInput = z.infer<typeof tenantSignupSchema>;

export const verifyTenantSignupSchema = z.object({
  otpToken: z.string().min(1),
  code: z.string().regex(/^\d{6}$/, "Enter the 6-digit code."),
});

// Server-side slug derivation from a company name — used as the client
// form's initial slug suggestion (user can still override). Strips
// punctuation, collapses whitespace/underscores to single hyphens, trims
// leading/trailing hyphens, and caps at the schema's max length.
export function suggestSlugFromName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip combining accents
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30);
}
