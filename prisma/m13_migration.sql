-- M13 — SavedReport RLS. Table created via `prisma db push`.

alter table saved_reports enable row level security;
alter table saved_reports force row level security;
drop policy if exists tenant_isolation on saved_reports;
create policy tenant_isolation on saved_reports
  using ("tenantId" = app_current_tenant_id())
  with check ("tenantId" = app_current_tenant_id());
