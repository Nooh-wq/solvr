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
// Re-export the client-safe catalog so existing callers keep working.
// The catalog lives in a separate module (no @/lib/auth deps) so client
// components can import it without dragging next/headers into the
// client bundle.
export {
  ADMIN_SECTIONS,
  ADMIN_PAGE_CATALOG,
  type AdminSectionSlug,
  type AdminPageEntry,
} from "./admin-nav-catalog";

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
  // Top row is intentionally narrow post-M-admin: just Overview +
  // Queue. Analytics/Reports moved into the Analytics & Reporting
  // section per spec §Nav.
  const top: NavLink[] = [
    { href: "/admin", label: "Overview", icon: "overview" },
    { href: "/agent", label: "Queue", icon: "tickets" },
  ];

  const sections: NavSection[] = [
    {
      slug: "account",
      label: "Account",
      links: [
        { href: "/admin/account", label: "Account overview", icon: "overview" },
        { href: "/admin/branding", label: "Branding", icon: "branding" },
        { href: "/admin/account/business-hours", label: "Business hours", icon: "calendars" },
        { href: "/admin/account/localization", label: "Localization", icon: "overview" },
        { href: "/admin/account/domains", label: "Custom domains", icon: "overview" },
        { href: "/admin/account/billing", label: "Billing", icon: "overview" },
        { href: "/admin/account/compliance", label: "Data & privacy", icon: "shield" },
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
        { href: "/admin/organizations", label: "Organizations", icon: "organizations" },
        { href: "/admin/groups", label: "Groups", icon: "groups" },
        { href: "/admin/roles", label: "Roles & permissions", icon: "roles" },
        { href: "/admin/people/pending", label: "Pending approvals", icon: "customers", badge: pendingCount },
        { href: "/admin/people/suspended", label: "Suspended users", icon: "customers" },
        { href: "/admin/people/activity", label: "Login activity", icon: "audit" },
      ],
    },
    {
      slug: "objects-rules",
      label: "Objects & Rules",
      links: [
        { href: "/admin/fields", label: "Custom fields", icon: "fields" },
        { href: "/admin/forms", label: "Ticket forms", icon: "forms" },
        { href: "/admin/objects/tags", label: "Tags", icon: "categories" },
        { href: "/admin/categories", label: "Categories", icon: "categories" },
        { href: "/admin/triggers", label: "Triggers", icon: "triggers" },
        { href: "/admin/automations", label: "Automations", icon: "automations" },
        { href: "/admin/escalation-paths", label: "Escalation paths", icon: "escalations" },
        { href: "/admin/macros", label: "Macros", icon: "macros" },
        { href: "/admin/placeholders", label: "Placeholders", icon: "placeholders" },
        { href: "/admin/sla-policies", label: "SLA policies", icon: "sla" },
        { href: "/admin/business-calendars", label: "Business calendars", icon: "calendars" },
        { href: "/admin/routing", label: "Routing rules", icon: "routing" },
        { href: "/admin/csat", label: "CSAT & Feedback", icon: "csat" },
        { href: "/admin/canned-responses", label: "Canned responses", icon: "cannedResponses" },
      ],
    },
    {
      slug: "workspaces",
      label: "Workspaces",
      links: [
        { href: "/admin/workspaces/agent", label: "Agent workspace", icon: "overview" },
        { href: "/admin/workspaces/views", label: "Views", icon: "overview" },
        { href: "/admin/workspaces/portal", label: "Portal", icon: "overview" },
        { href: "/admin/workspaces/layout", label: "Ticket layout", icon: "overview" },
        { href: "/admin/workspaces/chat", label: "Chat widget", icon: "overview" },
      ],
    },
    {
      slug: "channels",
      label: "Channels",
      links: [
        { href: "/admin/channels/email", label: "Email channels", icon: "overview" },
        { href: "/admin/channels/web-forms", label: "Web forms", icon: "overview" },
        { href: "/admin/channels", label: "Live chat & omnichannel", icon: "overview" },
        { href: "/admin/apps/api-keys", label: "API keys", icon: "overview" },
        { href: "/admin/channels/voice", label: "Voice (soon)", icon: "overview" },
      ],
    },
    {
      slug: "apps",
      label: "Apps & Integrations",
      links: [
        { href: "/admin/apps/marketplace", label: "Marketplace", icon: "overview" },
        { href: "/admin/apps/installed", label: "Installed apps", icon: "overview" },
        { href: "/admin/apps/webhooks", label: "Webhooks", icon: "overview" },
        { href: "/admin/apps/zapier", label: "Zapier / Make", icon: "overview" },
        { href: "/admin/identity-providers", label: "SSO / SAML", icon: "shield" },
        { href: "/admin/apps/scim", label: "SCIM provisioning", icon: "shield" },
      ],
    },
    {
      slug: "ai",
      label: "AI",
      links: [
        { href: "/admin/ai/settings", label: "AI configuration", icon: "overview" },
        { href: "/admin/ai/intents", label: "Intent library", icon: "overview" },
        { href: "/admin/ai/tools", label: "AI agents", icon: "overview" },
        { href: "/admin/ai/qa", label: "AI QA", icon: "overview" },
        { href: "/admin/ai/qa/rubric", label: "QA rubric", icon: "overview" },
        { href: "/admin/kb", label: "Knowledge base", icon: "kb" },
        { href: "/admin/ai/performance", label: "AI performance", icon: "analytics" },
        { href: "/admin/ai/prompts", label: "Prompt library", icon: "overview" },
      ],
    },
    {
      slug: "analytics",
      label: "Analytics & Reporting",
      links: [
        { href: "/admin/analytics", label: "Analytics overview", icon: "analytics" },
        { href: "/admin/reports", label: "Custom reports", icon: "reports" },
        { href: "/admin/analytics/shared", label: "Shared reports", icon: "reports" },
        { href: "/admin/analytics/per-org", label: "Per-organization dashboards", icon: "analytics" },
        { href: "/admin/audit-log", label: "Audit log", icon: "audit" },
      ],
    },
  ];

  // Super Admin section — only rendered for SUPER_ADMIN role. Spec §3
  // pin: "Do not surface Super Admin capabilities to Admins" — hide,
  // don't disable.
  if (role === "SUPER_ADMIN") {
    sections.push({
      slug: "super",
      label: "Super Admin",
      links: [
        { href: "/admin/super", label: "Tenant management", icon: "super" },
        { href: "/admin/super/analytics", label: "Cross-tenant analytics", icon: "analytics" },
        { href: "/admin/super/impersonation", label: "Impersonation", icon: "super" },
        { href: "/admin/super/health", label: "System health", icon: "overview" },
        { href: "/admin/super/flags", label: "Feature flags", icon: "overview" },
        { href: "/admin/super/support", label: "Support tickets", icon: "tickets" },
      ],
    });
  }
  // Silence unused-var lint on tenantType — kept in the signature so
  // callers that already pass it don't break; the previous
  // INTERNAL-only gating moved into the SUPER_ADMIN role check above.
  void tenantType;

  const footer: NavLink[] = [];
  return { top, sections, footer };
}

/** Agent-only users see just Queue — no admin surface. */
export function buildAgentNav(role: UserRole): NavLink[] {
  return roleAtLeast(role, "ADMIN")
    ? [] // admin+ falls through to buildAdminNav()
    : [{ href: "/agent", label: "Queue", icon: "tickets" }];
}

// The catalog moved to admin-nav-catalog.ts (client-safe, no @/lib/auth
// deps) — see the re-export at the top of this file.
