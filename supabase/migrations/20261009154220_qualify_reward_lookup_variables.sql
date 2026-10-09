create or replace function public.zg_sync_oil_reward_work_order()
returns trigger language plpgsql security definer set search_path='' as $$
declare target_id uuid; vehicle_id uuid; v_vin text; reward public.zg_reward_vehicles;
 ev public.zg_reward_events; qualifies boolean; next_count integer;
begin
 if new.module<>'workOrders' then return new; end if;
 begin vehicle_id:=nullif(new.payload->>'vehicleId','')::uuid;
 exception when invalid_text_representation then vehicle_id:=null; end;
 v_vin:=regexp_replace(upper(coalesce(new.payload->>'vin','')),'[^A-HJ-NPR-Z0-9]','','g');
 qualifies:=coalesce(zg_private.oil_service_qualifies(new.payload),false);
 select rv.id into target_id from public.zg_reward_vehicles rv
 join public.zg_reward_enrollments re on re.id=rv.enrollment_id and re.organization_id=rv.organization_id and re.status='approved'
 where rv.organization_id=new.organization_id and rv.status='active'
 and ((vehicle_id is not null and rv.vehicle_record_id=vehicle_id)
   or (rv.vehicle_record_id is null and length(v_vin)=17 and rv.vin_normalized=v_vin))
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
declare permitted boolean; v_vin text; result jsonb;
begin
 if auth.uid() is null or not public.zg_is_org_member(p_org) then raise exception 'Not authorized' using errcode='42501'; end if;
 permitted:=zg_private.can(p_org,'customers') or zg_private.can(p_org,'campaigns');
 if not permitted and p_order is not null then
  select zg_private.readable(p_org,'workOrders',payload) and payload->>'vehicleId'=p_vehicle::text
   into permitted from public.zg_erp_records where organization_id=p_org and module='workOrders' and record_id=p_order;
 end if;
 if not coalesce(permitted,false) then raise exception '没有查看该车辆活动进度的权限' using errcode='42501'; end if;
 select regexp_replace(upper(coalesce(payload->>'vin','')),'[^A-HJ-NPR-Z0-9]','','g') into v_vin
  from public.zg_erp_records where organization_id=p_org and module='vehicles' and record_id=p_vehicle;
 select jsonb_build_object('id',rv.id,'status',rv.status,'qualifying_count',rv.qualifying_count,
  'reward_earned_at',rv.reward_earned_at,'reward_expires_at',rv.reward_expires_at,'reward_redeemed_at',rv.reward_redeemed_at,'enrollmentStatus',re.status)
 into result from public.zg_reward_vehicles rv join public.zg_reward_enrollments re
  on re.id=rv.enrollment_id and re.organization_id=rv.organization_id
 where rv.organization_id=p_org and rv.status in ('pending','active') and re.status in ('pending','approved')
  and (rv.vehicle_record_id=p_vehicle or (rv.vehicle_record_id is null and length(v_vin)=17 and rv.vin_normalized=v_vin))
 order by (rv.vehicle_record_id=p_vehicle) desc nulls last,rv.created_at desc,rv.id limit 1;
 return result;
end $$;
revoke all on function public.zg_vehicle_reward_summary(uuid,uuid,uuid) from public,anon;
grant execute on function public.zg_vehicle_reward_summary(uuid,uuid,uuid) to authenticated;
notify pgrst,'reload schema';
