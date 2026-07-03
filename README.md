# Stralis Ticketing System

Multi-tenant, white-labelable support ticketing platform. Stralis is the host
tenant; client companies can be provisioned as their own branded tenants.
See `Stralis_Build_Spec.md` (build brief), `Stralis_Ticketing_TRD.md`, and
`STRALIS_BRAND_GUIDELINES.md` in `Downloads` for the full spec this was built from.

## Status

All six milestones from the build spec (M0–M6) are built and working end to
end with demo data: project foundation, Prisma schema + RLS policies
(actually enforced — see below), local auth + tenant resolution, the ticket
core (client portal + agent dashboard), email notifications, the admin panel
(team/roles, categories, branding with live preview + WCAG contrast check,
audit log, reports), the AI chatbot (KB, client deflection widget,
chat-to-ticket escalation, agent copilot), and the super-admin console
(tenant provisioning, suspend/activate, cross-tenant health) plus basic
rate limiting. A handful of items are genuinely still open — see "Remaining
gaps" below; none of them block using the app.

## Stack

Next.js 16 (App Router) · TypeScript strict · Tailwind v4 (CSS-variable theming) ·
Prisma 6 · Zod · Geist Sans/Mono.

> The build spec pins Next.js 14, Prisma, and Supabase Auth; this build uses
> the current stable majors instead (Next 16, Prisma 6) since those are what's
> current as of this build, and swaps Supabase Auth for a minimal local
> session (bcrypt + signed JWT cookie via `jose`) — see "Database & auth" below
> for why and what to do before any real deployment.

## Quickstart

```bash
npm install
npm run dev
```

Open **http://localhost:3000** and log in with any of the demo accounts below.

The database is a real Supabase Postgres project (see `.env` — `DATABASE_URL`/
`DIRECT_URL`). Full setup from scratch on a new project:

```bash
npm run db:migrate                          # schema (real migrations)
node scripts/create-app-runtime-role.mjs    # least-privileged runtime role — see below
npm run db:rls                              # RLS policies (enforced only because of the role above)
npm run db:seed                             # demo data
```

## Database & auth — how this differs from the build spec

The build spec calls for Supabase for both Postgres *and* Auth. This build
uses Supabase for the database but **not** for auth: `passwordHash` (bcrypt)
on `User` + a signed session cookie (`src/lib/session.ts`, HS256 via `jose`),
instead of Supabase Auth. See `// TODO(decision)` in `prisma/schema.prisma`
and `src/actions/auth.ts` if you want to swap to Supabase Auth later (gets
you managed password-reset emails, OAuth, etc. for free).

`SESSION_SECRET` in `.env` is currently a dev placeholder — generate a real
one before any real deployment.

### RLS is only real if the app doesn't connect as the table owner

Postgres skips row-level security entirely for a table's owner (and for
`BYPASSRLS` roles) regardless of `ENABLE ROW LEVEL SECURITY` — this bit us
during the build: the app was initially connecting as `postgres` (the
migration-owning role, which has `BYPASSRLS` on Supabase), so every RLS
policy in `prisma/rls_policies.sql` was silently decorative.

The fix: `scripts/create-app-runtime-role.mjs` creates a second role,
`app_runtime` (no `BYPASSRLS`, table read/write only, no DDL), and writes its
connection strings to `.env` as `APP_DATABASE_URL`/`APP_DIRECT_URL`.
`src/lib/db.ts` connects using those at runtime; `DATABASE_URL`/`DIRECT_URL`
(the `postgres` role) are used only for `prisma migrate`. Re-run the script
any time you need to rotate the role's password (it's idempotent — updates
the existing role rather than erroring).

Two tables (`tenants`, `tenant_branding`) are intentionally readable by
*anyone*, not tenant-scoped — see the comments in `prisma/rls_policies.sql`
for why (resolving a tenant by host, and rendering its branding on public/
login pages, both have to happen *before* any tenant session context exists).
Every other table is tenant-isolated and RLS-enforced for real: verified by
querying as `app_runtime` with no session vars set and confirming zero rows
come back even though the tables aren't empty.

