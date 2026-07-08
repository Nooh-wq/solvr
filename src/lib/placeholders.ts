// Z6.2 — Placeholder engine. Central expansion layer shared by canned
// responses, macros, and email templates. Rules from the Z6 spec:
//
//  1. Context-aware escaping. The caller declares the `mode` a template
//     is expanding into ("text" → HTML-escape, "html" → verbatim). The
//     resolver never guesses. Documented at each call site.
//  2. Tenant-scoped. The context carries the tenantId that was already
//     resolved by the calling server action; no placeholder in this
//     engine ever hits the DB or does a global lookup. If a caller needs
//     a value that isn't already on the context, they compute it before
//     calling expand().
//  3. Human-readable ticket ids only. `{{ticket.reference}}` is the
//     public token; `{{ticket.id}}` is deliberately absent (Z6 spec §3
//     "do NOT put ticket ID in placeholders as {{ticket.id}}").
//  4. Unknown or empty placeholders render as an empty string, never as
//     the raw `{{...}}` token — a broken template that leaks a token
//     into a customer email is worse than one that leaks a blank.
//
// # Available placeholders
//
// | Token                              | Source                        |
// |------------------------------------|-------------------------------|
// | {{ticket.reference}}               | Ticket.reference              |
// | {{ticket.title}}                   | Ticket.title                  |
// | {{ticket.priority}}                | Ticket.priority (lowercased)  |
// | {{ticket.status}}                  | Ticket.status (lowercased)    |
// | {{ticket.requester.name}}          | Ticket requester display name |
// | {{ticket.requester.email}}         | Ticket requester email        |
// | {{ticket.organization.name}}       | Organization.name (or blank)  |
// | {{agent.name}}                     | Acting team member name       |
// | {{agent.email}}                    | Acting team member email      |
// | {{tenant.productName}}             | TenantBranding.productName    |
//
// Placeholders that resolve to null/undefined render as an empty string.

export type PlaceholderContext = {
  tenantId: string;
  ticket?: {
    reference: string;
    title: string;
    priority: string;
    status: string;
    requester?: { name: string | null; email: string | null } | null;
    organization?: { name: string | null } | null;
  };
  agent?: { name: string | null; email: string | null } | null;
  tenant?: { productName: string | null } | null;
};

export type ExpandMode = "text" | "html";

// Kept as a plain object rather than a nested traversal so the entire
// legal placeholder set is discoverable at a glance and typos never
// silently walk into a nested undefined.
type Resolver = (ctx: PlaceholderContext) => string | null | undefined;

const RESOLVERS: Record<string, Resolver> = {
  "ticket.reference": (c) => c.ticket?.reference,
  "ticket.title": (c) => c.ticket?.title,
  "ticket.priority": (c) => c.ticket?.priority?.toLowerCase(),
  "ticket.status": (c) => c.ticket?.status?.toLowerCase().replace(/_/g, " "),
  "ticket.requester.name": (c) => c.ticket?.requester?.name,
  "ticket.requester.email": (c) => c.ticket?.requester?.email,
  "ticket.organization.name": (c) => c.ticket?.organization?.name,
  "agent.name": (c) => c.agent?.name,
  "agent.email": (c) => c.agent?.email,
  "tenant.productName": (c) => c.tenant?.productName,
};

/** Canonical list of placeholder tokens, for docs UI + admin discoverability. */
export const PLACEHOLDER_KEYS: string[] = Object.keys(RESOLVERS);

const TOKEN_RE = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Expands every `{{...}}` token in `template` against `ctx`. The `mode`
 * controls output escaping:
 *   - "text": the template is going into a plain-text surface (email
 *     body, subject line, note body). Resolved values are HTML-escaped
 *     defensively so a value containing "<" never breaks the surface it
 *     eventually lands in.
 *   - "html": the template is a rich-text/HTML body. Resolved values
 *     are inserted verbatim — callers pre-sanitize values that came
 *     from user input.
 *
 * Both modes strip unknown or unresolvable tokens rather than leaving
 * a raw `{{...}}` in the output (see file header, rule 4).
 */
export function expand(
  template: string,
  ctx: PlaceholderContext,
  mode: ExpandMode
): string {
  return template.replace(TOKEN_RE, (_match, key: string) => {
    const resolver = RESOLVERS[key];
    if (!resolver) return "";
    const raw = resolver(ctx);
    if (raw === null || raw === undefined) return "";
    const str = String(raw);
    return mode === "text" ? escapeHtml(str) : str;
  });
}

/**
 * Returns the set of placeholder tokens actually referenced by `template`,
 * excluding unknown ones. Useful for macro/canned-response editors that
 * want to preview which values will be substituted before saving.
 */
export function extractPlaceholders(template: string): string[] {
  const seen = new Set<string>();
  for (const m of template.matchAll(TOKEN_RE)) {
    const key = m[1];
    if (RESOLVERS[key]) seen.add(key);
  }
  return [...seen];
}
