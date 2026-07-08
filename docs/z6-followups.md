# Z6 — outstanding sub-pieces

Z6.1 (Personal Views) and Z6.2 (Placeholder engine, library only) shipped
in this PR. The remaining sub-pieces are called out here so scope doesn't
drift, not because they're blocking — the surfaces below are additive.

## Z6.3 — Canned responses

- New Support-owned model `CannedResponse` with `tenantId`,
  `ownerTeamMemberId` (nullable = tenant-shared once Z6.5 permissioning
  is in), `name`, `shortcut` (unique per owner), `body`.
- Admin surface at `/admin/canned-responses` (list + editor).
- `MessageComposer` intercepts `/shortcut` autocomplete, expands via
  `expand()` from `src/lib/placeholders.ts` in `"html"` mode (composer
  is rich text).
- Placeholder context comes from the current ticket + acting agent +
  tenant branding; no additional DB reads at expand time.

## Z6.4 — Macros (single-action first)

- New Support-owned model `Macro` with `actions` JSON (structured, not
  raw SQL — Z6 §3). Start with three action shapes: `add_internal_note`,
  `change_status`, `insert_reply_template`.
- Editor + apply flow with an **explicit preview modal** listing every
  action the macro will run against this ticket, and a **10s undo
  window** after apply (per Z6 §6).
- Every action runs the same authorization check as if the agent had
  done it manually — the macro engine never elevates. Light Agent
  restriction from Z5.5 fires unchanged when a macro would trigger a
  public message.

## Z6.5 — Shared views

- Same `SavedView` table already exists — `ownerTeamMemberId = NULL`
  is the tenant-shared shape. Wire the "Share this view" toggle in the
  Views rail, gated on a new permission from the Z5 catalog
  (`business_rules.share_view` or similar).
- Seed defaults per tenant: **My open**, **Unassigned**, **Urgent**,
  **Awaiting my reply**. Land in the seed script + tenant provisioning
  path (`scripts/z1_8_staging_tenant.mjs` and the signup flow).

## Z6.6 — Macros used in triggers/automations

- Blocked on Z8 (Automations). The macro engine already validates one
  action at a time in the same shape a trigger would fire; no schema
  work needed here beyond registering macros as an available trigger
  action once Z8 lands.

## Guardrails to preserve when shipping the above

- Filters, actions, and triggers all stay **structured JSON**. Never
  raw SQL. See the Z6 §3 rules.
- Placeholder expansion always declares its mode (`"text"` or `"html"`)
  at the call site. No default.
- Every macro action re-checks role + scope. Do not shortcut this by
  running actions server-side under an elevated context.
