-- Row-Level Security policies for the Stralis Ticketing System.
-- Run this AFTER `prisma migrate dev` (Prisma doesn't manage RLS directly).
--   psql "$DIRECT_URL" -f prisma/rls_policies.sql
--
-- IMPORTANT: these policies are only a real backstop if the app connects as
-- a role WITHOUT the BYPASSRLS attribute (table owners and superusers skip
-- RLS by default regardless of "enable row level security"). The app must
-- use APP_DATABASE_URL / APP_DIRECT_URL (role `app_runtime`, created by
-- scripts/create-app-runtime-role.mjs), not DATABASE_URL/DIRECT_URL
-- (the migration-owning role) — see src/lib/db.ts.
--
-- Session vars (set per-request via lib/db.ts withRls()):
--   app.tenant_id      -- current tenant's id
--   app.user_id        -- current user's id ('' for anonymous/chatbot)
--   app.role           -- CLIENT | AGENT | ADMIN | SUPER_ADMIN | GUEST
--   app.guest_ticket_id -- set only when app.role = 'GUEST': the ONE ticket
--                          this guest link was invited to (see
--                          lib/guest-access.ts) — GUEST never gets the
--                          tenant-wide access every other role has.
--
-- Safe to re-run: policies are dropped and recreated each time.

-- Helper: treat an empty/missing setting as NULL instead of erroring.
create or replace function app_current_tenant_id() returns text as $$
  select nullif(current_setting('app.tenant_id', true), '');
$$ language sql stable;

create or replace function app_current_user_id() returns text as $$
  select nullif(current_setting('app.user_id', true), '');
$$ language sql stable;

create or replace function app_current_role() returns text as $$
  select nullif(current_setting('app.role', true), '');
$$ language sql stable;

create or replace function app_current_guest_ticket_id() returns text as $$
  select nullif(current_setting('app.guest_ticket_id', true), '');
$$ language sql stable;

-- tenants: readable by anyone — resolving a Tenant by host/slug is how
-- tenant context gets established in the first place (middleware, login,
-- register all run before any app.tenant_id session var exists), and a
-- Tenant row (name/slug/domain/status) isn't sensitive on its own.
-- Writes (provisioning/suspending tenants, M6) are restricted to sessions
-- with role SUPER_ADMIN — src/actions/super.ts also checks the caller
-- belongs to the INTERNAL host tenant before calling these, as defense in
-- depth (a compromised client-tenant SUPER_ADMIN role, if one ever existed,
-- still couldn't provision tenants through this policy alone).
alter table tenants enable row level security;
alter table tenants force row level security;
drop policy if exists tenant_self_read on tenants;
drop policy if exists tenant_public_read on tenants;
create policy tenant_public_read on tenants
  for select using (true);
drop policy if exists super_admin_write on tenants;
create policy super_admin_write on tenants
  for all using (app_current_role() = 'SUPER_ADMIN')
  with check (app_current_role() = 'SUPER_ADMIN');

do $$
declare
  t text;
begin
  for t in select unnest(array[
    'tenant_branding','categories','tickets','messages',
    'attachments','audit_logs','kb_articles','kb_chunks',
    'chatbot_configs','chat_conversations','chat_messages','notifications',
    'ticket_guests','login_otps','survey_responses',
    'kb_suggestions',
    'ai_tools','ai_action_logs',
    'qa_rubrics','qa_scores',
    'service_catalog_items','approval_requests','assets','asset_links'
  ])
  loop
    execute format('alter table %I enable row level security;', t);
    execute format('alter table %I force row level security;', t);
  end loop;
end $$;

-- tenant_branding: readable by anyone (theming must render on public/login
-- pages before any session exists); writes still require matching tenant
-- context via the tenant_isolation policy below.
drop policy if exists branding_public_read on tenant_branding;
create policy branding_public_read on tenant_branding
  for select using (true);
drop policy if exists tenant_isolation on tenant_branding;
create policy tenant_isolation on tenant_branding
  using ("tenantId" = app_current_tenant_id());
drop policy if exists tenant_isolation on chatbot_configs;
create policy tenant_isolation on chatbot_configs
  using ("tenantId" = app_current_tenant_id());

-- users / companies: Z1.5c dropped these tables. Wrapper identity lives in
-- end_users / team_members / organizations — those live under the Shared
-- Platform's own RLS policies (see the shared repo).

-- categories
drop policy if exists tenant_isolation on categories;
create policy tenant_isolation on categories
  using ("tenantId" = app_current_tenant_id());

-- SUPER_ADMIN provisioning: creating a new tenant means writing its initial
-- TenantBranding/ChatbotConfig/Category rows before app.tenant_id can be set
-- to that new tenant's id (it doesn't exist yet in this session's context).
-- These policies are additive (OR'd with tenant_isolation above), scoped to
-- role only — src/actions/super.ts restricts which sessions can carry that role.
drop policy if exists super_admin_write on tenant_branding;
create policy super_admin_write on tenant_branding
  for all using (app_current_role() = 'SUPER_ADMIN') with check (app_current_role() = 'SUPER_ADMIN');
drop policy if exists super_admin_write on chatbot_configs;
create policy super_admin_write on chatbot_configs
  for all using (app_current_role() = 'SUPER_ADMIN') with check (app_current_role() = 'SUPER_ADMIN');
drop policy if exists super_admin_write on categories;
create policy super_admin_write on categories
  for all using (app_current_role() = 'SUPER_ADMIN') with check (app_current_role() = 'SUPER_ADMIN');

-- tickets: agents/admins see all tenant tickets; clients see only their own.
-- SUPER_ADMIN gets read-only cross-tenant access for the "cross-tenant
-- health" ticket-volume view — deliberately select-only (not `for all`,
-- unlike the provisioning tables above), since Super-Admin has no product
-- reason to mutate another tenant's tickets.
--
-- GUEST is deliberately excluded from tenant_isolation/client_sees_own_tickets
-- below (every other role gets tenant-wide-or-own-ticket access just by
-- matching tenantId) and instead gets its own guest_sees_own_ticket policy,
-- scoped to the exact one ticket in app.guest_ticket_id — a guest session
-- still carries a real app.tenant_id (see lib/guest-access.ts), so without
-- this exclusion it would inherit the same tenant-wide visibility as a
-- normal CLIENT/AGENT session.
drop policy if exists tenant_isolation on tickets;
create policy tenant_isolation on tickets
  using ("tenantId" = app_current_tenant_id() and app_current_role() <> 'GUEST');
drop policy if exists super_admin_read on tickets;
create policy super_admin_read on tickets
  for select using (app_current_role() = 'SUPER_ADMIN');
drop policy if exists client_sees_own_tickets on tickets;
create policy client_sees_own_tickets on tickets
  for select using (
    "tenantId" = app_current_tenant_id()
    and app_current_role() <> 'GUEST'
    and (
      app_current_role() in ('AGENT','ADMIN','SUPER_ADMIN')
      or "clientEndUserId" = app_current_user_id()
      or "clientTeamMemberId" = app_current_user_id()
    )
  );
drop policy if exists guest_sees_own_ticket on tickets;
create policy guest_sees_own_ticket on tickets
  for select using (
    "tenantId" = app_current_tenant_id()
    and app_current_role() = 'GUEST'
    and id = app_current_guest_ticket_id()
  );

-- messages: clients never see isInternal=true rows. Same GUEST exclusion
-- reasoning as tickets above — a guest may only see/post non-internal
-- messages on the one ticket they were invited to.
drop policy if exists tenant_isolation on messages;
create policy tenant_isolation on messages
  using ("tenantId" = app_current_tenant_id() and app_current_role() <> 'GUEST');
drop policy if exists client_sees_non_internal_messages on messages;
create policy client_sees_non_internal_messages on messages
  for select using (
    "tenantId" = app_current_tenant_id()
    and app_current_role() <> 'GUEST'
    and (
      app_current_role() in ('AGENT','ADMIN','SUPER_ADMIN')
      or "isInternal" = false
    )
  );
drop policy if exists guest_sees_ticket_messages on messages;
create policy guest_sees_ticket_messages on messages
  for select using (
    "tenantId" = app_current_tenant_id()
    and app_current_role() = 'GUEST'
    and "ticketId" = app_current_guest_ticket_id()
    and "isInternal" = false
  );
drop policy if exists guest_insert_message on messages;
create policy guest_insert_message on messages
  for insert with check (
    "tenantId" = app_current_tenant_id()
    and app_current_role() = 'GUEST'
    and "ticketId" = app_current_guest_ticket_id()
    and "isInternal" = false
  );

-- attachments: NOTE — scoped only by tenantId, same as every role today
-- (including plain CLIENT); real per-ticket scoping is enforced at the app
-- layer (every attachment query filters by ticketId). GUEST rides on this
-- same pre-existing, already-app-layer-enforced pattern rather than a new
-- RLS carve-out, since attachments never had ticket-level RLS scoping to
-- begin with — see actions/attachments.ts for the query-level enforcement.
drop policy if exists tenant_isolation on attachments;
create policy tenant_isolation on attachments
  using ("tenantId" = app_current_tenant_id());

-- ticket_guests: readable tenant-wide (same app-layer-scoping note as
-- attachments above); adding/revoking a guest is restricted to staff, or a
-- client acting on their own ticket.
drop policy if exists ticket_guest_read on ticket_guests;
create policy ticket_guest_read on ticket_guests
  for select using ("tenantId" = app_current_tenant_id());
drop policy if exists ticket_guest_write on ticket_guests;
create policy ticket_guest_write on ticket_guests
  for insert with check (
    "tenantId" = app_current_tenant_id()
    and (
      app_current_role() in ('AGENT','ADMIN','SUPER_ADMIN')
      or exists (
        select 1 from tickets t
        where t.id = "ticketId"
          and (
            t."clientEndUserId" = app_current_user_id()
            or t."clientTeamMemberId" = app_current_user_id()
          )
      )
    )
  );
drop policy if exists ticket_guest_revoke on ticket_guests;
create policy ticket_guest_revoke on ticket_guests
  for update using (
    "tenantId" = app_current_tenant_id()
    and (
      app_current_role() in ('AGENT','ADMIN','SUPER_ADMIN')
      or exists (
        select 1 from tickets t
        where t.id = "ticketId"
          and (
            t."clientEndUserId" = app_current_user_id()
            or t."clientTeamMemberId" = app_current_user_id()
          )
      )
    )
  );

-- survey_responses (CSAT): the submitting visitor is never a real session —
-- actions/csat.ts verifies a signed, ticket-scoped JWT (src/lib/session.ts's
-- signCsatToken/verifyCsatToken) before ever calling withRls, then opens the
-- transaction as role SUPER_ADMIN purely to satisfy tickets' super_admin_read
-- policy for the existence check (same established pattern as the auto-close
-- Inngest cron in lib/inngest/functions/auto-close.ts) — this table's own
-- policy only needs tenantId isolation, since the token itself is what
-- proves the caller is allowed to rate this specific ticket.
drop policy if exists tenant_isolation on survey_responses;
create policy tenant_isolation on survey_responses
  using ("tenantId" = app_current_tenant_id());

-- login_otps: strictly personal, same shape as notifications — a user (or,
-- during the invite-accept flow before a real session exists, the verified
-- invite-token's own userId claim — see actions/auth.ts) only ever
-- reads/consumes their own OTP rows.
drop policy if exists login_otp_read on login_otps;
create policy login_otp_read on login_otps
  for select using (
    "tenantId" = app_current_tenant_id()
    and (
      "endUserId" = app_current_user_id()
      or "teamMemberId" = app_current_user_id()
    )
  );
drop policy if exists login_otp_insert on login_otps;
create policy login_otp_insert on login_otps
  for insert with check (
    "tenantId" = app_current_tenant_id()
    and (
      "endUserId" = app_current_user_id()
      or "teamMemberId" = app_current_user_id()
    )
  );
drop policy if exists login_otp_update on login_otps;
create policy login_otp_update on login_otps
  for update using (
    "tenantId" = app_current_tenant_id()
    and (
      "endUserId" = app_current_user_id()
      or "teamMemberId" = app_current_user_id()
    )
  );

-- audit_logs: readable by agents/admins (the tenant's full activity log),
-- OR by the row's own actor — the latter isn't for browsing, it's because
-- Prisma's .create() always does an implicit RETURNING, and Postgres checks
-- a freshly-inserted row against SELECT policies to decide whether it's
-- visible in that RETURNING output. Without "actorId = app_current_user_id()"
-- here, a CLIENT's own createTicket() audit-log insert satisfies
-- audit_log_insert's WITH CHECK but then fails anyway with "new row
-- violates row-level security policy", because nothing lets them read the
-- row back. Writable by ANY authenticated role scoped to their own tenant —
-- a client creating a ticket or replying is exactly the kind of action an
-- audit log exists to capture, so INSERT can't be role-restricted the way
-- browsing the log (the admin panel's /admin/audit-log) is.
drop policy if exists tenant_isolation on audit_logs;
drop policy if exists audit_log_read on audit_logs;
create policy audit_log_read on audit_logs
  for select using (
    "tenantId" = app_current_tenant_id()
    and (
      app_current_role() in ('AGENT','ADMIN','SUPER_ADMIN')
      or "actorEndUserId" = app_current_user_id()
      or "actorTeamMemberId" = app_current_user_id()
    )
  );
drop policy if exists audit_log_insert on audit_logs;
create policy audit_log_insert on audit_logs
  for insert with check ("tenantId" = app_current_tenant_id());
-- SUPER_ADMIN needs to write an audit entry against the TARGET tenant while
-- the acting session's own app.tenant_id is still the host tenant (starting
-- impersonation, before the impersonation cookie/session-override exists) —
-- same shape of problem as the tenant/branding/category provisioning
-- policies above, just for audit_logs specifically.
drop policy if exists super_admin_write on audit_logs;
create policy super_admin_write on audit_logs
  for all using (app_current_role() = 'SUPER_ADMIN') with check (app_current_role() = 'SUPER_ADMIN');

-- kb_articles / kb_chunks: tenant-scoped; unpublished articles hidden from clients.
drop policy if exists tenant_isolation on kb_articles;
create policy tenant_isolation on kb_articles
  using ("tenantId" = app_current_tenant_id());
drop policy if exists client_sees_published_kb on kb_articles;
create policy client_sees_published_kb on kb_articles
  for select using (
    "tenantId" = app_current_tenant_id()
    and (app_current_role() in ('AGENT','ADMIN','SUPER_ADMIN') or "isPublished" = true)
  );
drop policy if exists tenant_isolation on kb_chunks;
create policy tenant_isolation on kb_chunks
  using ("tenantId" = app_current_tenant_id());

-- M15 — Employee Service Suite tables. Strict tenant isolation on
-- every one. Approval decisions + asset writes go through server
-- actions that already gate on the caller's role; RLS is the backstop.
drop policy if exists tenant_isolation on service_catalog_items;
create policy tenant_isolation on service_catalog_items
  using ("tenantId" = app_current_tenant_id());
drop policy if exists tenant_isolation on approval_requests;
create policy tenant_isolation on approval_requests
  using ("tenantId" = app_current_tenant_id());
drop policy if exists tenant_isolation on assets;
create policy tenant_isolation on assets
  using ("tenantId" = app_current_tenant_id());
drop policy if exists tenant_isolation on asset_links;
create policy tenant_isolation on asset_links
  using ("tenantId" = app_current_tenant_id());

-- M11 — qa_rubrics + qa_scores: strict tenant isolation. Coaching
-- and flagged-queue queries run under the caller's RLS context; the
-- Inngest scorer writes qa_scores under SUPER_ADMIN system context
-- (same fan-out pattern as classify-message + cluster-kb-suggestions).
-- Spec §3 pin: "Do NOT display QA scores to end users" — enforced in
-- the app layer since RLS is not role-selective here (CLIENTs simply
-- have no route that queries qa_scores).
drop policy if exists tenant_isolation on qa_rubrics;
create policy tenant_isolation on qa_rubrics
  using ("tenantId" = app_current_tenant_id());
drop policy if exists tenant_isolation on qa_scores;
create policy tenant_isolation on qa_scores
  using ("tenantId" = app_current_tenant_id());

-- M8 — ai_tools + ai_action_logs: strict tenant isolation. Server
-- actions further gate writes to ADMIN+, and the executor writes
-- ai_action_logs under a SUPER_ADMIN system context (cron / chatbot
-- fan-out) — same pattern as classify-message.
drop policy if exists tenant_isolation on ai_tools;
create policy tenant_isolation on ai_tools
  using ("tenantId" = app_current_tenant_id());
drop policy if exists tenant_isolation on ai_action_logs;
create policy tenant_isolation on ai_action_logs
  using ("tenantId" = app_current_tenant_id());

-- M10 — kb_suggestions: tenant-scoped, admin/super_admin only. The
-- clustering cron writes rows under a SUPER_ADMIN RLS context (system
-- fan-out over tenants — same pattern as auto-close), so a plain
-- tenant_isolation policy suffices; role gating happens in the server
-- actions before writes/reads land.
drop policy if exists tenant_isolation on kb_suggestions;
create policy tenant_isolation on kb_suggestions
  using ("tenantId" = app_current_tenant_id());

-- chat_conversations / chat_messages
drop policy if exists tenant_isolation on chat_conversations;
create policy tenant_isolation on chat_conversations
  using ("tenantId" = app_current_tenant_id());
drop policy if exists tenant_isolation on chat_messages;
create policy tenant_isolation on chat_messages
  using (
    exists (
      select 1 from chat_conversations c
      where c.id = chat_messages."conversationId"
      and c."tenantId" = app_current_tenant_id()
    )
  );

-- notifications: strictly personal — a user only ever reads/marks-read
-- their own notifications, never anyone else's (unlike tickets, where
-- agents see the whole tenant queue). Insert is tenant-scoped only, not
-- restricted to "actor == recipient", because the whole point of a
-- notification is that someone ELSE's action creates it (a client's reply
-- creates a notification for the assigned agent) — see lib/notifications.ts
-- for why writes go through createMany() rather than create() to avoid the
-- RETURNING-vs-SELECT-policy trap documented on audit_logs above.
drop policy if exists tenant_isolation on notifications;
drop policy if exists notification_read on notifications;
create policy notification_read on notifications
  for select using (
    "tenantId" = app_current_tenant_id()
    and (
      "recipientEndUserId" = app_current_user_id()
      or "recipientTeamMemberId" = app_current_user_id()
    )
  );
drop policy if exists notification_insert on notifications;
create policy notification_insert on notifications
  for insert with check ("tenantId" = app_current_tenant_id());
drop policy if exists notification_update on notifications;
create policy notification_update on notifications
  for update using (
    "tenantId" = app_current_tenant_id()
    and (
      "recipientEndUserId" = app_current_user_id()
      or "recipientTeamMemberId" = app_current_user_id()
    )
  );
