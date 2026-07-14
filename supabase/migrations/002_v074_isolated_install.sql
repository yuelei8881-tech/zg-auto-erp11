-- Z&G AUTO ERP v0.74.0 正式服务器安装脚本
-- 使用 zg_ 前缀，不删除、不覆盖 Supabase 中已有的旧表。

begin;

create extension if not exists pgcrypto;

create table if not exists public.zg_organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  timezone text not null default 'America/Los_Angeles',
  currency text not null default 'USD',
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.zg_organization_members (
  organization_id uuid not null references public.zg_organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner','manager','frontdesk','technician','finance','warehouse')),
  status text not null default 'active' check (status in ('active','disabled')),
  display_name text,
  phone text,
  permissions jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create table if not exists public.zg_erp_records (
  organization_id uuid not null references public.zg_organizations(id) on delete cascade,
  module text not null,
  record_id uuid not null,
  payload jsonb not null default '{}'::jsonb,
  created_by uuid not null default auth.uid() references auth.users(id),
  updated_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, module, record_id)
);

create index if not exists zg_erp_records_module_idx
  on public.zg_erp_records (organization_id, module, updated_at desc);
create index if not exists zg_erp_records_payload_gin
  on public.zg_erp_records using gin (payload);

create table if not exists public.zg_audit_logs (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.zg_organizations(id) on delete cascade,
  actor_id uuid references auth.users(id),
  action text not null,
  module text not null,
  record_id uuid,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.zg_staff_invites (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.zg_organizations(id) on delete cascade,
  email text not null,
  role text not null check (role in ('manager','frontdesk','technician','finance','warehouse')),
  invited_by uuid not null references auth.users(id),
  status text not null default 'pending' check (status in ('pending','accepted','cancelled','expired')),
  expires_at timestamptz not null default now() + interval '7 days',
  created_at timestamptz not null default now()
);

create table if not exists public.zg_file_assets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.zg_organizations(id) on delete cascade,
  module text not null,
  record_id uuid not null,
  category text not null,
  storage_path text not null,
  original_name text not null,
  content_type text,
  size_bytes bigint,
  uploaded_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now()
);

create or replace function public.zg_is_org_member(p_org uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.zg_organization_members
    where organization_id = p_org and user_id = auth.uid() and status = 'active'
  );
$$;

create or replace function public.zg_has_org_role(p_org uuid, p_roles text[])
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.zg_organization_members
    where organization_id = p_org and user_id = auth.uid()
      and status = 'active' and role = any(p_roles)
  );
$$;

create or replace function public.zg_bootstrap_organization(p_name text)
returns uuid language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_org uuid;
begin
  if v_user is null then raise exception 'Authentication required'; end if;

  select organization_id into v_org
  from public.zg_organization_members
  where user_id = v_user and status = 'active'
  limit 1;

  if v_org is not null then return v_org; end if;

  insert into public.zg_organizations (name, created_by)
  values (coalesce(nullif(trim(p_name), ''), 'Z&G AUTO REPAIR'), v_user)
  returning id into v_org;

  insert into public.zg_organization_members (organization_id, user_id, role, status)
  values (v_org, v_user, 'owner', 'active');

  return v_org;
end;
$$;

create or replace function public.zg_set_updated_at()
returns trigger language plpgsql set search_path = public
as $$ begin new.updated_at = now(); return new; end; $$;

create or replace function public.zg_audit_erp_record()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  v_org uuid;
  v_module text;
  v_record uuid;
begin
  if tg_op = 'DELETE' then
    v_org := old.organization_id; v_module := old.module; v_record := old.record_id;
  else
    v_org := new.organization_id; v_module := new.module; v_record := new.record_id;
  end if;
  insert into public.zg_audit_logs
    (organization_id, actor_id, action, module, record_id, before_data, after_data)
  values (
    v_org, auth.uid(), tg_op, v_module, v_record,
    case when tg_op in ('UPDATE','DELETE') then old.payload else null end,
    case when tg_op in ('INSERT','UPDATE') then new.payload else null end
  );
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists zg_organizations_updated_at on public.zg_organizations;
create trigger zg_organizations_updated_at before update on public.zg_organizations
for each row execute function public.zg_set_updated_at();
drop trigger if exists zg_erp_records_updated_at on public.zg_erp_records;
create trigger zg_erp_records_updated_at before update on public.zg_erp_records
for each row execute function public.zg_set_updated_at();
drop trigger if exists zg_erp_records_audit on public.zg_erp_records;
create trigger zg_erp_records_audit after insert or update or delete on public.zg_erp_records
for each row execute function public.zg_audit_erp_record();

