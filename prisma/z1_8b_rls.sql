-- Z1.8b RLS policies for Z1.8a's new tables.
--
-- Z1.8a added auth_credentials, team_member_lifecycle, end_user_lifecycle
-- without RLS enabled (Prisma db push doesn't manage RLS). Z1.8b's auth flows
-- read from these tables during login/register/reset/invite-accept, so tenant
-- isolation needs to be enforced at the DB level, matching every other
-- Support-owned table.
--
-- Pattern mirrors users / login_otps / etc:
--   1. Enable + force RLS on each table.
--   2. tenant_isolation policy — rows match app.tenant_id.
--   3. super_admin_write additive policy — SUPER_ADMIN sessions can seed
--      initial credentials + lifecycle rows for newly-provisioned tenants
--      before app.tenant_id is set to the new tenant's id (same reasoning as
--      users' super_admin_write policy).
--
-- Apply with:
--   npx prisma db execute --file prisma/z1_8b_rls.sql --schema prisma/schema.prisma
-- Safe to re-run — every policy is drop-if-exists + recreate.

do $$
declare
  t text;
begin
  for t in select unnest(array[
    'auth_credentials','team_member_lifecycle','end_user_lifecycle'
  ])
  loop
    execute format('alter table %I enable row level security;', t);
    execute format('alter table %I force row level security;', t);
  end loop;
end $$;

-- auth_credentials
drop policy if exists tenant_isolation on auth_credentials;
create policy tenant_isolation on auth_credentials
  using ("tenantId" = app_current_tenant_id());
drop policy if exists super_admin_write on auth_credentials;
create policy super_admin_write on auth_credentials
  for all using (app_current_role() = 'SUPER_ADMIN') with check (app_current_role() = 'SUPER_ADMIN');

-- team_member_lifecycle
drop policy if exists tenant_isolation on team_member_lifecycle;
create policy tenant_isolation on team_member_lifecycle
  using ("tenantId" = app_current_tenant_id());
drop policy if exists super_admin_write on team_member_lifecycle;
create policy super_admin_write on team_member_lifecycle
  for all using (app_current_role() = 'SUPER_ADMIN') with check (app_current_role() = 'SUPER_ADMIN');

-- end_user_lifecycle
drop policy if exists tenant_isolation on end_user_lifecycle;
create policy tenant_isolation on end_user_lifecycle
  using ("tenantId" = app_current_tenant_id());
drop policy if exists super_admin_write on end_user_lifecycle;
create policy super_admin_write on end_user_lifecycle
  for all using (app_current_role() = 'SUPER_ADMIN') with check (app_current_role() = 'SUPER_ADMIN');
