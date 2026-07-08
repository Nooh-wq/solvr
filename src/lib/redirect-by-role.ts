/** Where each role lands after auth (login/OTP/reset/invite) or when hitting
 * "/" with an existing session — kept out of actions/auth.ts ("use server",
 * so it can only export async actions) so plain server components can use it too. */
export const REDIRECT_BY_ROLE: Record<string, string> = {
  CLIENT: "/portal",
  AGENT: "/agent",
  ADMIN: "/admin",
  SUPER_ADMIN: "/admin/super",
};

// M21.5 — allow-list of destinations a role may set as its "default landing
// page" in the Appearance tab. Runtime check keeps a stale preference (e.g.
// a demoted admin still storing "/admin") from redirecting somewhere they
// no longer have access to.
const ALLOWED_LANDING: Record<string, Set<string>> = {
  CLIENT: new Set(["/portal", "/portal/new"]),
  AGENT: new Set(["/agent", "/portal"]),
  ADMIN: new Set(["/admin", "/admin/analytics", "/agent"]),
  SUPER_ADMIN: new Set(["/admin/super", "/admin", "/admin/analytics"]),
};

/** Post-login redirect: prefer the user's saved default landing page if it's
 * still a valid destination for their role, otherwise fall back to the role
 * default. Guards against stale/invalid values silently. */
export function resolvePostAuthLanding(role: string, savedLanding: string | null | undefined): string {
  if (savedLanding && ALLOWED_LANDING[role]?.has(savedLanding)) return savedLanding;
  return REDIRECT_BY_ROLE[role] ?? "/";
}
