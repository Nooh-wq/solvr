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
--   app.tenant_id  -- current tenant's id
--   app.user_id    -- current user's id ('' for anonymous/chatbot)
--   app.role       -- CLIENT | AGENT | ADMIN | SUPER_ADMIN
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
    'tenant_branding','users','categories','tickets','messages',
    'attachments','audit_logs','kb_articles','kb_chunks',
    'chatbot_configs','chat_conversations','chat_messages','notifications'
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

-- users
drop policy if exists tenant_isolation on users;
create policy tenant_isolation on users
  using ("tenantId" = app_current_tenant_id());
-- SUPER_ADMIN can create the initial admin user while provisioning a new
-- tenant (see the categories/tenant_branding comment above for why this
-- can't just be scoped by tenantId).
drop policy if exists super_admin_write on users;
create policy super_admin_write on users
  for all using (app_current_role() = 'SUPER_ADMIN') with check (app_current_role() = 'SUPER_ADMIN');

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
drop policy if exists tenant_isolation on tickets;
create policy tenant_isolation on tickets
  using ("tenantId" = app_current_tenant_id());
drop policy if exists super_admin_read on tickets;
create policy super_admin_read on tickets
  for select using (app_current_role() = 'SUPER_ADMIN');
drop policy if exists client_sees_own_tickets on tickets;
create policy client_sees_own_tickets on tickets
  for select using (
    "tenantId" = app_current_tenant_id()
    and (
      app_current_role() in ('AGENT','ADMIN','SUPER_ADMIN')
      or "clientId" = app_current_user_id()
    )
  );

-- messages: clients never see isInternal=true rows.
drop policy if exists tenant_isolation on messages;
create policy tenant_isolation on messages
  using ("tenantId" = app_current_tenant_id());
drop policy if exists client_sees_non_internal_messages on messages;
create policy client_sees_non_internal_messages on messages
  for select using (
    "tenantId" = app_current_tenant_id()
    and (
      app_current_role() in ('AGENT','ADMIN','SUPER_ADMIN')
      or "isInternal" = false
    )
  );

-- attachments
drop policy if exists tenant_isolation on attachments;
create policy tenant_isolation on attachments
  using ("tenantId" = app_current_tenant_id());

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
      or "actorId" = app_current_user_id()
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
  for select using ("tenantId" = app_current_tenant_id() and "userId" = app_current_user_id());
drop policy if exists notification_insert on notifications;
create policy notification_insert on notifications
  for insert with check ("tenantId" = app_current_tenant_id());
drop policy if exists notification_update on notifications;
create policy notification_update on notifications
  for update using ("tenantId" = app_current_tenant_id() and "userId" = app_current_user_id());
