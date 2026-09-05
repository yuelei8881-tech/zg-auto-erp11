begin;

create or replace function public.zg_auto_enroll_existing_reward_vehicle(
  p_organization uuid,
  p_vehicle_record uuid,
  p_payload jsonb
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_vin text := upper(regexp_replace(coalesce(p_payload->>'vin',''),'[^A-HJ-NPR-Z0-9]','','g'));
  v_plate text := upper(regexp_replace(coalesce(p_payload->>'plate',''),'[^A-Z0-9]','','g'));
  v_owner_id uuid;
  v_owner_module text;
  v_owner jsonb := '{}'::jsonb;
  v_enrollment uuid;
  v_reward_vehicle uuid;
  v_phone text;
  v_email text;
  v_name text;
  v_account text;
  v_token text := encode(extensions.gen_random_bytes(24),'hex');
begin
  if coalesce((p_payload->>'archived')::boolean,false) or (length(v_vin) < 11 and length(v_plate) < 2) then return null; end if;

  select id into v_reward_vehicle
  from public.zg_reward_vehicles
  where organization_id=p_organization and status in ('pending','active')
    and (vehicle_record_id=p_vehicle_record or (length(v_vin)>=11 and vin_normalized=v_vin) or (length(v_plate)>=2 and plate_normalized=v_plate))
  order by case when vehicle_record_id=p_vehicle_record then 0 when vin_normalized=v_vin then 1 else 2 end
  limit 1;
  if v_reward_vehicle is not null then
    update public.zg_reward_vehicles set vehicle_record_id=p_vehicle_record, updated_at=now() where id=v_reward_vehicle and vehicle_record_id is null;
    return v_reward_vehicle;
  end if;

  begin v_owner_id := nullif(p_payload->>'ownerId','')::uuid; exception when others then v_owner_id := null; end;
  v_account := case when coalesce(p_payload->>'ownerType','') in ('车队','fleet','Fleet') then 'fleet' else 'personal' end;
  v_owner_module := case when v_account='fleet' then 'fleets' else 'customers' end;
  if v_owner_id is not null then
    select payload into v_owner from public.zg_erp_records
    where organization_id=p_organization and module=v_owner_module and record_id=v_owner_id limit 1;
  end if;
  v_owner := coalesce(v_owner,'{}'::jsonb);
  v_name := coalesce(nullif(trim(v_owner->>case when v_account='fleet' then 'company' else 'name' end),''),nullif(trim(p_payload->>'ownerName'),''),'Existing customer');
  v_phone := regexp_replace(coalesce(v_owner->>'phone',p_payload->>'driverPhone',''),'[^0-9]','','g');
  if length(v_phone)<10 then v_phone := '0000000000'; end if;
  v_email := lower(trim(coalesce(v_owner->>'billingEmail',v_owner->>'email','')));
  if position('@' in v_email)<2 then v_email := 'legacy+'||replace(p_vehicle_record::text,'-','')||'@zgautorepair.local'; end if;

  select id into v_enrollment from public.zg_reward_enrollments
  where organization_id=p_organization and status='approved'
    and ((v_account='fleet' and fleet_record_id=v_owner_id) or (v_account='personal' and customer_record_id=v_owner_id))
  order by created_at limit 1;

  if v_enrollment is null then
    insert into public.zg_reward_enrollments(
      organization_id,account_type,contact_name,phone,phone_normalized,email,email_normalized,
      company_name,preferred_language,terms_version,terms_accepted_at,sms_consent,status,
      customer_record_id,fleet_record_id,review_note,reviewed_at,access_token_hash
    ) values (
      p_organization,v_account,v_name,v_phone,v_phone,v_email,v_email,
      case when v_account='fleet' then v_name end,'zh','auto-enrolled-existing-vehicles-2026-09-05',now(),false,'approved',
      case when v_account='personal' then v_owner_id end,case when v_account='fleet' then v_owner_id end,
      'Existing ERP vehicle automatically enrolled with one welcome maintenance credit.',now(),
      extensions.crypt(v_token,extensions.gen_salt('bf'))
    ) returning id into v_enrollment;
  end if;

  insert into public.zg_reward_vehicles(
    enrollment_id,organization_id,vehicle_record_id,vin,vin_normalized,plate,plate_normalized,
    state,year,make,model,engine,unit_number,driver_name,driver_phone,qualifying_count,status
  ) values (
    v_enrollment,p_organization,p_vehicle_record,
    case when length(v_vin)>=11 then v_vin else 'LEGACY-'||replace(p_vehicle_record::text,'-','') end,
    case when length(v_vin)>=11 then v_vin else 'LEGACY'||replace(p_vehicle_record::text,'-','') end,
    coalesce(nullif(trim(p_payload->>'plate'),''),'NO PLATE'),v_plate,coalesce(nullif(upper(trim(p_payload->>'state')),''),'CA'),
    coalesce(nullif(trim(p_payload->>'year'),''),'—'),coalesce(nullif(trim(p_payload->>'make'),''),'—'),
    coalesce(nullif(trim(p_payload->>'model'),''),'—'),nullif(trim(p_payload->>'engine'),''),nullif(trim(p_payload->>'unit'),''),
    nullif(trim(p_payload->>'driverName'),''),nullif(trim(p_payload->>'driverPhone'),''),1,'active'
  ) returning id into v_reward_vehicle;

  insert into public.zg_reward_events(organization_id,reward_vehicle_id,event_type,delta,note)
  values(p_organization,v_reward_vehicle,'manual_adjustment',1,'老客户车辆自动加入活动并赠送首次保养记录 / Existing-customer welcome credit');
  return v_reward_vehicle;
end $$;

create or replace function public.zg_auto_enroll_reward_vehicle_trigger()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if new.module='vehicles' then perform public.zg_auto_enroll_existing_reward_vehicle(new.organization_id,new.record_id,new.payload); end if;
  return new;
end $$;

drop trigger if exists zg_auto_enroll_reward_vehicle on public.zg_erp_records;
create trigger zg_auto_enroll_reward_vehicle
after insert or update of payload on public.zg_erp_records
for each row when (new.module='vehicles') execute function public.zg_auto_enroll_reward_vehicle_trigger();

select public.zg_auto_enroll_existing_reward_vehicle(organization_id,record_id,payload)
from public.zg_erp_records where module='vehicles' and coalesce((payload->>'archived')::boolean,false)=false;

create or replace function public.zg_submit_oil_reward_registration(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_org uuid; v_enrollment uuid; v_token text := encode(extensions.gen_random_bytes(24),'hex'); v_vehicle jsonb;
  v_account text := coalesce(p_payload->>'accountType',''); v_phone text := regexp_replace(coalesce(p_payload->>'phone',''),'[^0-9]','','g');
  v_email text := lower(trim(coalesce(p_payload->>'email',''))); v_vin text; v_plate text; v_existing public.zg_reward_vehicles; v_existing_count integer := 0;
begin
  select id into v_org from public.zg_organizations where lower(name) like '%z&g%' order by created_at limit 1;
  if v_org is null then raise exception 'Reward program is temporarily unavailable'; end if;
  if v_account not in ('personal','fleet') then raise exception 'Please select an account type'; end if;
  if length(trim(coalesce(p_payload->>'contactName',''))) < 2 or length(v_phone) < 10 or position('@' in v_email) < 2 then raise exception 'Please complete name, phone, and email'; end if;
  if v_account='fleet' and (length(trim(coalesce(p_payload->>'companyName','')))<2 or length(trim(coalesce(p_payload->>'tcpNumber','')))<2) then raise exception 'Company name and TCP number are required for fleets'; end if;
  if coalesce((p_payload->>'termsAccepted')::boolean,false) is not true or coalesce(p_payload->>'termsVersion','') <> '2026-09-05-maintenance-v6' then raise exception 'Program terms must be accepted'; end if;
  if jsonb_array_length(coalesce(p_payload->'vehicles','[]'::jsonb)) < 1 then raise exception 'At least one vehicle is required'; end if;

  for v_vehicle in select value from jsonb_array_elements(p_payload->'vehicles') loop
    v_vin := upper(regexp_replace(coalesce(v_vehicle->>'vin',''),'[^A-HJ-NPR-Z0-9]','','g'));
    v_plate := upper(regexp_replace(coalesce(v_vehicle->>'plate',''),'[^A-Z0-9]','','g'));
    if length(v_vin) < 11 or length(v_plate) < 2 then raise exception 'Every vehicle needs a valid VIN and plate'; end if;
    select rv.* into v_existing from public.zg_reward_vehicles rv
    where rv.organization_id=v_org and rv.status in ('pending','active')
      and (rv.vin_normalized=v_vin or rv.plate_normalized=v_plate)
    order by case when rv.vin_normalized=v_vin then 0 else 1 end limit 1;
    if v_existing.id is not null then v_existing_count := v_existing_count + 1; v_enrollment := v_existing.enrollment_id; end if;
  end loop;

  if v_existing_count > 0 then
    if v_existing_count <> jsonb_array_length(p_payload->'vehicles') then raise exception 'Please submit already-enrolled and new vehicles separately'; end if;
    update public.zg_reward_enrollments set access_token_hash=extensions.crypt(v_token,extensions.gen_salt('bf')) where id=v_enrollment;
    return jsonb_build_object('enrollmentId',v_enrollment,'token',v_token,'status','existing','existingCustomer',true,'qualifyingCount',coalesce(v_existing.qualifying_count,1));
  end if;

  insert into public.zg_reward_enrollments(organization_id,account_type,contact_name,phone,phone_normalized,email,email_normalized,company_name,tcp_number,preferred_language,terms_version,terms_accepted_at,sms_consent,sms_consent_at,access_token_hash)
  values(v_org,v_account,trim(p_payload->>'contactName'),trim(p_payload->>'phone'),v_phone,v_email,v_email,nullif(trim(p_payload->>'companyName'),''),nullif(trim(p_payload->>'tcpNumber'),''),coalesce(p_payload->>'preferredLanguage','zh'),'2026-09-05-maintenance-v6',now(),coalesce((p_payload->>'smsConsent')::boolean,false),case when coalesce((p_payload->>'smsConsent')::boolean,false) then now() end,extensions.crypt(v_token,extensions.gen_salt('bf')))
  returning id into v_enrollment;

  for v_vehicle in select value from jsonb_array_elements(p_payload->'vehicles') loop
    v_vin := upper(regexp_replace(coalesce(v_vehicle->>'vin',''),'[^A-HJ-NPR-Z0-9]','','g'));
    v_plate := upper(regexp_replace(coalesce(v_vehicle->>'plate',''),'[^A-Z0-9]','','g'));
    insert into public.zg_reward_vehicles(enrollment_id,organization_id,vin,vin_normalized,plate,plate_normalized,state,year,make,model,engine,unit_number,driver_name,driver_phone)
    values(v_enrollment,v_org,v_vin,v_vin,upper(trim(v_vehicle->>'plate')),v_plate,upper(coalesce(nullif(trim(v_vehicle->>'state'),''),'CA')),trim(v_vehicle->>'year'),trim(v_vehicle->>'make'),trim(v_vehicle->>'model'),nullif(trim(v_vehicle->>'engine'),''),nullif(trim(v_vehicle->>'unit'),''),nullif(trim(v_vehicle->>'driverName'),''),nullif(trim(v_vehicle->>'driverPhone'),''));
  end loop;
  return jsonb_build_object('enrollmentId',v_enrollment,'token',v_token,'status','pending','existingCustomer',false);
end $$;

grant execute on function public.zg_submit_oil_reward_registration(jsonb) to anon, authenticated;
revoke execute on function public.zg_auto_enroll_existing_reward_vehicle(uuid,uuid,jsonb) from public, anon, authenticated;

commit;
