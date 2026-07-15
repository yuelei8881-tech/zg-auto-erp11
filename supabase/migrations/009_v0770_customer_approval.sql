create extension if not exists pgcrypto;

create table if not exists public.zg_customer_approvals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.zg_organizations(id) on delete cascade,
  work_order_id uuid not null,
  token_hash text not null unique,
  snapshot jsonb not null default '{}'::jsonb,
  customer_email text,
  customer_name text,
  status text not null default 'pending' check (status in ('pending','approved','rejected','expired')),
  decision_note text,
  signature_data text,
  decided_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '14 days')
);

alter table public.zg_customer_approvals enable row level security;
drop policy if exists zg_customer_approvals_read on public.zg_customer_approvals;
create policy zg_customer_approvals_read on public.zg_customer_approvals for select to authenticated
using (public.zg_is_org_member(organization_id));
grant select on public.zg_customer_approvals to authenticated;

create or replace function public.zg_create_customer_approval(
  p_organization_id uuid, p_work_order_id uuid, p_customer_email text,
  p_customer_name text, p_snapshot jsonb
) returns text language plpgsql security definer set search_path = public as $$
declare v_token text;
begin
  if not public.zg_is_org_member(p_organization_id) then raise exception 'Not authorized'; end if;
  v_token := encode(gen_random_bytes(24), 'hex');
  update public.zg_customer_approvals set status = 'expired'
    where organization_id = p_organization_id and work_order_id = p_work_order_id and status = 'pending';
  insert into public.zg_customer_approvals(organization_id, work_order_id, token_hash, snapshot, customer_email, customer_name, created_by)
  values(p_organization_id, p_work_order_id, encode(digest(v_token, 'sha256'), 'hex'), coalesce(p_snapshot, '{}'::jsonb), p_customer_email, p_customer_name, auth.uid());
  return v_token;
end $$;

create or replace function public.zg_get_customer_approval(p_token text)
returns jsonb language sql security definer set search_path = public as $$
  select jsonb_build_object('status', case when expires_at < now() and status = 'pending' then 'expired' else status end,
    'customer_name', customer_name, 'customer_email', customer_email, 'expires_at', expires_at,
    'decision_note', decision_note, 'decided_at', decided_at, 'snapshot', snapshot)
  from public.zg_customer_approvals
  where token_hash = encode(digest(trim(p_token), 'sha256'), 'hex') limit 1
$$;

create or replace function public.zg_submit_customer_approval(p_token text, p_decision text, p_note text, p_signature text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_row public.zg_customer_approvals; v_cn text;
begin
  if p_decision not in ('approved','rejected') then raise exception 'Invalid decision'; end if;
  select * into v_row from public.zg_customer_approvals
    where token_hash = encode(digest(trim(p_token), 'sha256'), 'hex') and status = 'pending' and expires_at >= now() for update;
  if v_row.id is null then return false; end if;
  if p_decision = 'approved' and coalesce(p_signature,'') = '' then raise exception 'Signature required'; end if;
  update public.zg_customer_approvals set status=p_decision, decision_note=p_note, signature_data=p_signature, decided_at=now() where id=v_row.id;
  v_cn := case when p_decision='approved' then '客户已批准' else '客户已拒绝' end;
  update public.zg_erp_records set payload = payload || jsonb_build_object(
      'customerApprovalStatus', v_cn, 'customerApprovalAt', now()::text,
      'customerApprovalBy', coalesce(v_row.customer_name,'客户'), 'customerApprovalNote', coalesce(p_note,''),
      'customerSignature', coalesce(p_signature, payload->>'customerSignature'), 'customerSignedAt', now()::text
    ), updated_at=now()
  where organization_id=v_row.organization_id and module='workOrders' and record_id=v_row.work_order_id;
  return true;
end $$;

grant execute on function public.zg_create_customer_approval(uuid,uuid,text,text,jsonb) to authenticated;
grant execute on function public.zg_get_customer_approval(text) to anon, authenticated;
grant execute on function public.zg_submit_customer_approval(text,text,text,text) to anon, authenticated;
