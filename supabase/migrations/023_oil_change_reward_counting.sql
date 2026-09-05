begin;

create or replace function public.zg_sync_oil_reward_work_order()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  v_payload jsonb := new.payload;
  v_service_text text;
  v_vehicle_record uuid;
  v_vin text;
  v_plate text;
  v_reward public.zg_reward_vehicles;
  v_qualifies boolean;
  v_has_event boolean;
  v_next integer;
begin
  if new.module <> 'workOrders' then return new; end if;

  begin v_vehicle_record := nullif(v_payload->>'vehicleId','')::uuid; exception when others then v_vehicle_record := null; end;
  v_vin := upper(regexp_replace(coalesce(v_payload->>'vin',''),'[^A-HJ-NPR-Z0-9]','','g'));
  v_plate := upper(regexp_replace(coalesce(v_payload->>'plate',''),'[^A-Z0-9]','','g'));
  v_service_text := lower(coalesce(v_payload->>'workPerformed','') || ' ' || coalesce(v_payload->'laborItems','[]'::jsonb)::text);
  v_qualifies := coalesce(v_payload->>'status','') in ('已完成','已交车')
    and nullif(v_payload->>'archivedAt','') is null
    and not coalesce((v_payload->>'archived')::boolean,false)
    and v_service_text ~ '(换[[:space:]]*机油|更换[[:space:]]*(发动机)?机油|oil[[:space:]-]*change|change[[:space:]]+(engine[[:space:]]+|motor[[:space:]]+)?oil)';

  select rv.* into v_reward
  from public.zg_reward_vehicles rv
  join public.zg_reward_enrollments re on re.id=rv.enrollment_id and re.status='approved'
  where rv.organization_id=new.organization_id and rv.status='active'
    and ((v_vehicle_record is not null and rv.vehicle_record_id=v_vehicle_record)
      or (length(v_vin)>=11 and rv.vin_normalized=v_vin)
      or (length(v_plate)>=2 and rv.plate_normalized=v_plate))
  order by case when v_vehicle_record is not null and rv.vehicle_record_id=v_vehicle_record then 0 when rv.vin_normalized=v_vin then 1 else 2 end
  limit 1 for update of rv;

  if v_reward.id is null then return new; end if;
  select exists(select 1 from public.zg_reward_events where reward_vehicle_id=v_reward.id and work_order_record_id=new.record_id and event_type='qualifying_service') into v_has_event;

  if v_qualifies and not v_has_event and v_reward.qualifying_count < 5 then
    v_next := v_reward.qualifying_count + 1;
    insert into public.zg_reward_events(organization_id,reward_vehicle_id,event_type,delta,work_order_record_id,work_order_number,service_at,note,created_by)
    values(new.organization_id,v_reward.id,'qualifying_service',1,new.record_id,v_payload->>'number',coalesce(nullif(v_payload->>'date','')::timestamptz,now()),'工单完成且包含换机油项目，系统自动累计 / Automatic oil-change credit',new.updated_by);
    update public.zg_reward_vehicles set qualifying_count=v_next,
      reward_earned_at=case when v_next=5 then now() else reward_earned_at end,
      reward_expires_at=case when v_next=5 then now()+interval '12 months' else reward_expires_at end,
      updated_at=now() where id=v_reward.id;
    if v_next=5 then
      insert into public.zg_reward_events(organization_id,reward_vehicle_id,event_type,delta,work_order_record_id,work_order_number,service_at,note,created_by)
      values(new.organization_id,v_reward.id,'reward_earned',0,new.record_id,v_payload->>'number',now(),'已完成 5 次，免费保养奖励生效 / Free service earned',new.updated_by)
      on conflict do nothing;
    end if;
  elsif not v_qualifies and v_has_event then
    delete from public.zg_reward_events where reward_vehicle_id=v_reward.id and work_order_record_id=new.record_id and event_type in ('qualifying_service','reward_earned');
    v_next := greatest(0,v_reward.qualifying_count-1);
    insert into public.zg_reward_events(organization_id,reward_vehicle_id,event_type,delta,work_order_record_id,work_order_number,service_at,note,created_by)
    values(new.organization_id,v_reward.id,'reversal',-1,new.record_id,v_payload->>'number',now(),'工单取消、归档或不再包含换机油项目，自动撤销次数 / Automatic reversal',new.updated_by)
    on conflict do nothing;
    update public.zg_reward_vehicles set qualifying_count=v_next,
      reward_earned_at=case when v_next<5 and reward_redeemed_at is null then null else reward_earned_at end,
      reward_expires_at=case when v_next<5 and reward_redeemed_at is null then null else reward_expires_at end,
      updated_at=now() where id=v_reward.id;
  end if;
  return new;
end $$;

drop trigger if exists zg_sync_oil_reward_work_order on public.zg_erp_records;
create trigger zg_sync_oil_reward_work_order
after insert or update of payload on public.zg_erp_records
for each row when (new.module='workOrders') execute function public.zg_sync_oil_reward_work_order();

create or replace function public.zg_set_oil_reward_count(p_reward_vehicle uuid,p_count integer,p_note text)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_vehicle public.zg_reward_vehicles;
  v_member public.zg_organization_members;
  v_delta integer;
begin
  if p_count < 0 or p_count > 5 then raise exception '次数必须在 0 到 5 之间'; end if;
  if length(trim(coalesce(p_note,''))) < 2 then raise exception '请填写修改原因'; end if;
  select * into v_vehicle from public.zg_reward_vehicles where id=p_reward_vehicle for update;
  if v_vehicle.id is null then raise exception '找不到活动车辆'; end if;
  select * into v_member from public.zg_organization_members
    where organization_id=v_vehicle.organization_id and user_id=auth.uid() and status='active' limit 1;
  if v_member.user_id is null or not (v_member.role in ('owner','manager','frontdesk') or coalesce((v_member.permissions->>'campaigns')::boolean,false)) then
    raise exception '当前账号没有修改活动次数的权限';
  end if;
  v_delta := p_count-v_vehicle.qualifying_count;
  if v_delta=0 then return jsonb_build_object('count',p_count,'changed',false); end if;
  update public.zg_reward_vehicles set qualifying_count=p_count,
    reward_earned_at=case when p_count=5 and reward_earned_at is null then now() when p_count<5 and reward_redeemed_at is null then null else reward_earned_at end,
    reward_expires_at=case when p_count=5 and reward_expires_at is null then now()+interval '12 months' when p_count<5 and reward_redeemed_at is null then null else reward_expires_at end,
    updated_at=now() where id=v_vehicle.id;
  insert into public.zg_reward_events(organization_id,reward_vehicle_id,event_type,delta,note,created_by)
  values(v_vehicle.organization_id,v_vehicle.id,'manual_adjustment',v_delta,trim(p_note),auth.uid());
  return jsonb_build_object('count',p_count,'changed',true,'delta',v_delta);
end $$;

grant execute on function public.zg_set_oil_reward_count(uuid,integer,text) to authenticated;
revoke execute on function public.zg_sync_oil_reward_work_order() from public, anon, authenticated;

commit;
