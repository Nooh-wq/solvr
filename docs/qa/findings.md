# QA sweep — follow-up findings (2026-07)

Items surfaced by the end-to-end QA + security sweep that are **not**
unambiguous bugs and were therefore left for a human decision rather than
fixed in the sweep. Each has a concrete location, the ambiguity, and the
question that needs answering. Unambiguous bugs and all security issues were
fixed in the sweep itself (see the commit log and the QA report).

---

## F1 — Cross-tenant health counts are host-tenant-scoped for isolation-only tables

**Location:** `src/actions/superAdmin.ts` → `getSystemHealth()`

**What:** The Super Admin system-health dashboard wants *cross-tenant* counts
(total tickets, users, messages, queue depths across every tenant). After the
RLS backstop was added (`security(rls)` commit), the counts run inside a
SUPER_ADMIN `withRls` context. Tables with a `super_admin_read`/`super_admin_write`
policy (`tickets`, `webhook_subscriptions`, `api_usage_logs`) count every tenant
correctly. Tables with **only** `tenant_isolation` (`messages`, `csat_queue`,
`digest_queue`, `approval_requests`, and the shared-platform `end_users` /
`team_members`) count only the **host** tenant's rows, because there is no
policy granting SUPER_ADMIN a cross-tenant read on them.

**Ambiguity:** Two defensible directions, with a real privacy trade-off:
- (a) Add `super_admin_read` to those tables too — simplest, but widens the host
  operator's cross-tenant visibility to message rows etc., which the original
  RLS design deliberately avoided (only `tickets` got `super_admin_read`).
- (b) Source host-operator cross-tenant aggregates from a dedicated BYPASSRLS
  connection (the M13 `superAnalytics.ts` model) instead of the app_runtime
  role, keeping RLS strict for everyone else.

**Question:** Should the host operator be able to read individual message /
CSAT / approval rows cross-tenant (a), or should cross-tenant *aggregates* come
from a separate privileged read path that never exposes rows (b)? Until
decided, those specific counts under-report (host-tenant only) rather than being
wrong-but-cross-tenant. `activeTenants`, `tenants`, `tickets`, `openTickets`,
webhook/API error counts are correct cross-tenant.

**Suggested resolution:** (b) — add a narrow `hostAggregate()` helper that uses a
BYPASSRLS datasource for count-only cross-tenant health, so no row content
crosses the tenant boundary. Larger than a sweep-sized fix; needs the separate
datasource wired in `src/lib/db.ts`.

---

## F2 — `attachments` RLS is tenant-only, not ticket-scoped

**Location:** `prisma/rls_policies.sql` (attachments policy), enforced at app
layer in `src/actions/attachments.ts`.

**What:** `attachments.tenant_isolation` scopes by `tenantId` only; per-ticket
access is enforced in the app layer (every query filters by `ticketId`). This is
pre-existing and documented in the policy comment, not new. A GUEST session (one
invited ticket) relies on the app layer, not RLS, for attachment scoping.

**Ambiguity:** Whether to tighten attachments to a true per-ticket RLS policy
(as `tickets`/`messages` have for GUEST) or keep the documented app-layer
enforcement. Tightening is safer-by-default but requires a subquery-join policy
and a careful check that staff attachment browsing still works.

**Question:** Is app-layer ticket scoping on attachments an accepted invariant,
or should it become an RLS-enforced one to match messages?

**Suggested resolution:** Add a `guest_sees_ticket_attachments` policy mirroring
`guest_sees_ticket_messages` and exclude GUEST from `attachments.tenant_isolation`,
matching the messages pattern. Defer to a security-hardening PR.

---

## F3 — Tag merge does per-assignment queries (N+1)

**Location:** `src/actions/adminTags.ts` → `adminMergeTags()` (nested loop).

**What:** Merging tags loops over each source tag's assignments and issues a
`findUnique` + `delete`/`update` per assignment. It is correct and runs inside a
single transaction, but it is O(assignments) round-trips.

**Ambiguity:** Not a bug — merges are a rare admin action on a bounded set. A
batch rewrite would have to reproduce the unique-constraint collision handling
(when the target already carries the same assignment) in SQL, trading clarity
for speed that this path doesn't need.

**Question:** Is tag-merge latency ever user-visible enough to justify the batch
rewrite? If not, leave as-is.

**Suggested resolution:** Leave as-is; revisit only if a tenant reports slow
merges on very large tag assignments.