**A subtler RLS gotcha this build ran into**: Prisma's `.create()` always
does an implicit `RETURNING`, and Postgres checks a freshly-inserted row
against the table's **SELECT** policies before returning it — not just the
INSERT policy's `WITH CHECK`. `audit_logs` originally had an INSERT policy
scoped to "any role, own tenant" (clients creating tickets need to write an
audit entry) but a SELECT policy scoped to "AGENT/ADMIN/SUPER_ADMIN only" —
so a client's own ticket-creation audit-log insert would satisfy the INSERT
check, then fail anyway with `new row violates row-level security policy`,
because nothing let them read the row back for the `RETURNING` clause. Fixed
by adding `actorId = app_current_user_id()` to the SELECT policy (see
`prisma/rls_policies.sql`) — worth knowing if you add other tables where
INSERT and SELECT access are meant to differ.

### Local-only fallback (no external database)

Before Supabase was connected, this ran entirely locally via
[PGlite](https://pglite.dev) (a real Postgres compiled to WASM) instead of a
hosted database — useful if you ever want to develop offline or without
touching the Supabase project:

```bash
npm run dev:local-db   # starts an embedded Postgres on 127.0.0.1:5433 + Next.js together
npm run db:push        # syncs schema directly (no shadow DB support, so not `db:migrate`)
npm run db:rls
npm run db:seed
```

Swap `DATABASE_URL`/`DIRECT_URL` in `.env` back to
`postgresql://postgres:postgres@127.0.0.1:5433/postgres?sslmode=disable&pgbouncer=true&connection_limit=1`
to use it. The `pgbouncer=true&connection_limit=1` params are required for
PGlite specifically (its single shared backend session collides with
Prisma's prepared-statement reuse otherwise) — real Postgres doesn't need them.

## Demo data

`npm run db:seed` (included in `db:setup`) seeds the Stralis host tenant, 4
categories, and:

| Email | Role | Password |
|---|---|---|
| admin@stralis.app | Admin | `StralisDemo123!` |
| agent@stralis.app | Agent | `StralisDemo123!` |
| sam@stralis.app | Agent | `StralisDemo123!` |
| client@example.com | Client (Acme Corp) | `StralisDemo123!` |
| marcus@northwind.io | Client (Northwind Logistics) | `StralisDemo123!` |
| superadmin@stralis.app | Super Admin | `StralisDemo123!` |
| pending@example.com | Client, status **PENDING** | `StralisDemo123!` (can't log in until approved) |

Plus 5 demo tickets spanning every status (Open, In Progress, Pending,
Resolved, Closed) with realistic threads and an internal note, so the queue
and portal aren't empty on first login. Re-running the seed is safe — it
reuses existing accounts/tickets rather than duplicating them.

Admin accounts redirect to `/admin` on login, Super Admin to `/admin/super`
(Agent to `/agent`).

## What's built (M0–M6)

- **Schema** (`prisma/schema.prisma`): Tenant, TenantBranding, User, Category,
  Ticket, Message, Attachment, AuditLog, KbArticle/KbChunk, ChatbotConfig,
  ChatConversation/ChatMessage.
- **Tenancy**: `lib/tenant.ts` resolves a tenant by custom domain or
  `<slug>.<APP_BASE_DOMAIN>`, falling back to the host tenant. `lib/db.ts`'s
  `withRls()` sets `app.tenant_id`/`app.user_id`/`app.role` per transaction
  so Postgres RLS (`prisma/rls_policies.sql`) is the hard isolation backstop
  behind app-layer checks in every server action — enforced for real via the
  `app_runtime` role (see "RLS is only real if..." above).
- **Auth**: local bcrypt + signed-cookie sessions via `src/actions/auth.ts`;
  `middleware.ts` redirects unauthenticated requests; route-group layouts
  (`(client)`, `(agent)`, `(admin)`) enforce role minimums.
- **Tickets**: full lifecycle state machine enforced server-side in
  `src/actions/tickets.ts` (Open → In Progress → Pending → Resolved → Closed,
  with reopen), AuditLog on every mutation, internal notes hidden from
  clients, client portal + agent queue/detail UI.
- **Email**: `src/lib/email/` — Resend + React Email templates for ticket
  created/replied/status-changed/agent-invite, tenant-branded sender,
  degrades to a console log without `RESEND_API_KEY`.
- **Admin panel** (`src/actions/admin.ts`, `(admin)/admin/*`): invite/manage
  users and roles, categories CRUD, branding editor with live preview and a
  WCAG-AA contrast warning on save, audit log, ticket reports (status/priority
  breakdown, avg first-response time).
- **Branding**: CSS-variable theming in `globals.css` (`--color-primary` etc.)
  defaulting to the Stralis brand, editable per-tenant via the admin panel,
  injected at runtime — no rebuild needed. The root layout (`src/app/layout.tsx`)
  and the `(auth)` layout both resolve the current tenant and apply its
  colors/logo/product name; this used to be dead code (`brandingToCssVars()`
  existed but nothing called it, so every tenant silently rendered Stralis
  orange) until the multi-tenant-localhost-testing pass caught it by actually
  comparing two tenants side by side.
- **AI chatbot** (`src/lib/ai/`, `src/actions/chat.ts`, `src/actions/copilot.ts`):
  `AiProvider` interface with two implementations — `ClaudeProvider`
  (`ANTHROPIC_API_KEY`) and `OpenRouterProvider` (`OPENROUTER_API_KEY`,
  currently pointed at the free `nvidia/nemotron-3-ultra-550b-a55b:free`;
  OpenRouter is preferred when both keys are set — see `src/lib/ai/index.ts`).
  KB CRUD with chunking (`/admin/kb`); client-facing deflection widget on the
  portal; chat-to-ticket escalation with transcript + AI-suggested priority;
  agent copilot (summary + suggested reply, both grounded in KB context) on
  every ticket. Everything degrades to a clear "not configured" message
  without an API key — same pattern as email/Resend.
  - The free Nemotron model is a large reasoning model, not a fast chat
    model — the first real bug this surfaced was DB transactions timing out
    (Prisma's default 5s interactive-transaction limit) because the LLM call
    was happening *inside* the transaction. Fixed by splitting every AI
    action into "fast DB read/write in a transaction" → "slow LLM call
    outside any transaction" → "fast DB write in a transaction", the same
    pattern already used for email sends. Worth knowing if you swap models
    again and things start timing out.
  - Retrieval is keyword-based (term-overlap ranking over `KbChunk.content`),
    not real semantic vector search — the `KbChunk.embedding` column is a
    placeholder `Json?` field until pgvector is provisioned (see the TODO in
    `prisma/schema.prisma`). This is a real simplification, not just a stub:
    it works and returns relevant chunks for reasonably-titled KB articles,
    but won't match paraphrased/synonym queries the way real embeddings would.
- **Super-admin console** (`src/actions/super.ts`, `/admin/super`,
  host-tenant + `SUPER_ADMIN` role only, enforced in both the route layout
  and the RLS policies): provision new white-label tenants (creates the
  tenant, default branding/categories/chatbot config, and its first admin
  user in one action, emails that admin a temp password), suspend/reactivate
  any client tenant, cross-tenant health view (user/ticket counts per
  tenant). Suspending a tenant actually does something — `login()` and
  `getSessionUser()` both check `Tenant.status`, so a suspended tenant's
  users are signed out immediately, not just blocked from new logins.
- **Rate limiting** (`src/lib/rate-limit.ts`): fixed-window limiter, keyed on
  *both* tenant+email (5/min for login) and IP address, on login,
  registration, and password-reset requests. In-memory — fine for a single
  instance, resets per-instance otherwise (see the `TODO(decision)` in the
  file for what to swap in before scaling out).
- **Background jobs** (`src/lib/inngest/`, `/api/inngest`): email send-retry
  (3x with backoff, triggered when the synchronous send in
  `src/lib/email/send.ts` fails) and an hourly Resolved→Closed
  auto-close-after-7-days cron (`src/lib/inngest/functions/auto-close.ts`).
  Requires `npx inngest-cli dev` running locally to actually fire — see
  "Background jobs" below.
- **Audited impersonation** (`src/actions/super.ts`'s `startImpersonation`/
  `stopImpersonation`, `/admin/super`'s "Impersonate" button): a real
  SUPER_ADMIN at the host tenant can step into a client tenant's admin view
  via a short-lived (1hr) signed cookie layered on top of their real
  session — see `getSessionUser()` in `src/lib/auth.ts`, the one choke point
  every server action flows through, so impersonation is enforced app-wide
  rather than needing each action to know about it. A black banner marks the
  impersonated view; every action taken while impersonating is audit-logged
  against the *target* tenant, with the real operator's name/email recorded
  directly on the entry (not just a `User` foreign key — that read would
  fail under RLS once the session's role becomes ADMIN scoped to a different
  tenant than the operator's own `User` row lives in).
- **Multi-tenant routing works on localhost** via the `*.localhost` trick —
  browsers resolve any `*.localhost` subdomain to loopback automatically
  (RFC 6761), no hosts-file editing needed, so a provisioned tenant like
  `acme.localhost:3000` just works for testing tenant isolation and
  per-tenant branding side by side with the host tenant on `localhost:3000`.

## Email-to-ticket & registration approval

Built from `Stralis_Email_Flow_Design.md`. Three pieces:

### 1. Registration approval gate

New self-registered users (`registerClient()` in `src/actions/auth.ts`)
start with `User.status = PENDING` and can't log in
(`login()`/`getSessionUser()` both check this) until a tenant admin approves
them from `/admin/team`'s "Pending approval" panel
(`approveUser`/`rejectUser` in `src/actions/admin.ts`). Approval is scoped
by `tenantId` like everything else — a white-label tenant's admin approves
its own users, Stralis never approves on a client tenant's behalf, and the
host tenant's own admins approve internal registrations the same way.

One exception: if the registrant's email domain already has an `ACTIVE`
user in that tenant, they're auto-approved (`status = ACTIVE` immediately,
no pending state) — same-company convenience, since someone from that
domain has already been vetted once. Admin-invited users (`inviteUser()`)
always skip the gate entirely — the admin creating the account *is* the
approval.

`User.isActive` (boolean) was replaced by `User.status`
(`PENDING | ACTIVE | REJECTED | SUSPENDED`) — see the hand-written migration
`prisma/migrations/20260702090000_email_flow/migration.sql` for the backfill
(existing `isActive: true` → `ACTIVE`, `false` → `SUSPENDED`).

### 2. Ticket numbering + the email status tracker

Every ticket now also gets a short numeric `ticketNumber` (e.g. `78168528`,
globally unique — see `src/lib/ticket-number.ts`), separate from the
tenant-prefixed `reference` (`ACME-42`) shown in the UI. It's embedded in
every notification email subject as `[#78168528]` — email clients mangle
subject lines in all sorts of ways, so inbound reply-matching needs the
simplest possible token to regex back out (`extractTicketNumberFromSubject`
in `src/lib/email/inbound.ts`).

Every ticket-lifecycle email (`src/lib/email/templates/ticket-notification.tsx`)
now renders a 4-stage visual tracker — **New Ticket → In Progress → Waiting
on Customer → Closed** — mapped from `TicketStatus` via `TRACKER_STAGE` in
`src/lib/email/events.ts` (Resolved and Closed share the final stage; that
split is an internal confirm-or-auto-close detail, not something the client
needs to see two stages for).

### 3. Inbound email (email-to-ticket)

**Not wired to a live mailbox yet** — `RESEND_API_KEY` and
`RESEND_WEBHOOK_SECRET` are both unset in `.env`, so
`/api/webhooks/email-inbound` accepts signature-verified requests but every
event resolves to `"skipped: RESEND_API_KEY not configured"` (verified
during development by POSTing a hand-signed Svix payload at the route —
same graceful-degradation pattern as the rest of email/AI in this build).
To actually receive email:

1. Set up [Resend Inbound](https://resend.com/docs) for a domain you
   control, and set an admin/tenant's support address
   (`/admin/branding`'s "Support email" field, which doubles as the inbound
   address — `TenantBranding.supportEmail` is unique across tenants) to an
   address on that domain.
2. In the Resend dashboard, add a Webhook subscribed to the `email.received`
   event, pointing at `<NEXT_PUBLIC_SITE_URL>/api/webhooks/email-inbound`.
3. Copy its signing secret into `RESEND_WEBHOOK_SECRET` in `.env`, and set
   `RESEND_API_KEY` (needed both for outbound and to fetch a received
   email's body via `resend.emails.receiving.get()` — the webhook payload
   itself only carries metadata, not `text`/`html`, per Resend's SDK types).

Once configured, `src/lib/email/inbound-handler.ts` handles both cases from
the design doc:

- **New ticket** (subject has no `[#...]` tag): matches the sender to an
  existing user in the tenant that owns the `to` address, or auto-creates a
  `PENDING` user with a generated temp password (emailed separately) so
  nothing is dropped — the sender just can't log into the portal until an
  admin approves them, same gate as self-registration.
- **Reply to an existing ticket** (subject has a `[#ticketNumber]` tag, with
  an `In-Reply-To`/`References` header fallback for when it's been
  stripped): appends the message, flips `PENDING → IN_PROGRESS` if
  applicable, and notifies the assigned agent — same as a portal reply.

Quoted history/signatures are stripped with a best-effort heuristic
(`stripQuotedReply` in `src/lib/email/inbound.ts`) — not a full parser, but
handles the common Gmail/Outlook/Apple Mail quote-block conventions.
Attachments on inbound email aren't handled — the portal doesn't have
attachment upload wired up either yet (see the `TODO(decision)` in
`src/app/(client)/portal/new/new-ticket-form.tsx`), so this stays
consistent rather than half-implementing just one direction.

## In-app notifications & profile

**Notifications** (`prisma/schema.prisma`'s `Notification` model,
`src/lib/notifications.ts`, `src/actions/notifications.ts`, the bell in
`src/components/notification-bell.tsx`): a personal per-user inbox, separate
from the email system — a ticket reply, status change, or assignment
creates a notification for the relevant person (assigned agent, client, or
tenant admins for new registrations) alongside the existing email send. The
bell polls for the unread count every 30s and shows a dropdown of the
latest 20 on click; clicking a notification marks it read and deep-links to
the ticket.

Notifications are always written via `tx.notification.createMany()`, never
`.create()` — see the comment on the `Notification` model for why:
Prisma's `.create()` does an implicit `RETURNING` that Postgres checks
against SELECT policies, and the actor creating a notification (e.g. a
client replying) is essentially never its recipient (the assigned agent),
so that check would fail under RLS the same way it originally did on
`audit_logs` (see "RLS is only real if..." above). `createMany` has no
`RETURNING`, sidestepping the problem — the same fix pattern, applied
proactively this time instead of discovered by a bug.

**Profile** (`src/actions/profile.ts`, `src/components/profile-form.tsx`):
self-service name/company editing and password change, reachable from a
"Profile" link in the user menu (click your name in the nav). Mounted at
`/portal/profile`, `/agent/profile`, and `/admin/profile` — one shared
component, three thin route entries so each role keeps its own layout/nav.
Email, role, and account status stay admin-managed (`src/actions/admin.ts`)
— a user can't grant themselves a promotion from their own profile page.

### Image uploads (logo + profile picture)

Both the tenant branding logo (`/admin/branding`) and a user's profile
picture (`/*/profile`) upload to **Supabase Storage** — `src/lib/storage.ts`,
using `SUPABASE_SERVICE_ROLE_KEY` server-side only, reusing the same
Supabase project already provisioned for the database rather than adding a
new storage account. Two public buckets (`branding-logos`, `avatars`),
created lazily on first upload; PNG/JPEG/WEBP/SVG only, 2MB max, uploaded to
a fixed per-tenant/per-user path with `upsert: true` (so re-uploading
replaces rather than accumulates), with a `?v=<timestamp>` cache-buster
appended to the saved URL since the path itself never changes.

The manual "Logo URL" text field on the branding tab is kept alongside the
upload button — pasting a URL directly still works even without Storage
configured, same graceful-degradation posture as the rest of this build
(email, AI). If `SUPABASE_SERVICE_ROLE_KEY`/`NEXT_PUBLIC_SUPABASE_URL`
aren't set, the upload button returns a clear "not configured" error
instead of crashing; the URL field is unaffected either way.

## Remaining gaps

Everything below is a genuine, disclosed gap — not a silently-cut corner:

- **Custom domain automation**: tenants have a `customDomain` field and
  tenant resolution already checks it (`src/lib/tenant.ts`), but there's no
  DNS/SSL provisioning flow — a tenant's custom domain has to be added to
  the database directly for now.
- **Sentry**: no error-tracking integration is wired up — would need a real
  Sentry account/DSN to be meaningful, same reasoning as not faking
  Resend/Anthropic credentials elsewhere in this build.
- **Background jobs need `npx inngest-cli dev` running** to actually fire
  locally (see below) — without it, email sends still work synchronously on
  the happy path, they just don't retry on failure, and Resolved tickets
  never auto-close.
- **Inbound email needs a real Resend account** to actually receive mail —
  see "Email-to-ticket" above. The endpoint, signature verification, and
  routing/matching logic are all built and testable (signature checks are
  live-verifiable with any HMAC-capable client), just not connected to a
  live mailbox in this environment.
- **The In-Reply-To/References fallback for reply-matching is unpopulated**:
  the code path exists (`extractReferencedMessageIds` +
  `Ticket.emailMessageId`), but nothing currently writes
  `Ticket.emailMessageId` on outbound send, since Resend's outbound
  response only returns their own email id, not confirmation of the actual
  `Message-ID` header value it used. The primary match path — the
  `[#ticketNumber]` subject tag — doesn't depend on this and is fully wired.
- **Attachments** (portal and inbound email) aren't implemented — flagged as
  an open decision in the email flow design doc itself, and pre-existing
  scope from the original build (`ATTACHMENT_MAX_BYTES`/`ATTACHMENT_ALLOWED_MIME`
  are defined in `src/lib/validation/ticket.ts` but never wired to storage).

## Background jobs (Inngest)

```bash
npx inngest-cli dev -u http://localhost:3000/api/inngest --no-discovery
```

Run this alongside `npm run dev`. `.env` already has `INNGEST_DEV=1` set,
which is all the app side needs for local dev — no event/signing key
required. The Inngest dev server's UI is at http://localhost:8288.

Two functions are registered:
- `retry-email-send` — triggered by the `email/send.failed` event, which
  `src/lib/email/send.ts` fires whenever a Resend call throws. 3 retries
  with backoff.
- `auto-close-resolved-tickets` — hourly cron, closes any ticket that's been
  `RESOLVED` for 7+ days, per tenant (iterates tenants one at a time so each
  update runs inside that tenant's own RLS context — see the comment in
  `src/lib/inngest/functions/auto-close.ts` for why it can't just be a single
  cross-tenant query).

For production, set `INNGEST_EVENT_KEY`/`INNGEST_SIGNING_KEY` from an
Inngest Cloud account instead of `INNGEST_DEV=1`.
