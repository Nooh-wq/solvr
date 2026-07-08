-- M3 — Routing & Assignment Engine. Tables created by `prisma db push`;
-- this file adds tenant_isolation RLS in the same shape as Z8/M2.

alter table agent_profiles enable row level security;
alter table agent_profiles force row level security;
drop policy if exists tenant_isolation on agent_profiles;
create policy tenant_isolation on agent_profiles
  using ("tenantId" = app_current_tenant_id())
  with check ("tenantId" = app_current_tenant_id());

alter table auto_assignment_logs enable row level security;
alter table auto_assignment_logs force row level security;
drop policy if exists tenant_isolation on auto_assignment_logs;
create policy tenant_isolation on auto_assignment_logs
  using ("tenantId" = app_current_tenant_id())
  with check ("tenantId" = app_current_tenant_id());
