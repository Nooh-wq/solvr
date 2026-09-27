// M20.1 — data residency guard.
//
// The deployment's region is set by APP_REGION at boot. Every request
// that carries a tenant context must have `tenant.residencyRegion`
// match APP_REGION (or the fallback "*" — a single-region deployment).
//
// Spec §3 pin: "Do NOT cross-region a query. A residency=EU tenant's
// data never touches US infrastructure." — enforced here as a hard
// throw so no code path can silently serve cross-region data.

/** The deployment's own region, from env. "*" = single-region deployment. */
export function currentRegion(): string {
  return process.env.APP_REGION?.toUpperCase() ?? "*";
}

/**
 * Throws if the tenant's residency doesn't match the deployment's
 * region. Callers wrap RLS-context boundaries with this — every
 * `requireSession()` call site funnels through auth.ts, which invokes
 * assertResidency before returning the session.
 *
 * The "*" region means "no residency enforcement is configured for
 * this deployment" — used in dev/CI and single-region installs.
 */
export function assertResidency(tenantResidency: string | null | undefined): void {
  const app = currentRegion();
  if (app === "*") return;
  const t = (tenantResidency ?? "").toUpperCase();
  if (!t) return; // legacy tenant with no residency set — treated as any
  if (t === app) return;
  throw new ResidencyMismatchError(
    `Cross-region access blocked: tenant residency=${t} but this deployment is region=${app}. Route requests for this tenant to the ${t} deployment.`
  );
}

export class ResidencyMismatchError extends Error {
  readonly name = "ResidencyMismatchError";
}
