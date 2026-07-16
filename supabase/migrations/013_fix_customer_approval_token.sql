-- Supabase installs pgcrypto in the extensions schema. The approval function
-- uses a restricted search_path, so the random-byte generator must be schema-qualified.
create or replace function public.zg_create_customer_approval(
  p_organization_id uuid,
  p_work_order_id uuid,
  p_customer_email text,
  p_customer_name text,
  p_snapshot jsonb
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token text;
begin
  if not public.zg_is_org_member(p_organization_id) then
    raise exception 'Not authorized';
  end if;

  v_token := encode(extensions.gen_random_bytes(24), 'hex');

  update public.zg_customer_approvals
  set status = 'expired'
  where organization_id = p_organization_id
    and work_order_id = p_work_order_id
    and status = 'pending';

  insert into public.zg_customer_approvals(
    organization_id, work_order_id, token_hash, snapshot,
    customer_email, customer_name, created_by
  ) values (
    p_organization_id,
    p_work_order_id,
    encode(extensions.digest(v_token, 'sha256'), 'hex'),
    coalesce(p_snapshot, '{}'::jsonb),
    p_customer_email,
    p_customer_name,
    auth.uid()
  );

  return v_token;
end
$$;

revoke all on function public.zg_create_customer_approval(uuid,uuid,text,text,jsonb) from public;
grant execute on function public.zg_create_customer_approval(uuid,uuid,text,text,jsonb) to authenticated;
