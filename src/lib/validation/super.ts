import { z } from "zod";

export const createTenantSchema = z.object({
  name: z.string().min(1).max(120),
  slug: z
    .string()
    .min(2)
    .max(40)
    .regex(/^[a-z0-9-]+$/, "Lowercase letters, numbers, and hyphens only"),
  adminName: z.string().min(1).max(120),
  adminEmail: z.string().email(),
});
