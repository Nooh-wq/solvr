// M-admin — legacy → canonical URL redirect map.
//
// Spec §"URL redirects for existing bookmarks": keep every old admin
// URL working via a 302. We list only the moves — pages whose
// canonical URL didn't change (e.g. /admin/branding still lives at
// /admin/branding) get no entry.
//
// Consumed by next.config.ts's async redirects(). All redirects are
// permanent: false so an admin can reverse-migrate cheaply if needed
// (spec §"keep redirects live indefinitely" is about not deleting the
// map — 302 vs 301 is a separate call).

export type AdminUrlRedirect = { source: string; destination: string; permanent: false };

export const ADMIN_URL_REDIRECTS: AdminUrlRedirect[] = [
  // Phase 4g — Zendesk-style muscle memory. Admins arriving from
  // Zendesk / Freshdesk / older Solvr URLs land on the canonical page.
  { source: "/admin/users", destination: "/admin/team-members", permanent: false },
  { source: "/admin/staff", destination: "/admin/team-members", permanent: false },
  { source: "/admin/agents", destination: "/admin/team-members", permanent: false },
  { source: "/admin/end-users", destination: "/admin/customers", permanent: false },
  { source: "/admin/clients", destination: "/admin/customers", permanent: false },
  { source: "/admin/contacts", destination: "/admin/customers", permanent: false },
  { source: "/admin/companies", destination: "/admin/organizations", permanent: false },
  { source: "/admin/accounts", destination: "/admin/organizations", permanent: false },
  { source: "/admin/permissions", destination: "/admin/roles", permanent: false },
  { source: "/admin/custom-fields", destination: "/admin/fields", permanent: false },
  { source: "/admin/ticket-fields", destination: "/admin/fields", permanent: false },
  { source: "/admin/ticket-forms", destination: "/admin/forms", permanent: false },
  { source: "/admin/tags", destination: "/admin/objects/tags", permanent: false },
  { source: "/admin/business-rules", destination: "/admin/triggers", permanent: false },
  { source: "/admin/workflow", destination: "/admin/automations", permanent: false },
  { source: "/admin/workflows", destination: "/admin/automations", permanent: false },
  { source: "/admin/business-hours", destination: "/admin/account/business-hours", permanent: false },
  { source: "/admin/timezone", destination: "/admin/account/localization", permanent: false },
  { source: "/admin/language", destination: "/admin/account/localization", permanent: false },
  { source: "/admin/subdomain", destination: "/admin/account/domains", permanent: false },
  { source: "/admin/domain", destination: "/admin/account/domains", permanent: false },
  { source: "/admin/plan", destination: "/admin/account/billing", permanent: false },
  { source: "/admin/subscription", destination: "/admin/account/billing", permanent: false },
  { source: "/admin/invoices", destination: "/admin/account/billing", permanent: false },
  { source: "/admin/hipaa", destination: "/admin/account/compliance", permanent: false },
  { source: "/admin/gdpr", destination: "/admin/account/compliance", permanent: false },
  { source: "/admin/privacy", destination: "/admin/account/compliance", permanent: false },
  { source: "/admin/retention", destination: "/admin/account/compliance", permanent: false },
  { source: "/admin/integrations", destination: "/admin/apps/installed", permanent: false },
  { source: "/admin/apps", destination: "/admin/apps/marketplace", permanent: false },
  { source: "/admin/marketplace", destination: "/admin/apps/marketplace", permanent: false },
  { source: "/admin/webhook", destination: "/admin/apps/webhooks", permanent: false },
  { source: "/admin/api-keys", destination: "/admin/apps/api-keys", permanent: false },
  { source: "/admin/oauth", destination: "/admin/apps/api-keys", permanent: false },
  { source: "/admin/sso", destination: "/admin/identity-providers", permanent: false },
  { source: "/admin/saml", destination: "/admin/identity-providers", permanent: false },
  { source: "/admin/scim", destination: "/admin/apps/scim", permanent: false },
  { source: "/admin/knowledge-base", destination: "/admin/kb", permanent: false },
  { source: "/admin/help-center", destination: "/admin/kb", permanent: false },
  { source: "/admin/chatbot", destination: "/admin/workspaces/chat", permanent: false },
  { source: "/admin/reports/scheduled", destination: "/admin/analytics/shared", permanent: false },
  { source: "/admin/insights", destination: "/admin/analytics", permanent: false },
  { source: "/admin/dashboards", destination: "/admin/analytics", permanent: false },
  { source: "/admin/views", destination: "/admin/workspaces/views", permanent: false },
  { source: "/admin/portal", destination: "/admin/workspaces/portal", permanent: false },
  { source: "/admin/email", destination: "/admin/channels/email", permanent: false },
  { source: "/admin/email-channels", destination: "/admin/channels/email", permanent: false },
  { source: "/admin/voice", destination: "/admin/channels/voice", permanent: false },
  { source: "/admin/chat", destination: "/admin/channels", permanent: false },
];
