-- M5 — CSAT & Feedback Surveys RLS. Tables created via `prisma db push`.
-- Same tenant_isolation shape as every other Support-owned table.

alter table survey_responses enable row level security;
alter table survey_responses force row level security;
drop policy if exists tenant_isolation on survey_responses;
create policy tenant_isolation on survey_responses
  using ("tenantId" = app_current_tenant_id())
  with check ("tenantId" = app_current_tenant_id());

alter table csat_queue enable row level security;
alter table csat_queue force row level security;
drop policy if exists tenant_isolation on csat_queue;
create policy tenant_isolation on csat_queue
  using ("tenantId" = app_current_tenant_id())
  with check ("tenantId" = app_current_tenant_id());

alter table csat_settings enable row level security;
alter table csat_settings force row level security;
drop policy if exists tenant_isolation on csat_settings;
create policy tenant_isolation on csat_settings
  using ("tenantId" = app_current_tenant_id())
  with check ("tenantId" = app_current_tenant_id());
