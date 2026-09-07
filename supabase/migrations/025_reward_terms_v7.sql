begin;

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
  if coalesce((p_payload->>'termsAccepted')::boolean,false) is not true or coalesce(p_payload->>'termsVersion','') not in ('2026-09-05-maintenance-v6','2026-09-07-maintenance-v7') then raise exception 'Program terms must be accepted'; end if;
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
  values(v_org,v_account,trim(p_payload->>'contactName'),trim(p_payload->>'phone'),v_phone,v_email,v_email,nullif(trim(p_payload->>'companyName'),''),nullif(trim(p_payload->>'tcpNumber'),''),coalesce(p_payload->>'preferredLanguage','zh'),p_payload->>'termsVersion',now(),coalesce((p_payload->>'smsConsent')::boolean,false),case when coalesce((p_payload->>'smsConsent')::boolean,false) then now() end,extensions.crypt(v_token,extensions.gen_salt('bf')))
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

commit;
