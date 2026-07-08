// Shared nav-link builder for admin+ users. Both the /admin and /agent
// layouts feed the sidebar the same set of links so clicking Queue from
// admin doesn't drop the user into a stripped-down agent shell (and
// vice versa).
//
// Z7 reorganized the flat admin list into the seven Zendesk-style
// sections (Account / People / Objects & Rules / Workspaces / Channels /
// Apps & Integrations / AI). Overview, Analytics, and Queue stay at the
// top level — they're the daily entry points that don't belong to any
// admin category.

import type { NavLink, NavSection } from "@/components/sidebar";
import type { UserRole } from "@/lib/auth";
import { roleAtLeast } from "@/lib/auth";

/**
 * Section slugs are used both for landing-page routes
 * (`/admin/section/<slug>`) and as the collapse-state key in
 * localStorage — keep them stable.
 */
export type AdminSectionSlug =
  | "account"
  | "people"
  | "objects-rules"
  | "workspaces"
  | "channels"
  | "apps"
  | "ai";

export const ADMIN_SECTIONS: {
  slug: AdminSectionSlug;
  label: string;
  description: string;
}[] = [
  { slug: "account", label: "Account", description: "Billing, security, and audit trail." },
  { slug: "people", label: "People", description: "Team members, customers, roles, groups, and organizations." },
  { slug: "objects-rules", label: "Objects & Rules", description: "Fields, forms, macros, canned responses, and placeholders." },
  { slug: "workspaces", label: "Workspaces", description: "Agent workspace and branding." },
  { slug: "channels", label: "Channels", description: "Email, chat, and voice channels." },
  { slug: "apps", label: "Apps & Integrations", description: "API keys, webhooks, and marketplace." },
  { slug: "ai", label: "AI", description: "Chatbot and knowledge base." },
];

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
}): { top: NavLink[]; sections: NavSection[]; footer: NavLink[] } {
  const top: NavLink[] = [
    { href: "/admin", label: "Overview", icon: "overview" },
    { href: "/admin/analytics", label: "Analytics", icon: "analytics" },
    { href: "/agent", label: "Queue", icon: "tickets" },
  ];

  const sections: NavSection[] = [
    {
      slug: "account",
      label: "Account",
      links: [
        { href: "/admin/audit-log", label: "Audit log", icon: "audit" },
        {
          href: "/admin/account-deletions",
          label: "Deletion requests",
          icon: "deletions",
          badge: deletionCount,
        },
      ],
    },
    {
      slug: "people",
      label: "People",
      links: [
        { href: "/admin/team-members", label: "Team members", icon: "teamMembers", badge: pendingCount },
        { href: "/admin/customers", label: "Customers", icon: "customers" },
        { href: "/admin/roles", label: "Roles", icon: "shield" },
        { href: "/admin/organizations", label: "Organizations", icon: "organizations" },
        { href: "/admin/groups", label: "Groups", icon: "groups" },
      ],
    },
    {
      slug: "objects-rules",
      label: "Objects & Rules",
      links: [
        { href: "/admin/fields", label: "Ticket fields", icon: "fields" },
        { href: "/admin/forms", label: "Ticket forms", icon: "forms" },
        { href: "/admin/categories", label: "Categories", icon: "categories" },
        { href: "/admin/triggers", label: "Triggers", icon: "shield" },
        { href: "/admin/automations", label: "Automations", icon: "shield" },
        { href: "/admin/escalation-paths", label: "Escalation paths", icon: "shield" },
        { href: "/admin/sla-policies", label: "SLA policies", icon: "shield" },
        { href: "/admin/business-calendars", label: "Business calendars", icon: "shield" },
        { href: "/admin/routing", label: "Routing", icon: "shield" },
        { href: "/admin/macros", label: "Macros", icon: "forms" },
        { href: "/admin/canned-responses", label: "Canned responses", icon: "forms" },
        { href: "/admin/placeholders", label: "Placeholders", icon: "fields" },
      ],
    },
    {
      slug: "workspaces",
      label: "Workspaces",
      links: [{ href: "/admin/branding", label: "Branding", icon: "branding" }],
    },
    {
      slug: "channels",
      label: "Channels",
      links: [],
    },
    {
      slug: "apps",
      label: "Apps & Integrations",
      links: [],
    },
    {
      slug: "ai",
      label: "AI",
      links: [{ href: "/admin/kb", label: "Knowledge base", icon: "kb" }],
    },
  ];

  // Empty sections still surface a landing card so admins can see the
  // section exists (and that it's intentionally sparse rather than
  // missing). The nav renderer collapses empty sections to a single
  // "Overview" row that links to the landing page.
  for (const s of sections) {
    if (s.links.length === 0) {
      s.links = [{ href: `/admin/section/${s.slug}`, label: `${s.label} overview`, icon: s.slug === "ai" ? "kb" : "overview" }];
    }
  }

  const footer: NavLink[] = [];
  if (role === "SUPER_ADMIN" && tenantType === "INTERNAL") {
    footer.push({ href: "/admin/super", label: "Super admin", icon: "super" });
  }

  return { top, sections, footer };
}

