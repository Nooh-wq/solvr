// M-admin — client-safe catalog module.
//
// Split out of admin-nav.tsx so client components (e.g. the command
// palette) can import ADMIN_PAGE_CATALOG + ADMIN_SECTIONS without
// pulling in @/lib/auth (which imports next/headers via lib/session,
// and next/headers is server-only in the App Router).

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
  { href: "/admin/kb", label: "Knowledge base", section: "ai", keywords: ["help center", "articles", "docs"] },
  { href: "/admin/ai/performance", label: "AI performance", section: "ai", keywords: ["confidence", "csat", "correlation"] },
  { href: "/admin/ai/prompts", label: "Prompt library", section: "ai", keywords: ["prompts", "templates"] },
  { href: "/admin/reports", label: "Custom reports", section: "analytics", keywords: ["report builder", "scheduled"] },
  { href: "/admin/analytics/shared", label: "Shared reports", section: "analytics", keywords: ["share link", "read-only"] },
  { href: "/admin/analytics/per-org", label: "Per-organization dashboards", section: "analytics", keywords: ["organization", "org dashboard"] },
];
