begin;

create extension if not exists pgcrypto;

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  timezone text not null default 'America/Los_Angeles',
  currency text not null default 'USD',
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.organization_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner','manager','frontdesk','technician','finance','warehouse')),
  status text not null default 'active' check (status in ('active','disabled')),
  display_name text,
  phone text,
  permissions jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create table if not exists public.erp_records (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  module text not null,
  record_id uuid not null,
  payload jsonb not null default '{}'::jsonb,
  created_by uuid not null default auth.uid() references auth.users(id),
  updated_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, module, record_id)
);

create index if not exists erp_records_module_idx
  on public.erp_records (organization_id, module, updated_at desc);
create index if not exists erp_records_payload_gin
  on public.erp_records using gin (payload);

create table if not exists public.audit_logs (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_id uuid references auth.users(id),
  action text not null,
  module text not null,
  record_id uuid,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.staff_invites (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email text not null,
  role text not null check (role in ('manager','frontdesk','technician','finance','warehouse')),
  invited_by uuid not null references auth.users(id),
  status text not null default 'pending' check (status in ('pending','accepted','cancelled','expired')),
  expires_at timestamptz not null default now() + interval '7 days',
  created_at timestamptz not null default now()
);

create table if not exists public.file_assets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
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

create or replace function public.is_org_member(p_org uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.organization_members
    where organization_id = p_org and user_id = auth.uid() and status = 'active'
  );
$$;

create or replace function public.has_org_role(p_org uuid, p_roles text[])
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.organization_members
    where organization_id = p_org and user_id = auth.uid() and status = 'active' and role = any(p_roles)
  );
$$;

create or replace function public.bootstrap_organization(p_name text)
returns uuid language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_org uuid;
begin
  if v_user is null then raise exception 'Authentication required'; end if;

  select organization_id into v_org
  from public.organization_members
  where user_id = v_user and status = 'active'
  limit 1;

  if v_org is not null then return v_org; end if;

  insert into public.organizations (name, created_by)
  values (coalesce(nullif(trim(p_name), ''), 'Z&G AUTO REPAIR'), v_user)
  returning id into v_org;

  insert into public.organization_members (organization_id, user_id, role, status)
  values (v_org, v_user, 'owner', 'active');

  return v_org;
end;
$$;

create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = public
as $$ begin new.updated_at = now(); return new; end; $$;

create or replace function public.audit_erp_record()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.audit_logs (organization_id, actor_id, action, module, record_id, before_data, after_data)
  values (
    coalesce(new.organization_id, old.organization_id), auth.uid(), tg_op,
    coalesce(new.module, old.module), coalesce(new.record_id, old.record_id),
    case when tg_op in ('UPDATE','DELETE') then old.payload else null end,
    case when tg_op in ('INSERT','UPDATE') then new.payload else null end
  );
  return coalesce(new, old);
end;
$$;

drop trigger if exists organizations_updated_at on public.organizations;
create trigger organizations_updated_at before update on public.organizations
for each row execute function public.set_updated_at();
drop trigger if exists erp_records_updated_at on public.erp_records;
create trigger erp_records_updated_at before update on public.erp_records
for each row execute function public.set_updated_at();
drop trigger if exists erp_records_audit on public.erp_records;
create trigger erp_records_audit after insert or update or delete on public.erp_records
for each row execute function public.audit_erp_record();

alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.erp_records enable row level security;
alter table public.audit_logs enable row level security;
alter table public.staff_invites enable row level security;
alter table public.file_assets enable row level security;

drop policy if exists organizations_read on public.organizations;
create policy organizations_read on public.organizations for select using (public.is_org_member(id));
drop policy if exists organizations_update on public.organizations;
create policy organizations_update on public.organizations for update using (public.has_org_role(id, array['owner','manager']));

drop policy if exists members_read on public.organization_members;
create policy members_read on public.organization_members for select using (public.is_org_member(organization_id));
drop policy if exists members_manage on public.organization_members;
create policy members_manage on public.organization_members for all
using (public.has_org_role(organization_id, array['owner','manager']))
with check (public.has_org_role(organization_id, array['owner','manager']));

drop policy if exists records_read on public.erp_records;
create policy records_read on public.erp_records for select using (public.is_org_member(organization_id));
drop policy if exists records_insert on public.erp_records;
create policy records_insert on public.erp_records for insert with check (public.is_org_member(organization_id));
drop policy if exists records_update on public.erp_records;
create policy records_update on public.erp_records for update using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));
drop policy if exists records_delete on public.erp_records;
create policy records_delete on public.erp_records for delete using (public.has_org_role(organization_id, array['owner','manager','frontdesk','finance','warehouse']));

drop policy if exists audit_read on public.audit_logs;
create policy audit_read on public.audit_logs for select using (public.has_org_role(organization_id, array['owner','manager','finance']));

drop policy if exists invites_manage on public.staff_invites;
create policy invites_manage on public.staff_invites for all
using (public.has_org_role(organization_id, array['owner','manager']))
with check (public.has_org_role(organization_id, array['owner','manager']));

drop policy if exists files_read on public.file_assets;
create policy files_read on public.file_assets for select using (public.is_org_member(organization_id));
drop policy if exists files_insert on public.file_assets;
create policy files_insert on public.file_assets for insert with check (public.is_org_member(organization_id));
drop policy if exists files_delete on public.file_assets;
create policy files_delete on public.file_assets for delete using (public.has_org_role(organization_id, array['owner','manager','frontdesk']));

grant execute on function public.bootstrap_organization(text) to authenticated;
grant execute on function public.is_org_member(uuid) to authenticated;
grant execute on function public.has_org_role(uuid,text[]) to authenticated;

commit;