/** Agent-only users see just Queue — no admin surface. */
export function buildAgentNav(role: UserRole): NavLink[] {
  return roleAtLeast(role, "ADMIN")
    ? [] // admin+ falls through to buildAdminNav()
    : [{ href: "/agent", label: "Queue", icon: "tickets" }];
}

/**
 * Flat catalog of every admin page — used by admin search (Z7.3) and
 * Recently viewed (Z7.2). Kept next to `buildAdminNav` so it stays
 * consistent with the taxonomy.
 */
export type AdminPageEntry = {
  href: string;
  label: string;
  section: AdminSectionSlug | "top";
  keywords: string[];
};

export const ADMIN_PAGE_CATALOG: AdminPageEntry[] = [
  { href: "/admin", label: "Overview", section: "top", keywords: ["home", "dashboard", "start"] },
  { href: "/admin/analytics", label: "Analytics", section: "top", keywords: ["reports", "metrics", "kpi", "charts"] },
  { href: "/admin/audit-log", label: "Audit log", section: "account", keywords: ["history", "trail", "activity"] },
  { href: "/admin/account-deletions", label: "Deletion requests", section: "account", keywords: ["delete", "gdpr", "remove account"] },
  { href: "/admin/team-members", label: "Team members", section: "people", keywords: ["staff", "agents", "team", "invite"] },
  { href: "/admin/customers", label: "Customers", section: "people", keywords: ["end users", "clients", "requesters"] },
  { href: "/admin/roles", label: "Roles", section: "people", keywords: ["permissions", "access", "custom role"] },
  { href: "/admin/organizations", label: "Organizations", section: "people", keywords: ["companies", "accounts", "org"] },
  { href: "/admin/groups", label: "Groups", section: "people", keywords: ["team groups", "assignment"] },
  { href: "/admin/fields", label: "Ticket fields", section: "objects-rules", keywords: ["custom fields", "attributes"] },
  { href: "/admin/forms", label: "Ticket forms", section: "objects-rules", keywords: ["form builder", "intake"] },
  { href: "/admin/categories", label: "Categories", section: "objects-rules", keywords: ["taxonomy", "tags"] },
  { href: "/admin/triggers", label: "Triggers", section: "objects-rules", keywords: ["automation", "rules", "workflow", "event"] },
  { href: "/admin/automations", label: "Automations", section: "objects-rules", keywords: ["scheduled", "cron", "background", "workflow"] },
  { href: "/admin/escalation-paths", label: "Escalation paths", section: "objects-rules", keywords: ["escalate", "workflow", "team", "webhook"] },
  { href: "/admin/sla-policies", label: "SLA policies", section: "objects-rules", keywords: ["sla", "response time", "resolution", "targets"] },
  { href: "/admin/business-calendars", label: "Business calendars", section: "objects-rules", keywords: ["business hours", "timezone", "holidays", "working days"] },
  { href: "/admin/routing", label: "Routing", section: "objects-rules", keywords: ["assignment", "round robin", "load", "skills", "agents", "availability"] },
  { href: "/admin/macros", label: "Macros", section: "objects-rules", keywords: ["automation", "shortcut", "quick actions"] },
  { href: "/admin/canned-responses", label: "Canned responses", section: "objects-rules", keywords: ["templates", "replies", "shortcut"] },
  { href: "/admin/placeholders", label: "Placeholders", section: "objects-rules", keywords: ["variables", "tokens", "liquid"] },
  { href: "/admin/branding", label: "Branding", section: "workspaces", keywords: ["logo", "colors", "theme"] },
  { href: "/admin/kb", label: "Knowledge base", section: "ai", keywords: ["help center", "articles", "docs"] },
];
