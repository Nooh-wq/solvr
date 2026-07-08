-- Z6 DoD closure — ticket_views table + RLS. Tracks per-agent
-- last-viewed timestamps so real "unread" counts can drive the Views
-- sidebar.

create table if not exists ticket_views (
  "subjectId"     text not null,
  "ticketId"      text not null references tickets(id) on delete cascade,
  "tenantId"      text not null references tenants(id) on delete cascade,
  "lastViewedAt"  timestamptz not null default now(),
  primary key ("subjectId", "ticketId")
);

create index if not exists ticket_views_tenant_subject_idx
  on ticket_views ("tenantId", "subjectId");

alter table ticket_views enable row level security;
alter table ticket_views force row level security;

drop policy if exists tenant_isolation on ticket_views;
create policy tenant_isolation on ticket_views
  using ("tenantId" = app_current_tenant_id());

-- Owner-only visibility. An agent's read history is per-agent — no
-- other agent needs to see it.
drop policy if exists ticket_view_owner_only on ticket_views;
create policy ticket_view_owner_only on ticket_views
  using (
    "tenantId" = app_current_tenant_id()
    and "subjectId" = app_current_user_id()
  )
  with check (
    "tenantId" = app_current_tenant_id()
    and "subjectId" = app_current_user_id()
  );
