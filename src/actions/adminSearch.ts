"use server";

import { withRls } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { systemContext, listTeamMembers, listEndUsers, listGroups, listRoles, listOrganizations } from "@/lib/shared-platform";
import { ADMIN_PAGE_CATALOG } from "@/lib/admin-nav";

// Z7.3 — tenant-scoped admin search. Kept intentionally simple: page
// catalog is a substring match on label + keywords; objects (team
// members, customers, orgs, groups, roles, macros, canned responses)
// come from wrapper listXxx() calls (already RLS-scoped) plus direct
// tenant-scoped Prisma queries for the Support-owned tables.
//
// Cross-tenant leakage is impossible: every read either runs under the
// caller's RLS scope (Support tables) or through a wrapper call that
// internally elevates to SUPER_ADMIN inside the caller's tenantId only.

export type AdminSearchResult = {
  kind: "page" | "team member" | "customer" | "organization" | "group" | "role" | "macro" | "canned";
  title: string;
  subtitle?: string;
  href: string;
};

const RESULTS_PER_KIND = 5;

function pageMatches(query: string): AdminSearchResult[] {
  const q = query.toLowerCase();
  return ADMIN_PAGE_CATALOG.filter((p) => {
    if (p.label.toLowerCase().includes(q)) return true;
    return p.keywords.some((k) => k.toLowerCase().includes(q));
  })
    .slice(0, RESULTS_PER_KIND)
    .map((p) => ({ kind: "page" as const, title: p.label, href: p.href, subtitle: `Admin page · ${p.section}` }));
}

export async function searchAdmin(query: string): Promise<AdminSearchResult[]> {
  const session = await requireSession({ minRole: "ADMIN" });
  const q = query.trim();
  if (!q) return [];

  const ctx = systemContext(session.tenantId);
  const results: AdminSearchResult[] = [];

  results.push(...pageMatches(q));

  // Wrapper searches — each function already RLS-scopes to session.tenantId.
  try {
    const tm = await listTeamMembers(ctx, { search: q, limit: RESULTS_PER_KIND });
    for (const m of tm.items) {
      results.push({
        kind: "team member",
        title: m.name ?? m.email,
        subtitle: m.name ? m.email : undefined,
        href: `/admin/users/${m.id}`,
      });
    }
  } catch {
    // Non-fatal.
  }

  try {
    const eu = await listEndUsers(ctx, { search: q, limit: RESULTS_PER_KIND });
    for (const m of eu.items) {
      results.push({
        kind: "customer",
        title: m.name ?? m.email,
        subtitle: m.name ? m.email : undefined,
        href: `/admin/users/${m.id}`,
      });
    }
  } catch {
    // Non-fatal.
  }

  try {
    const orgs = await listOrganizations(ctx);
    // listOrganizations returns a wrapper Page<Organization>
    // (`{ items, hasMore, ... }`), not a raw array. Reach into
    // `items` before running the filter — pre-Z1.5c this used to be
    // a plain array and the consumer never got updated.
    const orgMatches = orgs.items
      .filter((o) => o.name.toLowerCase().includes(q.toLowerCase()))
      .slice(0, RESULTS_PER_KIND);
    for (const o of orgMatches) {
      results.push({ kind: "organization", title: o.name, href: `/admin/organizations/${o.id}` });
    }
  } catch {
    // Non-fatal.
  }

  try {
    const groups = await listGroups(ctx);
    const groupMatches = groups
      .filter((g) => g.name.toLowerCase().includes(q.toLowerCase()))
      .slice(0, RESULTS_PER_KIND);
    for (const g of groupMatches) {
      results.push({ kind: "group", title: g.name, href: `/admin/groups/${g.id}` });
    }
  } catch {
    // Non-fatal.
  }

  try {
    const roles = await listRoles(ctx);
    const roleMatches = roles
      .filter((r) => r.name.toLowerCase().includes(q.toLowerCase()))
      .slice(0, RESULTS_PER_KIND);
    for (const r of roleMatches) {
      results.push({ kind: "role", title: r.name, href: `/admin/roles?edit=${r.id}` });
    }
  } catch {
    // Non-fatal.
  }

  // Support-owned tables — direct Prisma reads under the caller's RLS.
  try {
    await withRls(
      { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
      async (tx) => {
        const macros = await tx.macro.findMany({
          where: {
            tenantId: session.tenantId,
            name: { contains: q, mode: "insensitive" },
            OR: [{ ownerTeamMemberId: session.subjectId }, { ownerTeamMemberId: null }],
          },
          take: RESULTS_PER_KIND,
          select: { id: true, name: true, ownerTeamMemberId: true },
        });
        for (const m of macros) {
          results.push({
            kind: "macro",
            title: m.name,
            subtitle: m.ownerTeamMemberId ? "Personal" : "Shared",
            href: `/admin/macros?edit=${m.id}`,
          });
        }
        const canned = await tx.cannedResponse.findMany({
          where: {
            tenantId: session.tenantId,
            OR: [
              { name: { contains: q, mode: "insensitive" } },
              { shortcut: { contains: q.toLowerCase() } },
              { ownerTeamMemberId: session.subjectId },
              { ownerTeamMemberId: null },
            ],
          },
          take: RESULTS_PER_KIND,
          select: { id: true, name: true, shortcut: true, ownerTeamMemberId: true },
        });
        for (const c of canned) {
          if (
            !c.name.toLowerCase().includes(q.toLowerCase()) &&
            !c.shortcut.toLowerCase().includes(q.toLowerCase())
          )
            continue;
          results.push({
            kind: "canned",
            title: c.name,
            subtitle: `/${c.shortcut}${c.ownerTeamMemberId ? " · Personal" : " · Shared"}`,
            href: `/admin/canned-responses?edit=${c.id}`,
          });
        }
      }
    );
  } catch {
    // Non-fatal.
  }

  return results.slice(0, 25);
}