alter table public.zg_organizations enable row level security;
alter table public.zg_organization_members enable row level security;
alter table public.zg_erp_records enable row level security;
alter table public.zg_audit_logs enable row level security;
alter table public.zg_staff_invites enable row level security;
alter table public.zg_file_assets enable row level security;

drop policy if exists zg_organizations_read on public.zg_organizations;
create policy zg_organizations_read on public.zg_organizations for select
using (public.zg_is_org_member(id));
drop policy if exists zg_organizations_update on public.zg_organizations;
create policy zg_organizations_update on public.zg_organizations for update
using (public.zg_has_org_role(id, array['owner','manager']));

drop policy if exists zg_members_read on public.zg_organization_members;
create policy zg_members_read on public.zg_organization_members for select
using (public.zg_is_org_member(organization_id));
drop policy if exists zg_members_manage on public.zg_organization_members;
create policy zg_members_manage on public.zg_organization_members for all
using (public.zg_has_org_role(organization_id, array['owner','manager']))
with check (public.zg_has_org_role(organization_id, array['owner','manager']));

drop policy if exists zg_records_read on public.zg_erp_records;
create policy zg_records_read on public.zg_erp_records for select
using (public.zg_is_org_member(organization_id));
drop policy if exists zg_records_insert on public.zg_erp_records;
create policy zg_records_insert on public.zg_erp_records for insert
with check (public.zg_is_org_member(organization_id));
drop policy if exists zg_records_update on public.zg_erp_records;
create policy zg_records_update on public.zg_erp_records for update
using (public.zg_is_org_member(organization_id))
with check (public.zg_is_org_member(organization_id));
drop policy if exists zg_records_delete on public.zg_erp_records;
create policy zg_records_delete on public.zg_erp_records for delete
using (public.zg_has_org_role(organization_id, array['owner','manager','frontdesk','finance','warehouse']));

drop policy if exists zg_audit_read on public.zg_audit_logs;
create policy zg_audit_read on public.zg_audit_logs for select
using (public.zg_has_org_role(organization_id, array['owner','manager','finance']));

drop policy if exists zg_invites_manage on public.zg_staff_invites;
create policy zg_invites_manage on public.zg_staff_invites for all
using (public.zg_has_org_role(organization_id, array['owner','manager']))
with check (public.zg_has_org_role(organization_id, array['owner','manager']));

drop policy if exists zg_files_read on public.zg_file_assets;
create policy zg_files_read on public.zg_file_assets for select
using (public.zg_is_org_member(organization_id));
drop policy if exists zg_files_insert on public.zg_file_assets;
create policy zg_files_insert on public.zg_file_assets for insert
with check (public.zg_is_org_member(organization_id));
drop policy if exists zg_files_delete on public.zg_file_assets;
create policy zg_files_delete on public.zg_file_assets for delete
using (public.zg_has_org_role(organization_id, array['owner','manager','frontdesk']));

grant select, insert, update, delete on public.zg_organizations to authenticated;
grant select, insert, update, delete on public.zg_organization_members to authenticated;
grant select, insert, update, delete on public.zg_erp_records to authenticated;
grant select on public.zg_audit_logs to authenticated;
grant select, insert, update, delete on public.zg_staff_invites to authenticated;
grant select, insert, update, delete on public.zg_file_assets to authenticated;
grant usage, select on sequence public.zg_audit_logs_id_seq to authenticated;
grant execute on function public.zg_bootstrap_organization(text) to authenticated;
grant execute on function public.zg_is_org_member(uuid) to authenticated;
grant execute on function public.zg_has_org_role(uuid,text[]) to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'zg_erp_records'
  ) then
    alter publication supabase_realtime add table public.zg_erp_records;
  end if;
end $$;

commit;
