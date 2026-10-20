begin;

-- One immutable audit record per ownership change; no client table access.
create table zg_private.vehicle_transfers (
 organization_id uuid not null, request_id uuid not null, vehicle_id uuid not null,
 target_module text not null, target_id uuid not null, actor_id uuid not null,
 transferred_at timestamptz not null, before_owner jsonb not null,
 after_owner jsonb not null, note text not null, result jsonb not null,
 primary key(organization_id,request_id)
);
alter table zg_private.vehicle_transfers enable row level security;
revoke all on zg_private.vehicle_transfers from public,anon,authenticated;
create index vehicle_transfers_vehicle_idx on zg_private.vehicle_transfers(organization_id,vehicle_id,transferred_at desc);
alter table public.zg_reward_vehicles add column credit_started_at timestamptz;
alter table public.zg_reward_vehicles add column transferred_at timestamptz;

create function zg_private.freeze_transferred_reward() returns trigger
language plpgsql set search_path='' as $$
begin
 if old.transferred_at is not null and new is distinct from old then
  raise exception '该活动周期已因车辆过户封存，请使用新车主的活动记录';
 end if;
 return new;
end $$;
revoke all on function zg_private.freeze_transferred_reward() from public,anon,authenticated;
create trigger freeze_transferred_reward before update on public.zg_reward_vehicles
 for each row execute function zg_private.freeze_transferred_reward();

