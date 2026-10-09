create or replace function public.zg_read_workspace(p_org uuid,p_since timestamptz default null,p_offset integer default 0,p_limit integer default 1000,p_module text default null)
returns table(module text,record_id uuid,payload jsonb,updated_at timestamptz)
language plpgsql stable security definer set search_path='' as $$
declare prices boolean; finances boolean; contacts boolean; owner_access boolean; allowed_modules text[]; all_orders boolean; assigned_orders boolean; claim_orders boolean; collect_payment boolean; caller text;
begin
 if auth.uid() is null or not public.zg_is_org_member(p_org) then raise exception 'Not authorized' using errcode='42501'; end if;
 owner_access:=zg_private.can(p_org,'owner');
 prices:=zg_private.can(p_org,'pricing') or zg_private.can(p_org,'finance');
 finances:=zg_private.can(p_org,'finance');contacts:=zg_private.can(p_org,'customerContact');
 caller:=auth.uid()::text;
 all_orders:=zg_private.can(p_org,'workOrders');
 assigned_orders:=zg_private.can(p_org,'assignedWorkOrders');
 claim_orders:=zg_private.can(p_org,'claimWorkOrders');
 collect_payment:=zg_private.can(p_org,'collectPayment');
 select coalesce(array_agg(m),'{}'::text[]) into allowed_modules
 from unnest(array['settings','customers','vehicles','fleets','drivers','parts','servicePackages','payments','expenses','inventoryLogs','changeLogs','campaigns','warranties']) as modules(m)
 where zg_private.readable(p_org,m,'{}'::jsonb);
 return query select r.module,r.record_id,
 case when r.module='settings' then jsonb_build_object('id',r.record_id,'shopName',r.payload->'shopName','address',r.payload->'address','phone',r.payload->'phone','email',r.payload->'email','invoiceTerms',r.payload->'invoiceTerms')||case when prices then r.payload else '{}'::jsonb end
 when prices and finances and contacts then r.payload
 else zg_private.redact(r.payload,prices,finances or (r.module='payments' and collect_payment),contacts) end,
 r.updated_at from zg_private.workspace_records r
 where r.organization_id=p_org and (p_since is null or r.updated_at>p_since) and (p_module is null or r.module=p_module)
 and (owner_access or r.module=any(allowed_modules)
 or (r.module='workOrders' and (all_orders or (assigned_orders and
   (r.payload->>'technicianUserId'=caller or (claim_orders and coalesce(r.payload->>'technicianUserId','')='')))))
 or (r.module='approvalRequests' and (finances or r.payload->>'requestedById'=caller)))
 order by r.updated_at desc,r.record_id desc,r.module limit least(greatest(p_limit,1),1000) offset greatest(p_offset,0);
end $$;
revoke all on function public.zg_read_workspace(uuid,timestamptz,integer,integer,text) from public,anon;
grant execute on function public.zg_read_workspace(uuid,timestamptz,integer,integer,text) to authenticated;
