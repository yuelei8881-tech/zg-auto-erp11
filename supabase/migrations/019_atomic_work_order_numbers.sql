-- Allocate work-order numbers inside the database transaction. Opening a new
-- order on several devices no longer gives those drafts the same RO number.

create or replace function public.zg_reserve_work_order_number(p_record_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_existing text;
  v_year text := to_char(now() at time zone 'America/Los_Angeles', 'YYYY');
  v_next integer;
  v_number text;
begin
  select organization_id into v_org
  from public.zg_organization_members
  where user_id = auth.uid() and status = 'active'
  order by created_at
  limit 1;

  if v_org is null then raise exception 'Active organization membership required'; end if;

  perform pg_advisory_xact_lock(hashtextextended(v_org::text || ':work-order-number:' || v_year, 0));

  select payload->>'number' into v_existing
  from public.zg_erp_records
  where organization_id = v_org and module = 'workOrders' and record_id = p_record_id;
  if v_existing ~ ('^RO-' || v_year || '-[0-9]+$') then return v_existing; end if;

  select coalesce(max((regexp_match(payload->>'number', '^RO-' || v_year || '-([0-9]+)$'))[1]::integer), 0) + 1
  into v_next
  from public.zg_erp_records
  where organization_id = v_org and module = 'workOrders';

  v_number := 'RO-' || v_year || '-' || lpad(v_next::text, 4, '0');

  insert into public.zg_erp_records
    (organization_id, module, record_id, payload, created_by, updated_by)
  values
    (v_org, 'workOrders', p_record_id,
     jsonb_build_object('id', p_record_id, 'number', v_number, 'date', to_char(now() at time zone 'America/Los_Angeles', 'YYYY-MM-DD'), 'status', '草稿'),
     auth.uid(), auth.uid())
  on conflict (organization_id, module, record_id) do update
    set payload = public.zg_erp_records.payload || jsonb_build_object('number', v_number),
        updated_by = auth.uid();

  return v_number;
end;
$$;

revoke all on function public.zg_reserve_work_order_number(uuid) from public;
grant execute on function public.zg_reserve_work_order_number(uuid) to authenticated;
