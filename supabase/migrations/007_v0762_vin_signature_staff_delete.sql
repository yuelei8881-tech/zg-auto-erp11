-- Z&G AUTO ERP v0.76.2
-- VIN photo recognition and customer signatures are stored in the existing
-- JSON work-order record. This migration adds owner-controlled staff deletion.

create or replace function public.zg_delete_staff_by_email(p_email text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_target uuid;
  v_email text := lower(trim(coalesce(p_email, '')));
  v_invites integer := 0;
begin
  if v_email = '' then raise exception 'Email is required'; end if;

  select organization_id into v_org
  from public.zg_organization_members
  where user_id = auth.uid() and role = 'owner' and status = 'active'
  limit 1;
  if v_org is null then raise exception 'Only the organization owner can delete staff'; end if;

  select id into v_target from auth.users where lower(email) = v_email limit 1;
  if v_target is not null and exists (
    select 1 from public.zg_organization_members
    where organization_id = v_org and user_id = v_target and role = 'owner'
  ) then
    raise exception 'The owner account cannot be deleted';
  end if;

  delete from public.zg_staff_invites
  where organization_id = v_org and lower(email) = v_email;
  get diagnostics v_invites = row_count;

  if v_target is null then return v_invites > 0; end if;

  insert into public.zg_audit_logs
    (organization_id, actor_id, action, module, record_id, before_data, after_data)
  select v_org, auth.uid(), 'DELETE_STAFF', 'staff', v_target,
    jsonb_build_object('email', v_email, 'role', role, 'status', status), null
  from public.zg_organization_members
  where organization_id = v_org and user_id = v_target;

  delete from public.zg_organization_members
  where organization_id = v_org and user_id = v_target;

  if not exists (select 1 from public.zg_organization_members where user_id = v_target) then
    delete from auth.users where id = v_target;
  end if;
  return true;
end;
$$;

revoke all on function public.zg_delete_staff_by_email(text) from public;
grant execute on function public.zg_delete_staff_by_email(text) to authenticated;

-- One-time cleanup explicitly requested by the shop owner.
do $$
declare
  v_email text := 'tingzhang0808@gmail.com';
  v_target uuid;
begin
  select id into v_target from auth.users where lower(email) = v_email limit 1;
  if v_target is not null and exists (
    select 1 from public.zg_organization_members where user_id = v_target and role = 'owner'
  ) then
    raise notice 'Skipped owner account %', v_email;
    return;
  end if;

  delete from public.zg_staff_invites where lower(email) = v_email;
  if v_target is not null then
    delete from public.zg_organization_members where user_id = v_target;
    delete from auth.users where id = v_target;
  end if;
end;
$$;
