import { z } from "zod";
import { passwordSchema } from "@/lib/validation/password";

export const updateProfileSchema = z.object({
  name: z.string().min(1).max(120),
  company: z.string().max(120).optional(),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: passwordSchema,
});
