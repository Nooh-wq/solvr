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
  | "ai"
  | "analytics"
  | "super";

export const ADMIN_SECTIONS: {
  slug: AdminSectionSlug;
  label: string;
  description: string;
}[] = [
  { slug: "account", label: "Account", description: "Billing, branding, business hours, compliance." },
  { slug: "people", label: "People", description: "Team members, customers, roles, groups, and organizations." },
  { slug: "objects-rules", label: "Objects & Rules", description: "Fields, forms, macros, canned responses, and placeholders." },
  { slug: "workspaces", label: "Workspaces", description: "Agent workspace and branding." },
  { slug: "channels", label: "Channels", description: "Email, chat, and voice channels." },
  { slug: "apps", label: "Apps & Integrations", description: "API keys, webhooks, and marketplace." },
  { slug: "ai", label: "AI", description: "Chatbot and knowledge base." },
  { slug: "analytics", label: "Analytics & Reporting", description: "Dashboards, custom reports, audit log." },
  { slug: "super", label: "Super Admin", description: "Cross-tenant operations and system health." },
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
  { href: "/admin/csat", label: "CSAT & Feedback", section: "objects-rules", keywords: ["csat", "nps", "survey", "rating", "feedback", "moderation"] },
  { href: "/admin/macros", label: "Macros", section: "objects-rules", keywords: ["automation", "shortcut", "quick actions"] },
  { href: "/admin/canned-responses", label: "Canned responses", section: "objects-rules", keywords: ["templates", "replies", "shortcut"] },
  { href: "/admin/placeholders", label: "Placeholders", section: "objects-rules", keywords: ["variables", "tokens", "liquid"] },
  { href: "/admin/branding", label: "Branding", section: "account", keywords: ["logo", "colors", "theme"] },
  { href: "/admin/account", label: "Account overview", section: "account", keywords: ["overview", "settings", "tenant"] },
  { href: "/admin/account/compliance", label: "Data & privacy", section: "account", keywords: ["retention", "hipaa", "gdpr", "byok", "compliance"] },
  { href: "/admin/account/business-hours", label: "Business hours", section: "account", keywords: ["working hours", "calendar", "timezone"] },
  { href: "/admin/account/localization", label: "Localization", section: "account", keywords: ["language", "locale", "date format"] },
  { href: "/admin/account/domains", label: "Custom domains", section: "account", keywords: ["dns", "hostname", "cname"] },
  { href: "/admin/account/billing", label: "Billing", section: "account", keywords: ["invoice", "plan", "seats", "usage"] },
  { href: "/admin/people/pending", label: "Pending approvals", section: "people", keywords: ["approve", "queue", "awaiting"] },
  { href: "/admin/people/suspended", label: "Suspended users", section: "people", keywords: ["deactivated", "disabled"] },
  { href: "/admin/people/activity", label: "Login activity", section: "people", keywords: ["logins", "sessions", "history"] },
  { href: "/admin/objects/tags", label: "Tags", section: "objects-rules", keywords: ["tag", "taxonomy", "labels"] },
  { href: "/admin/workspaces/agent", label: "Agent workspace", section: "workspaces", keywords: ["preferences", "shortcuts", "agent settings"] },
  { href: "/admin/workspaces/views", label: "Views", section: "workspaces", keywords: ["queue", "saved view", "shared view"] },
  { href: "/admin/workspaces/portal", label: "Portal", section: "workspaces", keywords: ["customer portal"] },
  { href: "/admin/workspaces/layout", label: "Ticket layout", section: "workspaces", keywords: ["fields", "layout"] },
  { href: "/admin/workspaces/chat", label: "Chat widget", section: "workspaces", keywords: ["live chat widget"] },
  { href: "/admin/channels/email", label: "Email channels", section: "channels", keywords: ["inbound email", "forwarding"] },
  { href: "/admin/channels/web-forms", label: "Web forms", section: "channels", keywords: ["form widget", "embed"] },
  { href: "/admin/channels/voice", label: "Voice", section: "channels", keywords: ["twilio", "connect", "phone"] },
  { href: "/admin/apps/marketplace", label: "Marketplace", section: "apps", keywords: ["integrations", "browse"] },
  { href: "/admin/apps/installed", label: "Installed apps", section: "apps", keywords: ["integrations", "installed"] },
  { href: "/admin/apps/api-keys", label: "API keys", section: "channels", keywords: ["api", "token", "programmatic"] },
  { href: "/admin/apps/webhooks", label: "Webhooks", section: "apps", keywords: ["outbound", "webhook", "hmac"] },
  { href: "/admin/apps/zapier", label: "Zapier / Make", section: "apps", keywords: ["zapier", "make", "no-code"] },
  { href: "/admin/identity-providers", label: "SSO / SAML", section: "apps", keywords: ["sso", "saml", "oidc", "identity"] },
  { href: "/admin/apps/scim", label: "SCIM provisioning", section: "apps", keywords: ["scim", "provisioning", "sync"] },
  { href: "/admin/ai/settings", label: "AI configuration", section: "ai", keywords: ["ai", "model", "cost", "settings"] },
  { href: "/admin/ai/intents", label: "Intent library", section: "ai", keywords: ["intent", "classification"] },
  { href: "/admin/ai/tools", label: "AI agents", section: "ai", keywords: ["ai tools", "tool registry"] },
  { href: "/admin/ai/qa", label: "AI QA", section: "ai", keywords: ["quality", "score", "rubric"] },
  { href: "/admin/ai/qa/rubric", label: "QA rubric", section: "ai", keywords: ["rubric", "criteria"] },
  { href: "/admin/ai/performance", label: "AI performance", section: "ai", keywords: ["confidence", "csat", "correlation"] },
  { href: "/admin/ai/prompts", label: "Prompt library", section: "ai", keywords: ["prompts", "templates"] },
  { href: "/admin/reports", label: "Custom reports", section: "analytics", keywords: ["report builder", "scheduled"] },
  { href: "/admin/analytics/shared", label: "Shared reports", section: "analytics", keywords: ["share link", "read-only"] },
  { href: "/admin/analytics/per-org", label: "Per-organization dashboards", section: "analytics", keywords: ["organization", "org dashboard"] },
];
