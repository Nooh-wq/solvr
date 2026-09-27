-- M13 gap-closing migration. `prisma db push` handles the column
-- changes on saved_reports (drop scheduleCron, add
-- scheduleFrequency/scheduleHour/nextRunAt), and creates ticket_daily_rollups.
-- This SQL only reasserts RLS: db push does not preserve RLS on
-- alter/re-create, and ticket_daily_rollups is brand new.

alter table saved_reports enable row level security;
alter table saved_reports force row level security;
drop policy if exists tenant_isolation on saved_reports;
create policy tenant_isolation on saved_reports
  using ("tenantId" = app_current_tenant_id())
  with check ("tenantId" = app_current_tenant_id());

alter table ticket_daily_rollups enable row level security;
alter table ticket_daily_rollups force row level security;
drop policy if exists tenant_isolation on ticket_daily_rollups;
create policy tenant_isolation on ticket_daily_rollups
  using ("tenantId" = app_current_tenant_id())
  with check ("tenantId" = app_current_tenant_id());
