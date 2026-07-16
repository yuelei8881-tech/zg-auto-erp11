create or replace function public.zg_submit_customer_approval(
  p_token text,
  p_decision text,
  p_note text,
  p_signature text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.zg_customer_approvals;
  v_approval_status text;
  v_workflow jsonb;
begin
  if p_decision not in ('approved', 'rejected') then
    raise exception 'Invalid decision';
  end if;

  select * into v_row
  from public.zg_customer_approvals
  where token_hash = encode(extensions.digest(trim(p_token), 'sha256'), 'hex')
    and status = 'pending'
    and expires_at >= now()
  for update;

  if v_row.id is null then return false; end if;
  if p_decision = 'approved' and coalesce(p_signature, '') = '' then
    raise exception 'Signature required';
  end if;

  update public.zg_customer_approvals
  set status = p_decision,
      decision_note = p_note,
      signature_data = p_signature,
      decided_at = now()
  where id = v_row.id;

  v_approval_status := case when p_decision = 'approved' then '客户已批准' else '客户已拒绝' end;
  v_workflow := case when p_decision = 'approved' then
    jsonb_build_object(
      'status', '维修中',
      'workflowStage', '维修施工',
      'reviewStatus', '已通过',
      'reviewedBy', coalesce(v_row.customer_name, '客户') || '（在线批准）',
      'reviewedAt', now()::text
    )
  else
    jsonb_build_object('status', '等待批准', 'workflowStage', '报价待确认')
  end;

  update public.zg_erp_records
  set payload = payload || v_workflow || jsonb_build_object(
        'customerApprovalStatus', v_approval_status,
        'customerApprovalAt', now()::text,
        'customerApprovalBy', coalesce(v_row.customer_name, '客户'),
        'customerApprovalNote', coalesce(p_note, ''),
        'customerSignature', coalesce(p_signature, payload->>'customerSignature'),
        'customerSignedAt', now()::text,
        'customerSignedBy', coalesce(v_row.customer_name, payload->>'customerSignedBy', '客户')
      ),
      updated_at = now()
  where organization_id = v_row.organization_id
    and module = 'workOrders'
    and record_id = v_row.work_order_id;

  if not found then
    raise exception 'Work order not found';
  end if;

  return true;
end;
$$;

revoke all on function public.zg_submit_customer_approval(text,text,text,text) from public;
grant execute on function public.zg_submit_customer_approval(text,text,text,text) to anon, authenticated;
