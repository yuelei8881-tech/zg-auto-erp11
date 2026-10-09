-- No backfill: existing customer credits and welcome credits are preserved.
alter table public.zg_reward_events add column if not exists voided_at timestamptz;
alter table public.zg_reward_events add column if not exists void_reason text;
drop index if exists public.zg_reward_event_work_order_idx;
create unique index zg_reward_event_work_order_idx on public.zg_reward_events(reward_vehicle_id,work_order_record_id,event_type)
 where work_order_record_id is not null and event_type not in ('qualifying_service','reward_earned','reversal');
create unique index zg_reward_active_service_order_idx on public.zg_reward_events(organization_id,work_order_record_id)
 where work_order_record_id is not null and event_type='qualifying_service' and voided_at is null;
create unique index zg_reward_active_earned_order_idx on public.zg_reward_events(reward_vehicle_id,work_order_record_id)
 where work_order_record_id is not null and event_type='reward_earned' and voided_at is null;
create index if not exists zg_reward_vehicle_lookup_idx on public.zg_reward_vehicles(organization_id,vehicle_record_id)
 where status in ('pending','active');

create or replace function zg_private.oil_service_qualifies(p jsonb)
returns boolean language sql immutable set search_path='' as $$
 select coalesce(p->>'status','') in ('已完成','已交车')
 and coalesce(p->>'date','') >= '2026-09-05'
 and nullif(p->>'archivedAt','') is null and coalesce(p->>'archived','false') <> 'true'
 and case when p ? 'oilChangeCompleted' then p->'oilChangeCompleted'='true'::jsonb
 else lower(coalesce(p->>'workPerformed','')) ~ '(换[[:space:]]*机油|更换[[:space:]]*(发动机)?机油|oil[[:space:]-]*change|change[[:space:]]+(engine[[:space:]]+|motor[[:space:]]+)?oil)'
 and lower(coalesce(p->>'workPerformed','')) !~ '(未|没有|不|无需|取消|拒绝|待|建议|计划|not|no[[:space:]]|declin|cancel|recommend|pending|defer)' end
$$;
revoke all on function zg_private.oil_service_qualifies(jsonb) from public,anon,authenticated;

-- New orders require an explicit confirmation; legacy clients cannot drop it.
create or replace function zg_private.keep_oil_confirmation()
returns trigger language plpgsql set search_path='' as $$
begin
 if new.module='workOrders' and not (new.payload ? 'oilChangeCompleted') then
  if tg_op='INSERT' then new.payload:=new.payload||'{"oilChangeCompleted":false}'::jsonb;
  elsif old.payload ? 'oilChangeCompleted' then
   new.payload:=new.payload||jsonb_build_object('oilChangeCompleted',old.payload->'oilChangeCompleted');
  end if;
 end if;
 return new;
end $$;
revoke all on function zg_private.keep_oil_confirmation() from public,anon,authenticated;
create trigger zg_keep_oil_confirmation before insert or update on public.zg_erp_records
 for each row execute function zg_private.keep_oil_confirmation();

create or replace function public.zg_sync_oil_reward_work_order()
returns trigger language plpgsql security definer set search_path='' as $$
declare target_id uuid; vehicle_id uuid; vin text; reward public.zg_reward_vehicles;
 ev public.zg_reward_events; qualifies boolean; next_count integer;
