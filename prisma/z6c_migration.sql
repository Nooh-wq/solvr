-- Z6.4 — macros table + RLS. Same shape as canned_responses: personal
-- to a team member, or shared (owner NULL) with admin-only writes.

create table if not exists macros (
  id                   text primary key,
  "tenantId"           text not null references tenants(id) on delete cascade,
  "ownerTeamMemberId"  text,
  name                 text not null,
  description          text,
  actions              jsonb not null default '[]'::jsonb,
  "createdAt"          timestamptz not null default now(),
  "updatedAt"          timestamptz not null default now()
);

create index if not exists macros_tenant_owner_idx
  on macros ("tenantId", "ownerTeamMemberId");

alter table macros enable row level security;
alter table macros force row level security;

drop policy if exists tenant_isolation on macros;
create policy tenant_isolation on macros
  using ("tenantId" = app_current_tenant_id());

drop policy if exists macro_visibility on macros;
create policy macro_visibility on macros
  for select using (
    "tenantId" = app_current_tenant_id()
    and ("ownerTeamMemberId" is null or "ownerTeamMemberId" = app_current_user_id())
  );

drop policy if exists macro_owner_write on macros;
create policy macro_owner_write on macros
  for all using (
    "tenantId" = app_current_tenant_id()
    and (
      "ownerTeamMemberId" = app_current_user_id()
      or (
        "ownerTeamMemberId" is null
        and app_current_role() in ('ADMIN', 'SUPER_ADMIN')
      )
    )
  ) with check (
    "tenantId" = app_current_tenant_id()
    and (
      "ownerTeamMemberId" = app_current_user_id()
      or (
        "ownerTeamMemberId" is null
        and app_current_role() in ('ADMIN', 'SUPER_ADMIN')
      )
    )
  );
