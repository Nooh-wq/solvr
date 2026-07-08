// Z5.4 — the 8 permission categories every role's toggles live under.
// Kept Support-side (this repo owns the UX around them); the wrapper's
// Role.permissions column stays a Json blob so this list can evolve
// without a shared-platform migration. Adding a ninth category means
// the role editor won't render it — as intended (Z5 §3, "no ad-hoc flags").
//
// Each permission's key is stable ("<category>.<verb>") and stored
// verbatim in Role.permissions as { [key]: boolean }. Missing keys are
// treated as false — never true — so tightening a role is safe and
// loosening is always explicit.

export type PermissionCategoryKey =
  | "tickets"
  | "people"
  | "business_rules"
  | "channels"
  | "knowledge"
  | "reports"
  | "apps"
  | "account";

export type PermissionDef = {
  key: string;
  label: string;
  description: string;
};

export type PermissionCategory = {
  key: PermissionCategoryKey;
  label: string;
  permissions: PermissionDef[];
};

export const PERMISSION_CATEGORIES: PermissionCategory[] = [
  {
    key: "tickets",
    label: "Tickets",
    permissions: [
      { key: "tickets.view", label: "View tickets", description: "See tickets within their scope." },
      { key: "tickets.reply_public", label: "Send public replies", description: "Post messages visible to the requester." },
      { key: "tickets.reply_internal", label: "Add internal notes", description: "Post notes visible only to staff." },
      { key: "tickets.edit_properties", label: "Edit ticket properties", description: "Change status, priority, assignee, category." },
      { key: "tickets.delete", label: "Delete tickets", description: "Permanently remove a ticket." },
    ],
  },
  {
    key: "people",
    label: "People",
    permissions: [
      { key: "people.view", label: "View people", description: "Browse customers, team members, organizations." },
      { key: "people.edit", label: "Edit people", description: "Change name, email, org membership, tags." },
      { key: "people.delete", label: "Delete people", description: "Remove customers or team members." },
    ],
  },
  {
    key: "business_rules",
    label: "Business rules",
    permissions: [
      { key: "business_rules.view", label: "View business rules", description: "See SLA policies, macros, triggers." },
      { key: "business_rules.edit", label: "Edit business rules", description: "Create or change SLAs, macros, triggers." },
    ],
  },
  {
    key: "channels",
    label: "Channels",
    permissions: [
      { key: "channels.view", label: "View channels", description: "See email, portal, chat channel setup." },
      { key: "channels.edit", label: "Edit channels", description: "Configure inbound email, chat widget, portal." },
    ],
  },
  {
    key: "knowledge",
    label: "Knowledge",
    permissions: [
      { key: "knowledge.view", label: "View knowledge base", description: "Read internal + published articles." },
      { key: "knowledge.author", label: "Author articles", description: "Draft and publish knowledge-base articles." },
    ],
  },
  {
    key: "reports",
    label: "Reports",
    permissions: [
      { key: "reports.view", label: "View reports", description: "Access analytics dashboards." },
      { key: "reports.export", label: "Export reports", description: "Download CSV / PDF exports." },
    ],
  },
  {
    key: "apps",
    label: "Apps",
    permissions: [
      { key: "apps.view", label: "View apps", description: "See installed integrations." },
      { key: "apps.manage", label: "Manage apps", description: "Install, configure, or uninstall integrations." },
    ],
  },
  {
    key: "account",
    label: "Account",
    permissions: [
      { key: "account.view_settings", label: "View account settings", description: "See branding, tenant config." },
      { key: "account.edit_settings", label: "Edit account settings", description: "Change branding, tenant config." },
      { key: "account.manage_roles", label: "Manage roles", description: "Create, edit, delete custom roles." },
    ],
  },
];

export const ALL_PERMISSION_KEYS: string[] = PERMISSION_CATEGORIES.flatMap((c) =>
  c.permissions.map((p) => p.key)
);
