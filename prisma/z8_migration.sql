-- Z8 — Workflow engine RLS. Tables (rules, rule_run_logs,
-- escalation_paths, escalation_logs) are created by `prisma db push`;
-- this file adds the RLS policies. Same shape as every other
-- Support-owned Z6 table — tenant_isolation is the only policy needed;
-- admin-vs-agent gating lives at the app layer since the "who can see
-- which rules" question is coarser than most (any admin can see every
-- rule in their tenant).

alter table rules enable row level security;
alter table rules force row level security;
drop policy if exists tenant_isolation on rules;
create policy tenant_isolation on rules
  using ("tenantId" = app_current_tenant_id())
  with check ("tenantId" = app_current_tenant_id());

alter table rule_run_logs enable row level security;
alter table rule_run_logs force row level security;
drop policy if exists tenant_isolation on rule_run_logs;
create policy tenant_isolation on rule_run_logs
  using ("tenantId" = app_current_tenant_id())
  with check ("tenantId" = app_current_tenant_id());

alter table escalation_paths enable row level security;
alter table escalation_paths force row level security;
drop policy if exists tenant_isolation on escalation_paths;
create policy tenant_isolation on escalation_paths
  using ("tenantId" = app_current_tenant_id())
  with check ("tenantId" = app_current_tenant_id());

alter table escalation_logs enable row level security;
alter table escalation_logs force row level security;
drop policy if exists tenant_isolation on escalation_logs;
create policy tenant_isolation on escalation_logs
  using ("tenantId" = app_current_tenant_id())
  with check ("tenantId" = app_current_tenant_id());
