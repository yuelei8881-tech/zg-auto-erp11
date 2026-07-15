-- v0.76.3 additive upgrade: employees may update only their own name/phone.
-- This migration does not delete or replace any business records.
create or replace function public.zg_update_own_profile(
  p_display_name text,
  p_phone text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if nullif(trim(p_display_name), '') is null then
    raise exception 'Display name is required';
  end if;

  update public.zg_organization_members
  set display_name = trim(p_display_name),
      phone = nullif(trim(coalesce(p_phone, '')), '')
  where user_id = auth.uid()
    and status = 'active';

  if not found then
    raise exception 'Active membership not found';
  end if;
end;
$$;

grant execute on function public.zg_update_own_profile(text, text) to authenticated;
