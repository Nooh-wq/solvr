-- Z6.1 — saved_views table + RLS. Support-owned, tenant-scoped.
-- Idempotent (safe to re-run). Applied via `prisma db push` in this repo
-- (not `migrate dev` — history is out of sync, see docs/shared-platform-boundary.md).

create table if not exists saved_views (
  id                   text primary key,
  "tenantId"           text not null references tenants(id) on delete cascade,
  "ownerTeamMemberId"  text,
  name                 text not null,
  filters              jsonb not null default '{}'::jsonb,
  sort                 jsonb not null default '{"key":"updatedAt","dir":"desc"}'::jsonb,
  "isDefault"          boolean not null default false,
  "createdAt"          timestamptz not null default now(),
  "updatedAt"          timestamptz not null default now()
);

create index if not exists saved_views_tenant_owner_idx
  on saved_views ("tenantId", "ownerTeamMemberId");

-- Z6.5 — prevent duplicate shared-view seeding on races. Personal views
-- (ownerTeamMemberId is not null) can freely have duplicate names.
create unique index if not exists saved_views_tenant_shared_name_uq
  on saved_views ("tenantId", name)
  where "ownerTeamMemberId" is null;

alter table saved_views enable row level security;
alter table saved_views force row level security;

-- tenant_isolation: baseline row visibility — this row's tenant matches the
-- session's tenant. Owner-level scoping happens in the personal_view
-- policy below (add rather than replace, so shared views (Z6.5) can be
-- read tenant-wide when ownerTeamMemberId is null).
drop policy if exists tenant_isolation on saved_views;
create policy tenant_isolation on saved_views
  using ("tenantId" = app_current_tenant_id());

-- Personal view: readable/writable only by its owner, agents+ role.
-- Shared views (ownerTeamMemberId IS NULL) fall out of this policy and
-- match the tenant_isolation base — that's Z6.5's read path.
drop policy if exists personal_view_owner_only on saved_views;
create policy personal_view_owner_only on saved_views
  using (
    "tenantId" = app_current_tenant_id()
    and ("ownerTeamMemberId" is null or "ownerTeamMemberId" = app_current_user_id())
  )
  with check (
    "tenantId" = app_current_tenant_id()
    and ("ownerTeamMemberId" is null or "ownerTeamMemberId" = app_current_user_id())
  );
