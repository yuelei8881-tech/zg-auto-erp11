-- Production-safe integration test: the final expected exception rolls back every change.

do $$
declare
  v_org uuid;
  v_user uuid;
  v_enrollment uuid := gen_random_uuid();
  v_vehicle uuid := gen_random_uuid();
  v_vehicle_record uuid := gen_random_uuid();
  v_order_one uuid := gen_random_uuid();
  v_order_two uuid := gen_random_uuid();
  v_order_three uuid := gen_random_uuid();
  v_count integer;
  v_events integer;
  v_result jsonb;
  v_unauthorized_rejected boolean := false;
begin
  begin
  select m.organization_id,m.user_id into v_org,v_user
  from public.zg_organization_members m
  where m.status='active' and m.role='owner' order by m.created_at limit 1;
  if v_org is null then raise exception 'TEST SETUP FAILED: active owner not found'; end if;

  insert into public.zg_reward_enrollments(
    id,organization_id,account_type,contact_name,phone,phone_normalized,email,email_normalized,
    preferred_language,terms_version,terms_accepted_at,status,access_token_hash,reviewed_at,reviewed_by
  ) values (
    v_enrollment,v_org,'personal','AUTOMATED TEST','0000000000','0000000000',
    'rollback-test@zgautorepair.local','rollback-test@zgautorepair.local','zh','rollback-test',now(),
    'approved',extensions.crypt('rollback-test-token',extensions.gen_salt('bf')),now(),v_user
  );
  insert into public.zg_reward_vehicles(
    id,enrollment_id,organization_id,vehicle_record_id,vin,vin_normalized,plate,plate_normalized,
    state,year,make,model,qualifying_count,status
  ) values (
    v_vehicle,v_enrollment,v_org,v_vehicle_record,'1GNSCTKC0PRTEST01','1GNSCTKC0PRTEST01',
    'TEST95','TEST95','CA','2023','CHEVROLET','Suburban',1,'active'
  );

  -- Draft/pending orders must never count, even when they mention an oil change.
  insert into public.zg_erp_records(organization_id,module,record_id,payload,created_by,updated_by)
  values(v_org,'workOrders',v_order_one,jsonb_build_object(
    'id',v_order_one,'number','TEST-RO-1','vehicleId',v_vehicle_record,'vin','1GNSCTKC0PRTEST01',
    'plate','TEST95','date','2026-09-05','status','维修中','laborItems',jsonb_build_array(jsonb_build_object('description','换机油'))
  ),v_user,v_user);
  select qualifying_count into v_count from public.zg_reward_vehicles where id=v_vehicle;
  if v_count<>1 then raise exception 'FAILED: unfinished work order counted'; end if;

  -- A completed order without oil-change work must not count.
  update public.zg_erp_records set payload=payload||jsonb_build_object('status','已完成','laborItems',jsonb_build_array(jsonb_build_object('description','更换刹车片')))
  where organization_id=v_org and module='workOrders' and record_id=v_order_one;
  select qualifying_count into v_count from public.zg_reward_vehicles where id=v_vehicle;
  if v_count<>1 then raise exception 'FAILED: non-oil service counted'; end if;

  -- Adding a real oil-change labor item to the completed order counts exactly once.
  update public.zg_erp_records set payload=payload||jsonb_build_object('laborItems',jsonb_build_array(jsonb_build_object('description','更换机油和机油滤芯')))
  where organization_id=v_org and module='workOrders' and record_id=v_order_one;
  update public.zg_erp_records set payload=payload||jsonb_build_object('workPerformed','更换机油完成')
  where organization_id=v_org and module='workOrders' and record_id=v_order_one;
  select qualifying_count into v_count from public.zg_reward_vehicles where id=v_vehicle;
  select count(*) into v_events from public.zg_reward_events where reward_vehicle_id=v_vehicle and work_order_record_id=v_order_one and event_type='qualifying_service';
  if v_count<>2 or v_events<>1 then raise exception 'FAILED: duplicate-save protection (count %, events %)',v_count,v_events; end if;

  -- English wording is recognized; archiving reverses it and unarchiving restores it.
  insert into public.zg_erp_records(organization_id,module,record_id,payload,created_by,updated_by)
  values(v_org,'workOrders',v_order_two,jsonb_build_object(
    'id',v_order_two,'number','TEST-RO-2','vehicleId',v_vehicle_record,'vin','1GNSCTKC0PRTEST01',
    'plate','TEST95','date','2026-09-05','status','已交车','workPerformed','Engine oil change completed','laborItems','[]'::jsonb
  ),v_user,v_user);
  select qualifying_count into v_count from public.zg_reward_vehicles where id=v_vehicle;
  if v_count<>3 then raise exception 'FAILED: English oil-change phrase not counted'; end if;
  update public.zg_erp_records set payload=payload||jsonb_build_object('archivedAt',now()::text) where organization_id=v_org and module='workOrders' and record_id=v_order_two;
  select qualifying_count into v_count from public.zg_reward_vehicles where id=v_vehicle;
  if v_count<>2 then raise exception 'FAILED: archived order not reversed'; end if;
  update public.zg_erp_records set payload=(payload-'archivedAt') where organization_id=v_org and module='workOrders' and record_id=v_order_two;
  select qualifying_count into v_count from public.zg_reward_vehicles where id=v_vehicle;
  if v_count<>3 then raise exception 'FAILED: restored qualifying order not recounted'; end if;

  -- Reaching five creates a 12-month reward; losing qualification clears an unused reward.
  update public.zg_reward_vehicles set qualifying_count=4 where id=v_vehicle;
  insert into public.zg_erp_records(organization_id,module,record_id,payload,created_by,updated_by)
  values(v_org,'workOrders',v_order_three,jsonb_build_object(
    'id',v_order_three,'number','TEST-RO-3','vehicleId',v_vehicle_record,'vin','1GNSCTKC0PRTEST01',
    'plate','TEST95','date','2026-09-05','status','已完成','workPerformed','Oil change final verification','laborItems','[]'::jsonb
  ),v_user,v_user);
  select qualifying_count into v_count from public.zg_reward_vehicles where id=v_vehicle;
  if v_count<>5 or not exists(select 1 from public.zg_reward_vehicles where id=v_vehicle and reward_earned_at is not null and reward_expires_at>now()+interval '11 months') then raise exception 'FAILED: fifth-service reward not created'; end if;
  update public.zg_erp_records set payload=payload||jsonb_build_object('status','已取消') where organization_id=v_org and module='workOrders' and record_id=v_order_three;
  if not exists(select 1 from public.zg_reward_vehicles where id=v_vehicle and qualifying_count=4 and reward_earned_at is null and reward_expires_at is null) then raise exception 'FAILED: cancelled fifth service did not clear reward'; end if;

  -- Authorized adjustment succeeds and leaves an audit event.
  perform set_config('request.jwt.claim.sub',v_user::text,true);
  select public.zg_set_oil_reward_count(v_vehicle,3,'自动化回滚测试：授权调整') into v_result;
  if (v_result->>'count')::integer<>3 or not exists(select 1 from public.zg_reward_events where reward_vehicle_id=v_vehicle and event_type='manual_adjustment' and note like '自动化回滚测试%') then raise exception 'FAILED: authorized adjustment/audit'; end if;

  -- An unauthenticated caller is rejected.
  perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
  begin
    perform public.zg_set_oil_reward_count(v_vehicle,2,'未授权测试');
  exception when others then
    v_unauthorized_rejected := position('没有修改活动次数的权限' in sqlerrm)>0;
  end;
  if not v_unauthorized_rejected then raise exception 'FAILED: unauthorized adjustment was accepted'; end if;

    raise exception 'EXPECTED SAFE ROLLBACK: ALL 8 OIL REWARD LOGIC TESTS PASSED';
  exception when others then
    if sqlerrm <> 'EXPECTED SAFE ROLLBACK: ALL 8 OIL REWARD LOGIC TESTS PASSED' then raise; end if;
  end;
end $$;

select 'ALL 8 OIL REWARD LOGIC TESTS PASSED; TEST DATA ROLLED BACK' as result;