create function public.zg_transfer_vehicle(
 p_org uuid,p_vehicle uuid,p_target_module text,p_target uuid,
 p_expected_updated_at timestamptz,p_note text,p_request_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 v public.zg_erp_records; t public.zg_erp_records; previous zg_private.vehicle_transfers;
 old_reward public.zg_reward_vehicles; new_enrollment uuid; new_reward uuid;
 new_payload jsonb; result jsonb; at_time timestamptz; owner_name text; owner_type text;
 phone text; email text; normalized_vin text; normalized_plate text;
begin
 if auth.uid() is null or not exists(select 1 from public.zg_organization_members
  where organization_id=p_org and user_id=auth.uid() and role='owner' and status='active')
 then raise exception '只有店主账号可以办理车辆过户' using errcode='42501'; end if;
 if p_request_id is null or p_target_module not in ('customers','fleets')
  or p_target is null or length(trim(coalesce(p_note,'')))<2 then
  raise exception '请选择新公司并填写过户原因'; end if;
 -- Serialize retries and transfers of this vehicle. The oil trigger takes the same lock.
 perform pg_advisory_xact_lock(hashtextextended(p_org::text||':transfer:'||p_vehicle::text,0));
 select * into previous from zg_private.vehicle_transfers where organization_id=p_org and request_id=p_request_id;
 if found then
  if previous.vehicle_id<>p_vehicle or previous.target_module<>p_target_module or previous.target_id<>p_target
  then raise exception '请求编号已使用，请重新打开过户窗口'; end if;
  return previous.result;
 end if;
 select * into v from public.zg_erp_records
  where organization_id=p_org and module='vehicles' and record_id=p_vehicle for update;
 if not found or coalesce(v.payload->>'archived','false')='true' or nullif(v.payload->>'archivedAt','') is not null
 then raise exception '车辆不存在或已归档'; end if;
 if p_expected_updated_at is null or v.updated_at<>p_expected_updated_at
 then raise exception '车辆已被其他操作更新，请刷新后重新过户'; end if;
 select * into t from public.zg_erp_records where organization_id=p_org and module=p_target_module and record_id=p_target for share;
 if not found or coalesce(t.payload->>'archived','false')='true' or nullif(t.payload->>'archivedAt','') is not null
 then raise exception '新公司不存在或已归档'; end if;
 if p_target_module='customers' and coalesce(t.payload->>'type','') not in ('公司','车队')
 then raise exception '请选择公司或车队资料'; end if;
 if v.payload->>'ownerId'=p_target::text then raise exception '车辆已经属于该公司，无需过户'; end if;
 owner_name:=trim(coalesce(t.payload->>case when p_target_module='fleets' then 'company' else 'name' end,''));
 if owner_name='' then raise exception '新公司名称不能为空'; end if;
 owner_type:=case when p_target_module='fleets' then '车队' else '公司' end;
 at_time:=clock_timestamp();
 normalized_vin:=regexp_replace(upper(coalesce(v.payload->>'vin','')),'[^A-HJ-NPR-Z0-9]','','g');
 normalized_plate:=regexp_replace(upper(coalesce(v.payload->>'plate','')),'[^A-Z0-9]','','g');
 -- Retire only this vehicle's cycle, not other vehicles belonging to its old company.
 for old_reward in select * from public.zg_reward_vehicles
  where organization_id=p_org and status in ('pending','active')
  and (vehicle_record_id=p_vehicle or (vehicle_record_id is null and length(normalized_vin)>=11 and vin_normalized=normalized_vin))
  order by id for update
 loop
  update public.zg_reward_vehicles set status='inactive',transferred_at=at_time,updated_at=at_time where id=old_reward.id;
  update public.zg_reward_events set voided_at=at_time,void_reason='车辆过户，原车主活动周期已封存'
   where reward_vehicle_id=old_reward.id and voided_at is null and event_type in ('qualifying_service','reward_earned');
  insert into public.zg_reward_events(organization_id,reward_vehicle_id,event_type,delta,note,created_by)
   values(p_org,old_reward.id,'manual_adjustment',0,'车辆过户：原活动周期已封存，不转移至新车主',auth.uid());
 end loop;
 -- Use a separate enrollment/token: an old owner's progress link cannot expose the new owner.
 phone:=coalesce(t.payload->>'phone','');
 email:=lower(trim(coalesce(t.payload->>'billingEmail',t.payload->>'email','')));
 if email='' then email:='transfer+'||p_request_id::text||'@zgautorepair.local'; end if;
 insert into public.zg_reward_enrollments(organization_id,account_type,contact_name,phone,phone_normalized,
  email,email_normalized,company_name,preferred_language,terms_version,terms_accepted_at,
  sms_consent,status,customer_record_id,fleet_record_id,review_note,reviewed_at,reviewed_by,access_token_hash)
 values(p_org,case when p_target_module='fleets' then 'fleet' else 'personal' end,
  coalesce(nullif(t.payload->>'contact',''),owner_name),phone,regexp_replace(phone,'[^0-9]','','g'),
  email,email,owner_name,'zh','internal-vehicle-transfer-no-customer-consent',at_time,
  false,'approved',case when p_target_module='customers' then p_target end,
  case when p_target_module='fleets' then p_target end,
  '店主内部办理过户；不代表客户签署活动条款或同意短信；新周期从0开始',at_time,auth.uid(),
  extensions.crypt(encode(extensions.gen_random_bytes(24),'hex'),extensions.gen_salt('bf'))) returning id into new_enrollment;
 insert into public.zg_reward_vehicles(enrollment_id,organization_id,vehicle_record_id,vin,vin_normalized,
  plate,plate_normalized,state,year,make,model,engine,qualifying_count,status,credit_started_at)
 values(new_enrollment,p_org,p_vehicle,coalesce(nullif(v.payload->>'vin',''),'LEGACY-'||p_vehicle::text),
  coalesce(nullif(normalized_vin,''),'LEGACY'||replace(p_vehicle::text,'-','')),
  coalesce(nullif(v.payload->>'plate',''),'NO PLATE'),normalized_plate,
  coalesce(v.payload->>'state','CA'),coalesce(v.payload->>'year','—'),coalesce(v.payload->>'make','—'),
  coalesce(v.payload->>'model','—'),v.payload->>'engine',0,'active',at_time) returning id into new_reward;
 insert into public.zg_reward_events(organization_id,reward_vehicle_id,event_type,delta,note,created_by)
  values(p_org,new_reward,'manual_adjustment',0,'车辆过户至新公司，活动累计从0开始；原维修档案保留',auth.uid());
 new_payload:=(v.payload-'_cloudUpdatedAt')||jsonb_build_object('ownerId',p_target,'ownerType',owner_type,
  'ownerName',owner_name,'driverId','','driverName','','driverPhone','','unit','',
  'ownershipTransferredAt',at_time,'ownershipTransferId',p_request_id);
 update public.zg_erp_records set payload=new_payload,updated_by=auth.uid()
  where organization_id=p_org and module='vehicles' and record_id=p_vehicle
  returning payload||jsonb_build_object('_cloudUpdatedAt',updated_at) into result;
 insert into zg_private.vehicle_transfers values(p_org,p_request_id,p_vehicle,p_target_module,p_target,auth.uid(),at_time,
  jsonb_build_object('ownerId',v.payload->>'ownerId','ownerType',v.payload->>'ownerType','ownerName',v.payload->>'ownerName'),
  jsonb_build_object('ownerId',p_target,'ownerType',owner_type,'ownerName',owner_name),trim(p_note),result);
 return result;
end $$;
revoke all on function public.zg_transfer_vehicle(uuid,uuid,text,uuid,timestamptz,text,uuid) from public,anon;
grant execute on function public.zg_transfer_vehicle(uuid,uuid,text,uuid,timestamptz,text,uuid) to authenticated;

-- Preserve the tested credit algorithm, adding only ownership-cycle gating and the shared lock.
do $migration$
declare definition text;
begin
 select pg_get_functiondef('public.zg_sync_oil_reward_work_order()'::regprocedure) into definition;
 if position('credit_started_at' in definition)>0 then raise exception 'Credit function already has transfer gating; review migration'; end if;
 definition:=replace(definition,
  'qualifies:=coalesce(zg_private.oil_service_qualifies(new.payload),false);',
  'perform pg_advisory_xact_lock(hashtextextended(new.organization_id::text||'':transfer:''||coalesce(vehicle_id::text,v_vin),0));
 qualifies:=coalesce(zg_private.oil_service_qualifies(new.payload),false);');
 definition:=replace(definition,
  'and ((vehicle_id is not null and rv.vehicle_record_id=vehicle_id)',
  'and (rv.credit_started_at is null or (
    new.created_at>=rv.credit_started_at
    and coalesce(new.payload->>''date'','''')>=to_char(rv.credit_started_at at time zone ''America/Los_Angeles'',''YYYY-MM-DD'')
    and exists(select 1 from public.zg_erp_records car where car.organization_id=new.organization_id
      and car.module=''vehicles'' and car.record_id=rv.vehicle_record_id
      and car.payload->>''ownerId'' in (new.payload->>''customerId'',new.payload->>''fleetId''))
  ))
 and ((vehicle_id is not null and rv.vehicle_record_id=vehicle_id)');
 if position('new.created_at>=rv.credit_started_at' in definition)=0 or position('pg_advisory_xact_lock' in definition)=0
 then raise exception 'Credit function changed; migration cannot safely patch'; end if;
 execute definition;
 -- Do not hand a new owner's token to someone re-submitting a transferred VIN.
 select pg_get_functiondef('public.zg_submit_oil_reward_registration(jsonb)'::regprocedure) into definition;
 if position('if v_existing.id is not null then' in definition)=0 then
  raise exception 'Registration function changed; review transfer privacy guard'; end if;
 definition:=replace(definition,'if v_existing.id is not null then',
  'if v_existing.credit_started_at is not null then
    raise exception ''该车辆已办理过户，请使用新车主电话与VIN后6位查询活动进度，或联系门店核验 / Vehicle transferred; recover progress using the new owner contact or contact the shop'';
   end if;
   if v_existing.id is not null then');
 execute definition;
end $migration$;
notify pgrst,'reload schema';
commit;