begin
 if new.module<>'workOrders' then return new; end if;
 begin vehicle_id:=nullif(new.payload->>'vehicleId','')::uuid;
 exception when invalid_text_representation then vehicle_id:=null; end;
 vin:=regexp_replace(upper(coalesce(new.payload->>'vin','')),'[^A-HJ-NPR-Z0-9]','','g');
 qualifies:=coalesce(zg_private.oil_service_qualifies(new.payload),false);
 select rv.id into target_id from public.zg_reward_vehicles rv
 join public.zg_reward_enrollments re on re.id=rv.enrollment_id and re.organization_id=rv.organization_id and re.status='approved'
 where rv.organization_id=new.organization_id and rv.status='active'
 and ((vehicle_id is not null and rv.vehicle_record_id=vehicle_id)
   or (rv.vehicle_record_id is null and length(vin)=17 and rv.vin_normalized=vin))
 order by (rv.vehicle_record_id=vehicle_id) desc nulls last,rv.created_at,rv.id limit 1;
 -- Lock both old and new vehicle in a deterministic order before transferring credit.
 perform rv.id from public.zg_reward_vehicles rv where rv.organization_id=new.organization_id and
 (rv.id=target_id or rv.id in (select e.reward_vehicle_id from public.zg_reward_events e
  where e.organization_id=new.organization_id and e.work_order_record_id=new.record_id
  and e.event_type='qualifying_service' and e.voided_at is null)) order by rv.id for update;
 for ev in select * from public.zg_reward_events e where e.organization_id=new.organization_id
  and e.work_order_record_id=new.record_id and e.event_type='qualifying_service' and e.voided_at is null
 loop
  if qualifies and ev.reward_vehicle_id=target_id then return new; end if;
  update public.zg_reward_events set voided_at=now(),void_reason='工单资格撤销或车辆更正'
   where reward_vehicle_id=ev.reward_vehicle_id and work_order_record_id=new.record_id
   and event_type in ('qualifying_service','reward_earned') and voided_at is null;
  update public.zg_reward_vehicles set qualifying_count=greatest(0,qualifying_count-1),
   reward_earned_at=case when reward_redeemed_at is null then null else reward_earned_at end,
   reward_expires_at=case when reward_redeemed_at is null then null else reward_expires_at end,updated_at=now()
   where id=ev.reward_vehicle_id;
  insert into public.zg_reward_events(organization_id,reward_vehicle_id,event_type,delta,work_order_record_id,work_order_number,note,created_by)
   values(new.organization_id,ev.reward_vehicle_id,'reversal',-1,new.record_id,new.payload->>'number','工单资格撤销或车辆更正；原累计记录保留供核查',new.updated_by);
 end loop;
 if not qualifies or target_id is null then return new; end if;
 select * into reward from public.zg_reward_vehicles where id=target_id;
 if reward.qualifying_count>=5 or reward.reward_redeemed_at is not null then return new; end if;
 next_count:=reward.qualifying_count+1;
 insert into public.zg_reward_events(organization_id,reward_vehicle_id,event_type,delta,work_order_record_id,work_order_number,service_at,note,created_by)
 values(new.organization_id,target_id,'qualifying_service',1,new.record_id,new.payload->>'number',now(),'已确认完成换机油，工单完成后累计；同一工单仅计一次',new.updated_by);
 update public.zg_reward_vehicles set qualifying_count=next_count,
  reward_earned_at=case when next_count=5 then now() else reward_earned_at end,
  reward_expires_at=case when next_count=5 then now()+interval '12 months' else reward_expires_at end,updated_at=now() where id=target_id;
 if next_count=5 then
  insert into public.zg_reward_events(organization_id,reward_vehicle_id,event_type,delta,work_order_record_id,work_order_number,note,created_by)
  values(new.organization_id,target_id,'reward_earned',0,new.record_id,new.payload->>'number','已累计5次，第6次可兑换免费保养',new.updated_by);
 end if;
 return new;
end $$;
revoke all on function public.zg_sync_oil_reward_work_order() from public,anon,authenticated;

-- One indexed lookup, minimum information only, not customer or financial data.
create or replace function public.zg_vehicle_reward_summary(p_org uuid,p_vehicle uuid,p_order uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare permitted boolean; vin text; result jsonb;
begin
 if auth.uid() is null or not public.zg_is_org_member(p_org) then raise exception 'Not authorized' using errcode='42501'; end if;
 permitted:=zg_private.can(p_org,'customers') or zg_private.can(p_org,'campaigns');
 if not permitted and p_order is not null then
  select zg_private.readable(p_org,'workOrders',payload) and payload->>'vehicleId'=p_vehicle::text
   into permitted from public.zg_erp_records where organization_id=p_org and module='workOrders' and record_id=p_order;
 end if;
 if not coalesce(permitted,false) then raise exception '没有查看该车辆活动进度的权限' using errcode='42501'; end if;
 select regexp_replace(upper(coalesce(payload->>'vin','')),'[^A-HJ-NPR-Z0-9]','','g') into vin
  from public.zg_erp_records where organization_id=p_org and module='vehicles' and record_id=p_vehicle;
 select jsonb_build_object('id',rv.id,'status',rv.status,'qualifying_count',rv.qualifying_count,
  'reward_earned_at',rv.reward_earned_at,'reward_expires_at',rv.reward_expires_at,'reward_redeemed_at',rv.reward_redeemed_at,'enrollmentStatus',re.status)
 into result from public.zg_reward_vehicles rv join public.zg_reward_enrollments re
  on re.id=rv.enrollment_id and re.organization_id=rv.organization_id
 where rv.organization_id=p_org and rv.status in ('pending','active') and re.status in ('pending','approved')
  and (rv.vehicle_record_id=p_vehicle or (rv.vehicle_record_id is null and length(vin)=17 and rv.vin_normalized=vin))
 order by (rv.vehicle_record_id=p_vehicle) desc nulls last,rv.created_at desc,rv.id limit 1;
 return result;
end $$;
revoke all on function public.zg_vehicle_reward_summary(uuid,uuid,uuid) from public,anon;
grant execute on function public.zg_vehicle_reward_summary(uuid,uuid,uuid) to authenticated;
create or replace function zg_private.zg_save_operational_order(p_org uuid,p_order jsonb)
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
 allowed := array['complaint','complaintEn','diagnosis','diagnosisEn','workPerformed','workPerformedEn','oilChangeCompleted','mileage','inspectionChecklist','evidencePhotos','workTimeNote'];
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
revoke all on function zg_private.zg_save_operational_order(uuid,jsonb) from public,anon,authenticated;
notify pgrst,'reload schema';
