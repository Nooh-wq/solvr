<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# src/core/* is an extraction candidate — hard import rule

Everything under `src/core/*` (currently `src/core/auth/*` and `src/core/rbac/*`) is scoped for extraction to Shared Platform when HRMS or CRM starts consuming it (see [boundary doc §7.19 M-core-extraction](docs/shared-platform-boundary.md)). The invariant that keeps that extraction cheap:

**`src/core/*` MUST NOT import from `src/lib/*` or `src/app/*`.**

Anything core needs must live inside `src/core/*` itself (adjacent modules) or come from allowlisted third-party packages (`jose`, `next/server` types, generated Prisma client types, etc.). The dependency arrow always points inward: `app` → `lib` → `core`, never back.

Enforced two ways:
- **Hard rule** — ESLint's `no-restricted-imports` blocks the pattern under `src/core/**` (see `eslint.config.mjs`). CI fails on violation.
- **Cultural rule** — this section. Reviewers reject any PR that tries to satisfy a core need by reaching into `lib/` or `app/`. If a shared piece is required, move it into `src/core/` first.

Same discipline as ADR-004's "reference models are read-only": when a rule exists to keep a future extraction sound, the tests aren't the last word — reviewers are.

# Row-Level Security is the tenant-isolation backstop — every tenant table needs it

Tenant isolation is enforced in two layers, and the second is not optional:

1. **App layer** — every query filters by `tenantId` and runs inside
   `withRls({ tenantId, userId, role }, tx => …)` (`src/lib/db.ts`), which sets
   the `app.tenant_id` / `app.user_id` / `app.role` Postgres GUCs for the
   transaction. Never call the bare `prisma` client for tenant data.
2. **Database layer** — RLS policies in `prisma/rls_policies.sql` are the hard
   backstop. The app runs as the `app_runtime` role, which has **no BYPASSRLS**,
   so a query that forgets its `tenantId` filter still returns nothing across the
   tenant boundary. This only holds if the app connects via `APP_DATABASE_URL`
   (see `src/lib/db.ts`), not the migration-owning role.

**Invariant: every table with a `tenantId` column MUST have RLS enabled + a
`tenant_isolation` policy.** When you add a tenant-scoped model:
- Add the table name to the enable-loop array in `prisma/rls_policies.sql` and a
  `tenant_isolation` policy (`using ("tenantId" = app_current_tenant_id())`).
- If a legitimate cross-tenant system context reads/writes it (a bearer-token
  auth fanout, a per-tenant cron, the host super-admin health view), add a
  `super_admin_write` / `super_admin_read` policy keyed on
  `app_current_role() = 'SUPER_ADMIN'` — do **not** widen `tenant_isolation`.
- Reapply with `node --env-file=.env scripts/apply-rls.mjs` (psql isn't
  available in this repo), then **verify with
  `node --env-file=.env scripts/qa_full_rls_audit.mjs`** — it fails if any
  `tenantId` table lacks RLS or leaks to a bogus tenant.

A system context that must cross tenants uses `withRls` with
`role: "SUPER_ADMIN"` and (usually) the real `tenantId` — never bare `prisma`,
which sets no GUC and is silently blocked by RLS under `app_runtime`.
