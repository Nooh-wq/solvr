import { z } from "zod";

/** Shown next to every password field so the rules are visible before a rejection, not just after. */
export const PASSWORD_RULES_HINT = "At least 8 characters, with an uppercase letter, a lowercase letter, a number, and a special character.";

/**
 * Applied everywhere a user sets/changes their own password (registration,
 * invite-accept, password reset, profile change) — previously only `min(8)`
 * was enforced anywhere in the app, so literally any 8-character string
 * (e.g. "aaaaaaaa") was accepted.
 */
export const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters.")
  .max(72, "Password is too long (max 72 characters).")
  .regex(/[A-Z]/, "Password must include an uppercase letter.")
  .regex(/[a-z]/, "Password must include a lowercase letter.")
  .regex(/[0-9]/, "Password must include a number.")
  .regex(/[^A-Za-z0-9]/, "Password must include a special character.");
