create or replace function public.zg_record_payment(
  p_org uuid,
  p_order_id uuid,
  p_payment jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order jsonb;
  v_payment_id uuid := (p_payment->>'id')::uuid;
  v_amount numeric := coalesce((p_payment->>'amount')::numeric, 0);
  v_balance numeric;
  v_paid numeric;
  v_updated jsonb;
begin
  if auth.uid() is null or not public.zg_is_org_member(p_org) then
    raise exception 'Not authorized for this organization';
  end if;
  if v_amount <= 0 then
    raise exception 'Payment amount must be greater than zero';
  end if;

  select payload into v_order
  from public.zg_erp_records
  where organization_id = p_org and module = 'workOrders' and record_id = p_order_id
  for update;
  if v_order is null then raise exception 'Work order not found'; end if;

  v_balance := coalesce((v_order->>'balance')::numeric, 0);
  v_paid := coalesce((v_order->>'paid')::numeric, 0);
  if v_balance <= 0.009 then raise exception 'Work order is already paid'; end if;
  if v_amount > v_balance + 0.009 then raise exception 'Payment exceeds current balance'; end if;

  if exists (
    select 1 from public.zg_erp_records
    where organization_id = p_org and module = 'payments'
      and updated_by = auth.uid() and updated_at > now() - interval '15 seconds'
      and payload->>'workOrderId' = p_order_id::text
      and abs(coalesce((payload->>'amount')::numeric, 0) - v_amount) < 0.009
  ) then
    raise exception 'Duplicate payment blocked';
  end if;

  v_updated := jsonb_set(
    jsonb_set(
      jsonb_set(v_order, '{paid}', to_jsonb(round(v_paid + v_amount, 2)), true),
      '{balance}', to_jsonb(greatest(0, round(v_balance - v_amount, 2))), true
    ),
    '{paymentMethod}', to_jsonb(coalesce(p_payment->>'method', '未记录')), true
  );

  update public.zg_erp_records
  set payload = v_updated, updated_by = auth.uid(), updated_at = now()
  where organization_id = p_org and module = 'workOrders' and record_id = p_order_id;

  insert into public.zg_erp_records (organization_id, module, record_id, payload, created_by, updated_by)
  values (p_org, 'payments', v_payment_id, p_payment, auth.uid(), auth.uid());

  return v_updated;
end;
$$;

revoke all on function public.zg_record_payment(uuid, uuid, jsonb) from public;
grant execute on function public.zg_record_payment(uuid, uuid, jsonb) to authenticated;
