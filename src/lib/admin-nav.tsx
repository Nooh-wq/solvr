// Shared nav-link builder for admin+ users. Both the /admin and /agent
// layouts feed the sidebar the same set of links so clicking Queue from
// admin doesn't drop the user into a stripped-down agent shell (and
// vice versa). Queue sits just under Analytics per the spec — the
// admin's "start of day" is Overview → Analytics → Queue.
//
// Kept in a .tsx file (not .ts) because NavLink references a JSX-style
// icon key that's part of the sidebar's React module — nothing here
// actually renders, but the type import surface stays consistent.

import type { NavLink } from "@/components/sidebar";
import type { UserRole } from "@/lib/auth";
import { roleAtLeast } from "@/lib/auth";

export function buildAdminNav({
  role,
  tenantType,
  pendingCount,
  deletionCount,
}: {
  role: UserRole;
  tenantType: string;
  pendingCount: number;
  deletionCount: number;
}): NavLink[] {
  return [
    { href: "/admin", label: "Overview", icon: "overview" },
    { href: "/admin/analytics", label: "Analytics", icon: "analytics" },
    { href: "/agent", label: "Queue", icon: "tickets" },
    { href: "/admin/customers", label: "Customers", icon: "customers" },
    { href: "/admin/organizations", label: "Organizations", icon: "organizations" },
    { href: "/admin/team-members", label: "Team members", icon: "teamMembers", badge: pendingCount },
    { href: "/admin/groups", label: "Groups", icon: "groups" },
    { href: "/admin/roles", label: "Roles", icon: "shield" },
    { href: "/admin/categories", label: "Categories", icon: "categories" },
    { href: "/admin/fields", label: "Fields", icon: "fields" },
    { href: "/admin/forms", label: "Forms", icon: "forms" },
    { href: "/admin/canned-responses", label: "Canned responses", icon: "forms" },
    { href: "/admin/placeholders", label: "Placeholders", icon: "fields" },
    { href: "/admin/branding", label: "Branding", icon: "branding" },
    { href: "/admin/kb", label: "Knowledge base", icon: "kb" },
    { href: "/admin/audit-log", label: "Audit log", icon: "audit" },
    {
      href: "/admin/account-deletions",
      label: "Deletion requests",
      icon: "deletions",
      badge: deletionCount,
    },
    ...(role === "SUPER_ADMIN" && tenantType === "INTERNAL"
      ? [{ href: "/admin/super", label: "Super admin", icon: "super" as const }]
      : []),
  ];
}

/** Agent-only users see just Queue — no admin surface. */
export function buildAgentNav(role: UserRole): NavLink[] {
  return roleAtLeast(role, "ADMIN")
    ? [] // admin+ falls through to buildAdminNav()
    : [{ href: "/agent", label: "Queue", icon: "tickets" }];
}
