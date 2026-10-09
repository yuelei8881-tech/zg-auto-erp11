-- Atomic optimistic concurrency: inventory, work order and logs all commit or
-- all fail. Stale clients cannot overwrite a payment or another employee's work.
alter function public.zg_write_records(uuid,jsonb) rename to zg_write_records_unversioned;
alter function public.zg_write_records_unversioned(uuid,jsonb) set schema zg_private;
revoke all on function zg_private.zg_write_records_unversioned(uuid,jsonb) from public,anon,authenticated;
create function public.zg_write_records(p_org uuid,p_records jsonb)
returns void language plpgsql security definer set search_path='' as $$
begin perform zg_private.zg_write_records_unversioned(p_org,p_records); end $$;
revoke all on function public.zg_write_records(uuid,jsonb) from public,anon;
grant execute on function public.zg_write_records(uuid,jsonb) to authenticated;
create or replace function zg_private.assert_record_version(p_org uuid,p_module text,p_row jsonb)
returns boolean language plpgsql security definer set search_path = '' as $$
declare stored public.zg_erp_records; expected timestamptz;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_org::text||':'||p_module||':'||(p_row->>'id'),0));
 select * into stored from public.zg_erp_records where organization_id=p_org and module=p_module and record_id=(p_row->>'id')::uuid for update;
 if not found then return true; end if;
 if (stored.payload-'_cloudUpdatedAt')=(p_row-'_cloudUpdatedAt') then return false; end if;
 if p_module='workOrders' and stored.payload->>'status'='草稿' and not (stored.payload ? 'partItems') and stored.created_by=auth.uid() and stored.payload->>'number'=p_row->>'number' then return true; end if;
 begin expected:=nullif(p_row->>'_cloudUpdatedAt','')::timestamptz; exception when others then expected:=null; end;
 if expected is null or expected<>stored.updated_at then
   raise exception '记录已被其他操作更新，请重新打开并核对后保存（%）。本次没有覆盖服务器数据。',p_module using errcode='40001';
 end if;
 return true;
end $$;
revoke all on function zg_private.assert_record_version(uuid,text,jsonb) from public,anon,authenticated;

create or replace function public.zg_write_records_v2(p_org uuid,p_records jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare item jsonb; changes jsonb:='[]'::jsonb; result jsonb;
begin
 if auth.uid() is null or not public.zg_is_org_member(p_org) then raise exception 'Not authorized' using errcode='42501'; end if;
 if jsonb_typeof(p_records)<>'array' or jsonb_array_length(p_records)>200 then raise exception 'Invalid batch'; end if;
 if exists(select 1 from jsonb_array_elements(p_records) x group by x->>'module',x->'row'->>'id' having count(*)>1) then raise exception '同一批次中存在重复记录'; end if;
 -- Consistent lock ordering avoids opposing multi-part operations deadlocking.
 for item in select value from jsonb_array_elements(p_records) order by value->>'module',value->'row'->>'id' loop
   if not zg_private.writable(p_org,item->>'module') then raise exception '没有修改 % 的权限',item->>'module' using errcode='42501'; end if;
   if item->>'module'='parts' and (coalesce((item->'row'->>'qty')::numeric,0)<0 or item->'row'->>'qty'='NaN') then raise exception '库存不能小于零'; end if;
   if zg_private.assert_record_version(p_org,item->>'module',item->'row') then
     changes:=changes||jsonb_build_array(jsonb_build_object('module',item->>'module','row',(item->'row')-'_cloudUpdatedAt'));
   end if;
 end loop;
 perform zg_private.zg_write_records_unversioned(p_org,changes);
 select coalesce(jsonb_agg(jsonb_build_object('module',r.module,'row',
   zg_private.redact(r.payload,zg_private.can(p_org,'pricing') or zg_private.can(p_org,'finance'),zg_private.can(p_org,'finance'),zg_private.can(p_org,'customerContact')) ||
   jsonb_build_object('id',r.record_id,'_cloudUpdatedAt',r.updated_at))),'[]'::jsonb) into result
 from public.zg_erp_records r join jsonb_array_elements(p_records) x on r.module=x->>'module' and r.record_id=(x->'row'->>'id')::uuid where r.organization_id=p_org;
 return result;
end $$;
revoke all on function public.zg_write_records_v2(uuid,jsonb) from public,anon;
grant execute on function public.zg_write_records_v2(uuid,jsonb) to authenticated;

alter function public.zg_save_operational_order(uuid,jsonb) set schema zg_private;
revoke all on function zg_private.zg_save_operational_order(uuid,jsonb) from public,anon,authenticated;
create function public.zg_save_operational_order(p_org uuid,p_order jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare result jsonb; version timestamptz;
begin
 if not public.zg_is_org_member(p_org) or not zg_private.can(p_org,'diagnosis') then raise exception '没有施工记录保存权限' using errcode='42501'; end if;
 perform zg_private.assert_record_version(p_org,'workOrders',p_order);
 result:=zg_private.zg_save_operational_order(p_org,p_order-'_cloudUpdatedAt');
 select updated_at into version from public.zg_erp_records where organization_id=p_org and module='workOrders' and record_id=(p_order->>'id')::uuid;
 return result||jsonb_build_object('_cloudUpdatedAt',version);
end $$;
revoke all on function public.zg_save_operational_order(uuid,jsonb) from public,anon;
grant execute on function public.zg_save_operational_order(uuid,jsonb) to authenticated;

create or replace function public.zg_record_payment(p_org uuid,p_order_id uuid,p_payment jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare result jsonb; version timestamptz;
begin
 if not zg_private.can(p_org,'collectPayment') then raise exception '没有收款权限' using errcode='42501'; end if;
 result:=zg_private.zg_record_payment(p_org,p_order_id,p_payment);
 select updated_at into version from public.zg_erp_records where organization_id=p_org and module='workOrders' and record_id=p_order_id;
 return result||jsonb_build_object('_cloudUpdatedAt',version);
end $$;
notify pgrst, 'reload schema';
