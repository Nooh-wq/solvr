-- M2 — SLA & Business-Hours Engine RLS. Tables created by
-- `prisma db push`; this file adds tenant_isolation policies. Same
-- shape as Z8 tables — the app-layer editors gate who can write
-- (admin-only) and RLS enforces that no cross-tenant read or write
-- can ever slip through, even under a session with a wrong tenantId.

alter table sla_policies enable row level security;
alter table sla_policies force row level security;
drop policy if exists tenant_isolation on sla_policies;
create policy tenant_isolation on sla_policies
  using ("tenantId" = app_current_tenant_id())
  with check ("tenantId" = app_current_tenant_id());

alter table business_calendars enable row level security;
alter table business_calendars force row level security;
drop policy if exists tenant_isolation on business_calendars;
create policy tenant_isolation on business_calendars
  using ("tenantId" = app_current_tenant_id())
  with check ("tenantId" = app_current_tenant_id());

alter table ticket_slas enable row level security;
alter table ticket_slas force row level security;
drop policy if exists tenant_isolation on ticket_slas;
create policy tenant_isolation on ticket_slas
  using ("tenantId" = app_current_tenant_id())
  with check ("tenantId" = app_current_tenant_id());
