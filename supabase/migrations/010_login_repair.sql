-- Non-destructive login and organization membership recovery.
-- Existing ERP records and staff records are preserved.

drop policy if exists zg_members_self_read on public.zg_organization_members;
create policy zg_members_self_read
on public.zg_organization_members
for select
to authenticated
using (user_id = auth.uid());

create or replace function public.zg_bootstrap_organization(p_name text default 'Z&G AUTO REPAIR')
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user uuid := auth.uid();
  v_org uuid;
begin
  if v_user is null then
    raise exception 'Authentication required';
  end if;

  select organization_id into v_org
  from public.zg_organization_members
  where user_id = v_user and status = 'active'
  order by created_at
  limit 1;

  if v_org is not null then
    return v_org;
  end if;

  select id into v_org
  from public.zg_organizations
  where created_by = v_user
  order by created_at
  limit 1;

  if v_org is null then
    insert into public.zg_organizations(name, created_by)
    values (coalesce(nullif(trim(p_name), ''), 'Z&G AUTO REPAIR'), v_user)
    returning id into v_org;
  end if;

  insert into public.zg_organization_members
    (organization_id, user_id, role, status, display_name, permissions)
  values
    (v_org, v_user, 'owner', 'active', coalesce(auth.jwt() ->> 'email', 'Owner'), '{}'::jsonb)
  on conflict (organization_id, user_id)
  do update set status = 'active', role = 'owner';

  return v_org;
end;
$$;

grant execute on function public.zg_bootstrap_organization(text) to authenticated;
