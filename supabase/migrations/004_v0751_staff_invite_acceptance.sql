create or replace function public.zg_accept_staff_invite()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_invite public.zg_staff_invites%rowtype;
begin
  if v_user is null or v_email = '' then
    raise exception 'not authenticated';
  end if;

  select * into v_invite
  from public.zg_staff_invites
  where lower(email) = v_email
    and status = 'pending'
    and (expires_at is null or expires_at > now())
  order by created_at desc
  limit 1;

  if v_invite.id is null then
    return null;
  end if;

  insert into public.zg_organization_members
    (organization_id, user_id, role, status, display_name, permissions)
  values
    (v_invite.organization_id, v_user, v_invite.role, 'active', split_part(v_email, '@', 1), '{}'::jsonb)
  on conflict (organization_id, user_id)
  do update set role = excluded.role, status = 'active';

  update public.zg_staff_invites
  set status = 'accepted'
  where id = v_invite.id;

  return v_invite.organization_id;
end;
$$;

grant execute on function public.zg_accept_staff_invite() to authenticated;
