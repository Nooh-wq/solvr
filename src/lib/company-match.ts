// Auto-match a new user to an Organization by their email domain (spec §5.1).
//
// Z1.6: this file was previously a Prisma-direct read of the legacy
// `companies` table. Migrated to route through the shared-platform
// wrapper's `matchOrganizationByEmailDomain`. Preserved-ids from Z1.3
// mean the returned Organization.id equals the legacy Company.id — so
// callers continue to store the value as `companyId` on legacy `users`
// (dual-write path) AND as `organizationId` on wrapper EndUser (single
// value serves both stores).
//
// The match is intentionally read-only — new Organizations are never
// created implicitly. Consumer/free-mail providers (gmail.com, etc.)
// are never matched even if an Organization row happens to exist with
// that domain — the wrapper's `matchOrganizationByEmailDomain` handles
// that skip-list internally.

import { systemContext, matchOrganizationByEmailDomain } from "@/lib/shared-platform";

/**
 * Look up a tenant-scoped Organization by the domain of the given
 * email. Returns the Organization id or null (no match, personal-mail
 * domain, or malformed email). Callers on the Z1.6 dual-write path
 * use the returned id for both `users.companyId` (legacy) and
 * `end_users.organizationId` (wrapper).
 */
export async function matchCompanyByEmail(
  tenantId: string,
  email: string
): Promise<string | null> {
  const org = await matchOrganizationByEmailDomain(systemContext(tenantId), email);
  return org?.id ?? null;
}

// extractCompanyDomain is preserved as a re-export for any consumer that
// only needs the domain-parsing logic without hitting the DB. The
// wrapper has its own internal copy of the same personal-domain skip
// list — kept in sync with the wrapper via the boundary doc §7.5 rules
// (backfill script + wrapper both reference this same set).

const PERSONAL_DOMAINS = new Set([
  "gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "icloud.com",
  "aol.com", "protonmail.com", "proton.me", "live.com", "msn.com",
  "me.com", "mail.com", "gmx.com", "zoho.com", "yandex.com",
]);

export function extractCompanyDomain(email: string): string | null {
  const domain = email.split("@")[1]?.toLowerCase();
  if (!domain) return null;
  if (PERSONAL_DOMAINS.has(domain)) return null;
  return domain;
}
