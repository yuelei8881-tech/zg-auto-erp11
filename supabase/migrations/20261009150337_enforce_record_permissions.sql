-- Phase 1: server-enforced permissions. No business records are rewritten.
create schema if not exists zg_private;
revoke all on schema zg_private from public, anon;
grant usage on schema zg_private to authenticated;

create or replace function zg_private.can(p_org uuid, p_key text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare m public.zg_organization_members; defaults text[];
begin
  if auth.uid() is null then return false; end if;
  select * into m from public.zg_organization_members
    where organization_id=p_org and user_id=auth.uid() and status='active';
  if not found then return false; end if;
  if m.role='owner' then return true; end if;
  if p_key='owner' then return false; end if;
  if m.permissions ? p_key then return m.permissions->p_key='true'::jsonb; end if;
  defaults := case m.role
    when 'manager' then array['customers','customerContact','workOrders','createWorkOrders','diagnosis','assignTechnician','printInternalWorkOrder','inventory','campaigns','archive','approve','smart','settings']
    when 'workshop_supervisor' then array['customers','customerContact','workOrders','createWorkOrders','diagnosis','assignTechnician','printInternalWorkOrder','inventory','archive','approve','smart']
    when 'frontdesk' then array['customers','customerContact','workOrders','createWorkOrders','diagnosis','assignTechnician','printInternalWorkOrder','campaigns','smart']
    when 'technician' then array['assignedWorkOrders','claimWorkOrders','completeWorkOrders','diagnosis','printInternalWorkOrder','smart']
    when 'finance' then array['customers','customerContact','workOrders','pricing','collectPayment','printInternalWorkOrder','finance','approve']
    when 'warehouse' then array['workOrders','inventory'] else array[]::text[] end;
  return p_key=any(defaults);
end $$;
revoke all on function zg_private.can(uuid,text) from public,anon;
grant execute on function zg_private.can(uuid,text) to authenticated;

create or replace function zg_private.readable(p_org uuid,p_module text,p jsonb)
returns boolean language sql stable set search_path = '' as $$
 select zg_private.can(p_org,'owner') or case p_module
 when 'settings' then public.zg_is_org_member(p_org)
 when 'workOrders' then zg_private.can(p_org,'workOrders') or
   (zg_private.can(p_org,'assignedWorkOrders') and (p->>'technicianUserId'=auth.uid()::text or
    (zg_private.can(p_org,'claimWorkOrders') and coalesce(p->>'technicianUserId','')='')))
 when 'customers' then zg_private.can(p_org,'customers')
 when 'vehicles' then zg_private.can(p_org,'customers')
 when 'fleets' then zg_private.can(p_org,'customers')
 when 'drivers' then zg_private.can(p_org,'customers')
 when 'parts' then zg_private.can(p_org,'inventory') or zg_private.can(p_org,'workOrders')
 when 'servicePackages' then zg_private.can(p_org,'workOrders') or zg_private.can(p_org,'assignedWorkOrders')
 when 'payments' then zg_private.can(p_org,'finance') or zg_private.can(p_org,'collectPayment')
 when 'expenses' then zg_private.can(p_org,'finance')
 when 'inventoryLogs' then zg_private.can(p_org,'inventory')
 when 'changeLogs' then zg_private.can(p_org,'finance')
 when 'approvalRequests' then zg_private.can(p_org,'finance') or p->>'requestedById'=auth.uid()::text
 when 'campaigns' then zg_private.can(p_org,'campaigns')
 when 'warranties' then zg_private.can(p_org,'campaigns') else false end
$$;

create or replace function zg_private.redact(p jsonb, prices boolean, finances boolean, contacts boolean)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare result jsonb; k text; v jsonb;
begin
 if jsonb_typeof(p)='array' then
   select coalesce(jsonb_agg(zg_private.redact(value,prices,finances,contacts)),'[]'::jsonb) into result from jsonb_array_elements(p); return result;
 elsif jsonb_typeof(p)<>'object' then return p; end if;
 result := '{}'::jsonb;
 for k,v in select * from jsonb_each(p) loop
   if not prices and k=any(array['price','rate','flatAmount','total','tax','taxRate','taxOverride','discount','settlementTotal','laborTotal','partsTotal','outsource','defaultLaborRate','defaultTaxRate','markupPercent','amount','oldValue','newValue','creditLimit','notes','note','before','after','proposedOrder','proposedExpense','proposedPayment','documentSendHistory','customerApprovalUrl']) then continue; end if;
   if not finances and k=any(array['cost','costTotal','partsCost','grossProfit','unitCost','totalCost','paid','balance','paymentMethod','reconciliationSnapshot']) then continue; end if;
   if not contacts and k=any(array['phone','secondaryPhone','driverPhone','email','billingEmail','address','licenseLast4','customerSignature','notes','note','documentSendHistory','customerApprovalUrl']) then continue; end if;
   result := result || jsonb_build_object(k,zg_private.redact(v,prices,finances,contacts));
 end loop;
 return result;
end $$;

create or replace function public.zg_read_records(p_org uuid,p_since timestamptz default null,p_offset integer default 0,p_limit integer default 1000,p_module text default null)
returns table(module text,record_id uuid,payload jsonb,updated_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare prices boolean; finances boolean; contacts boolean;
begin
 if auth.uid() is null or not public.zg_is_org_member(p_org) then raise exception 'Not authorized' using errcode='42501'; end if;
 prices := zg_private.can(p_org,'pricing') or zg_private.can(p_org,'finance');
 finances := zg_private.can(p_org,'finance'); contacts := zg_private.can(p_org,'customerContact');
 return query select r.module,r.record_id,
 case when r.module='settings' then jsonb_build_object('id',r.record_id,'shopName',r.payload->'shopName','address',r.payload->'address','phone',r.payload->'phone','email',r.payload->'email','invoiceTerms',r.payload->'invoiceTerms') ||
   case when prices then r.payload else '{}'::jsonb end
 when prices and finances and contacts then r.payload
 else zg_private.redact(r.payload,prices,finances or (r.module='payments' and zg_private.can(p_org,'collectPayment')),contacts) end,
 r.updated_at from public.zg_erp_records r
 where r.organization_id=p_org and (p_since is null or r.updated_at>p_since) and (p_module is null or r.module=p_module)
 and zg_private.readable(p_org,r.module,r.payload)
 order by r.updated_at desc,r.record_id desc limit least(greatest(p_limit,1),1000) offset greatest(p_offset,0);
end $$;
revoke all on function public.zg_read_records(uuid,timestamptz,integer,integer,text) from public,anon;
grant execute on function public.zg_read_records(uuid,timestamptz,integer,integer,text) to authenticated;

-- Deny direct JSON access: a row-level policy cannot hide fields within JSON.
-- The secure read RPC above returns only the caller's permitted fields.

-- Restricted writers use this function: hidden monetary fields are preserved,
-- not replaced with the zeroes generated by a price-free client.
create or replace function public.zg_save_operational_order(p_org uuid,p_order jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare old_row public.zg_erp_records; result jsonb; allowed text[]; k text; v jsonb; id uuid;
begin
 if auth.uid() is null or not public.zg_is_org_member(p_org) then raise exception 'Not authorized' using errcode='42501'; end if;
 id := (p_order->>'id')::uuid;
 select * into old_row from public.zg_erp_records where organization_id=p_org and module='workOrders' and record_id=id for update;
 if found then
   if not zg_private.readable(p_org,'workOrders',old_row.payload) or not zg_private.can(p_org,'diagnosis') then raise exception '没有修改该工单施工记录的权限' using errcode='42501'; end if;
   result := old_row.payload;
 else
   if not zg_private.can(p_org,'createWorkOrders') then raise exception '没有新建工单权限' using errcode='42501'; end if;
   result := jsonb_build_object('id',id,'number',p_order->'number','date',p_order->'date','status','等待检查','laborItems','[]'::jsonb,'partItems','[]'::jsonb,'total',0,'paid',0,'balance',0,'tax',0,'discount',0,'outsource',0);
 end if;
 allowed := array['complaint','complaintEn','diagnosis','diagnosisEn','workPerformed','workPerformedEn','mileage','inspectionChecklist','evidencePhotos','workTimeNote'];
 if old_row.record_id is null or zg_private.can(p_org,'createWorkOrders') then
   allowed := allowed || array['customerId','customer','vehicleId','vehicle','plate','vin','fleetId','company','driverId','driver','authorizedContact','po'];
 end if;
 if zg_private.can(p_org,'customerContact') then allowed := allowed || array['phone','driverPhone']; end if;
 if zg_private.can(p_org,'assignTechnician') then allowed := allowed || array['technician','technicianUserId']; end if;
 if coalesce(result->>'technicianUserId','')='' and zg_private.can(p_org,'claimWorkOrders') and p_order->>'technicianUserId'=auth.uid()::text then
   result := result || jsonb_build_object('technicianUserId',auth.uid(),'technician',p_order->'technician','claimedAt',now(),'claimedBy',p_order->'technician');
 end if;
 if p_order->>'reviewStatus'='待审查' then allowed:=allowed||array['reviewStatus','submittedForReviewAt','reviewNotes']; end if;
 if zg_private.can(p_org,'approve') then allowed:=allowed||array['reviewStatus','reviewedAt','reviewedBy','reviewNotes','reviewHistory']; end if;
 for k,v in select * from jsonb_each(p_order) loop if k=any(allowed) then result:=result||jsonb_build_object(k,v); end if; end loop;
 if p_order->>'status' in ('等待检查','等待批准','等待配件','维修中','已完成') and coalesce(result->>'status','') not in ('已交车','已取消') then
   result := result || jsonb_build_object('status',p_order->'status');
   if p_order->>'status'='已完成' then result:=result||jsonb_build_object('technicianCompletedAt',now(),'completedByUserId',auth.uid(),'completedBy',p_order->'completedBy','workflowStage','完工待结账'); end if;
 end if;
 insert into public.zg_erp_records(organization_id,module,record_id,payload,updated_by)
 values(p_org,'workOrders',id,result,auth.uid()) on conflict(organization_id,module,record_id)
 do update set payload=excluded.payload,updated_by=excluded.updated_by;
 return zg_private.redact(result,zg_private.can(p_org,'pricing') or zg_private.can(p_org,'finance'),zg_private.can(p_org,'finance'),zg_private.can(p_org,'customerContact'));
end $$;
revoke all on function public.zg_save_operational_order(uuid,jsonb) from public,anon;
grant execute on function public.zg_save_operational_order(uuid,jsonb) to authenticated;

-- Priced, financial and other module writes are checked independently.
create or replace function zg_private.writable(p_org uuid,p_module text)
returns boolean language sql stable set search_path = '' as $$
 select zg_private.can(p_org,'owner') or case
 when p_module='workOrders' then zg_private.can(p_org,'pricing') and zg_private.can(p_org,'workOrders')
 when p_module in ('customers','vehicles','fleets','drivers') then zg_private.can(p_org,'customers') and zg_private.can(p_org,'customerContact')
 when p_module in ('parts','inventoryLogs') then zg_private.can(p_org,'inventory')
 when p_module in ('payments','expenses') then zg_private.can(p_org,'finance')
 when p_module='servicePackages' then zg_private.can(p_org,'pricing')
 when p_module in ('campaigns','warranties') then zg_private.can(p_org,'campaigns')
 when p_module='settings' then zg_private.can(p_org,'settings')
 when p_module='approvalRequests' then zg_private.can(p_org,'finance') and zg_private.can(p_org,'approve')
 when p_module='changeLogs' then zg_private.can(p_org,'pricing') or zg_private.can(p_org,'diagnosis') else false end
$$;

create or replace function public.zg_write_records(p_org uuid,p_records jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare item jsonb; m text; r jsonb; old_payload jsonb;
begin
 if auth.uid() is null or not public.zg_is_org_member(p_org) then raise exception 'Not authorized' using errcode='42501'; end if;
 if jsonb_typeof(p_records)<>'array' or jsonb_array_length(p_records)>200 then raise exception 'Invalid batch'; end if;
 for item in select value from jsonb_array_elements(p_records) loop
   m:=item->>'module'; r:=item->'row';
   if not zg_private.writable(p_org,m) then raise exception '没有修改 % 的权限',m using errcode='42501'; end if;
   select payload into old_payload from public.zg_erp_records where organization_id=p_org and module=m and record_id=(r->>'id')::uuid for update;
   if m='workOrders' and not zg_private.can(p_org,'finance') then
     -- A redacted client never receives cost fields; restore them by stable line
     -- identity instead of accepting zero/missing costs from that client.
     r := jsonb_set(r,'{partItems}',coalesce((
       select jsonb_agg(line || jsonb_build_object('cost',coalesce(previous.line->'cost',inventory.payload->'cost','0'::jsonb),
         'costTotal',coalesce((line->>'qty')::numeric,0)*coalesce((previous.line->>'cost')::numeric,(inventory.payload->>'cost')::numeric,0)))
       from jsonb_array_elements(coalesce(r->'partItems','[]'::jsonb)) line
       left join lateral (select value as line from jsonb_array_elements(coalesce(old_payload->'partItems','[]'::jsonb)) where value->>'id'=line->>'id' limit 1) previous on true
       left join public.zg_erp_records inventory on inventory.organization_id=p_org and inventory.module='parts' and inventory.record_id::text=line->>'partId'
     ),'[]'::jsonb));
     -- Pricing permission is not payment/cost permission.
     r := (r - array['paid','partsCost','grossProfit','paymentMethod']) ||
       jsonb_build_object('paid',coalesce(old_payload->'paid','0'::jsonb),
         'partsCost',coalesce(old_payload->'partsCost','0'::jsonb),'grossProfit',coalesce(old_payload->'grossProfit','0'::jsonb),
         'paymentMethod',coalesce(old_payload->'paymentMethod','""'::jsonb));
     r := r || jsonb_build_object('balance',greatest(0,coalesce((r->>'total')::numeric,0)-coalesce((r->>'paid')::numeric,0)));
     r := r || jsonb_build_object('partsCost',(select coalesce(sum((value->>'costTotal')::numeric),0) from jsonb_array_elements(r->'partItems')));
     r := r || jsonb_build_object('grossProfit',round(coalesce((r->>'total')::numeric,0)-coalesce((r->>'tax')::numeric,0)-coalesce((r->>'partsCost')::numeric,0)-coalesce((r->>'outsource')::numeric,0),2));
   end if;
   if m='approvalRequests' and not zg_private.can(p_org,'owner') then
     if old_payload is null then
       if r->>'status'<>'待授权' or r->>'requestedById'<>auth.uid()::text then raise exception 'Invalid approval request'; end if;
     elsif r->>'status' in ('已批准','已执行') and old_payload->>'requestedById'=auth.uid()::text then
       raise exception '不能批准自己的申请';
     end if;
   end if;
   insert into public.zg_erp_records(organization_id,module,record_id,payload,updated_by)
   values(p_org,m,(r->>'id')::uuid,r,auth.uid()) on conflict(organization_id,module,record_id)
   do update set payload=excluded.payload,updated_by=excluded.updated_by;
 end loop;
end $$;
revoke all on function public.zg_write_records(uuid,jsonb) from public,anon;
grant execute on function public.zg_write_records(uuid,jsonb) to authenticated;


revoke all on function zg_private.readable(uuid,text,jsonb),zg_private.redact(jsonb,boolean,boolean,boolean),zg_private.writable(uuid,text) from public,anon,authenticated;

-- Keep the existing atomic payment implementation, add a current permission gate.
alter function public.zg_record_payment(uuid,uuid,jsonb) set schema zg_private;
revoke all on function zg_private.zg_record_payment(uuid,uuid,jsonb) from public,anon,authenticated;
create function public.zg_record_payment(p_org uuid,p_order_id uuid,p_payment jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
 if not zg_private.can(p_org,'collectPayment') then raise exception '没有收款权限' using errcode='42501'; end if;
 return zg_private.zg_record_payment(p_org,p_order_id,p_payment);
end $$;
revoke all on function public.zg_record_payment(uuid,uuid,jsonb) from public,anon;
grant execute on function public.zg_record_payment(uuid,uuid,jsonb) to authenticated;

-- Related tables must not provide an alternate path to prices or client details.
