// Auto-match a new user to a Company by their email domain (spec §5.1).
// The match is intentionally read-only — new Companies are never created
// implicitly, because that would flood the table with junk rows for every
// personal-email domain (gmail.com, hotmail.com, ...) and unknown one-off
// customer domain. Companies are created explicitly by an admin (or via
// the one-time Phase-2 backfill); auto-match then links new registrants
// to whichever one shares their email domain.
//
// Consumer/free-mail providers are never matched even if a Company row
// happens to exist with that domain, since two unrelated tenants both
// happen to have "gmail.com" contacts is a false positive we can't detect
// any other way.

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

// Companion helper: look up a tenant-scoped Company by domain. Callers
// supply their own Prisma transaction handle so this stays consistent
// with the surrounding withRls() scope. Returns the Company id or null.
type CompanyLookupTx = {
  company: {
    findFirst: (args: { where: { tenantId: string; domain: string } }) => Promise<{ id: string } | null>;
  };
};

export async function matchCompanyByEmail(
  tx: CompanyLookupTx,
  tenantId: string,
  email: string
): Promise<string | null> {
  const domain = extractCompanyDomain(email);
  if (!domain) return null;
  const company = await tx.company.findFirst({ where: { tenantId, domain } });
  return company?.id ?? null;
}
