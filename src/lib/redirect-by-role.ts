/** Where each role lands after auth (login/OTP/reset/invite) or when hitting
 * "/" with an existing session — kept out of actions/auth.ts ("use server",
 * so it can only export async actions) so plain server components can use it too. */
export const REDIRECT_BY_ROLE: Record<string, string> = {
  CLIENT: "/portal",
  AGENT: "/agent",
  ADMIN: "/admin",
  SUPER_ADMIN: "/admin/super",
};
