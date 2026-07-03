import { prisma } from "@/lib/db";
import type { Tenant, TenantBranding } from "@/generated/prisma";

export type ResolvedTenant = Tenant & { branding: TenantBranding | null };

const HOST_TENANT_SLUG = "stralis";

/**
 * Resolves a Tenant from the request host:
 *  1. exact match on Tenant.customDomain ("support.acme.com")
 *  2. "<slug>.<APP_BASE_DOMAIN>" subdomain match (also "<slug>.localhost" in
 *     dev — browsers resolve *.localhost to loopback automatically, per RFC
 *     6761, with no hosts-file editing needed, so e.g. acme.localhost:3000
 *     just works for testing multi-tenant routing locally)
 *  3. fallback to the host tenant (app.stralis.com / localhost)
 */
export async function resolveTenantByHost(host: string): Promise<ResolvedTenant | null> {
  const cleanHost = host.split(":")[0].toLowerCase();

  const byCustomDomain = await prisma.tenant.findUnique({
    where: { customDomain: cleanHost },
    include: { branding: true },
  });
  if (byCustomDomain) return byCustomDomain;

  const baseDomain = process.env.APP_BASE_DOMAIN ?? "stralis.app";
  const suffixMatch = [`.${baseDomain}`, ".localhost"].find((suffix) => cleanHost.endsWith(suffix));
  if (suffixMatch) {
    const slug = cleanHost.slice(0, -suffixMatch.length);
    const bySlug = await prisma.tenant.findUnique({
      where: { slug },
      include: { branding: true },
    });
    if (bySlug) return bySlug;
  }

  // localhost / app.<baseDomain> / unmatched hosts -> host tenant
  return prisma.tenant.findUnique({
    where: { slug: HOST_TENANT_SLUG },
    include: { branding: true },
  });
}

/** Looks up a tenant by id directly — used where the tenant is already known from the session (e.g. impersonation), rather than re-resolving from the request host. */
export async function getTenantById(id: string): Promise<ResolvedTenant | null> {
  return prisma.tenant.findUnique({ where: { id }, include: { branding: true } });
}

/** Builds the inline CSS variable overrides for a tenant's branding. */
export function brandingToCssVars(branding: TenantBranding | null): Record<string, string> {
  if (!branding) return {};
  return {
    "--color-primary": branding.primaryColor,
    "--color-primary-hover": branding.primaryColor,
    "--color-accent": branding.accentColor,
  };
}
