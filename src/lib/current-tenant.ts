import { cache } from "react";
import { headers } from "next/headers";
import { resolveTenantByHost, type ResolvedTenant } from "@/lib/tenant";

/**
 * Resolves the tenant for the current request from the `host` header.
 * Server-only. Wrapped in React's cache() so the root layout, an
 * (auth)/(client)/(agent)/(admin) layout, and a page can all call this in
 * the same render pass without re-querying the DB each time.
 */
export const getCurrentTenant = cache(async (): Promise<ResolvedTenant> => {
  const h = await headers();
  const host = h.get("host") ?? "localhost";
  const tenant = await resolveTenantByHost(host);
  if (!tenant) throw new Error("NO_HOST_TENANT_SEEDED");
  return tenant;
});
