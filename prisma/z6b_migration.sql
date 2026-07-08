-- Z6.3 — canned_responses + RLS. Support-owned, tenant-scoped.
-- Idempotent. Apply via `prisma db push` for the schema and split-and-run
-- for the policies (see prior migration scripts for the split runner).

create table if not exists canned_responses (
  id                   text primary key,
  "tenantId"           text not null references tenants(id) on delete cascade,
  "ownerTeamMemberId"  text,
  name                 text not null,
  shortcut             text not null,
  body                 text not null,
  "createdAt"          timestamptz not null default now(),
  "updatedAt"          timestamptz not null default now()
);

create unique index if not exists canned_responses_tenant_owner_shortcut_uq
  on canned_responses ("tenantId", "ownerTeamMemberId", shortcut);

create index if not exists canned_responses_tenant_owner_idx
  on canned_responses ("tenantId", "ownerTeamMemberId");

alter table canned_responses enable row level security;
alter table canned_responses force row level security;

-- Baseline tenant isolation. Personal-vs-shared visibility layered on top.
drop policy if exists tenant_isolation on canned_responses;
create policy tenant_isolation on canned_responses
  using ("tenantId" = app_current_tenant_id());

-- Read: personal responses only readable by owner; shared (null owner)
-- readable tenant-wide.
drop policy if exists canned_response_visibility on canned_responses;
create policy canned_response_visibility on canned_responses
  for select using (
    "tenantId" = app_current_tenant_id()
    and ("ownerTeamMemberId" is null or "ownerTeamMemberId" = app_current_user_id())
  );

-- Write: personal responses writable by owner; shared responses writable
-- by admins (permission catalog wiring lands in Z6.5 companion pass;
-- until then, role tier is the gate).
drop policy if exists canned_response_owner_write on canned_responses;
create policy canned_response_owner_write on canned_responses
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
