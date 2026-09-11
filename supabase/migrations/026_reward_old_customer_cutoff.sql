begin;

-- A vehicle receives the one-time existing-customer credit only when its ERP
-- vehicle record existed before the campaign launched in Los Angeles.
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
  v_vehicle_created_at timestamptz;
  v_is_existing_customer boolean := false;
begin
  if coalesce((p_payload->>'archived')::boolean,false) or (length(v_vin) < 11 and length(v_plate) < 2) then return null; end if;

  select created_at into v_vehicle_created_at
  from public.zg_erp_records
  where organization_id=p_organization and module='vehicles' and record_id=p_vehicle_record
  limit 1;
  v_is_existing_customer := v_vehicle_created_at < timestamptz '2026-09-05 07:00:00+00';

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
      case when v_account='fleet' then v_name end,'zh','auto-enrolled-erp-vehicles-2026-09-05',now(),false,'approved',
      case when v_account='personal' then v_owner_id end,case when v_account='fleet' then v_owner_id end,
      case when v_is_existing_customer then 'Existing ERP vehicle automatically enrolled with one welcome maintenance credit.' else 'Post-launch ERP vehicle automatically enrolled without a welcome credit.' end,
      now(),extensions.crypt(v_token,extensions.gen_salt('bf'))
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
    nullif(trim(p_payload->>'driverName'),''),nullif(trim(p_payload->>'driverPhone'),''),case when v_is_existing_customer then 1 else 0 end,'active'
  ) returning id into v_reward_vehicle;

  if v_is_existing_customer then
    insert into public.zg_reward_events(organization_id,reward_vehicle_id,event_type,delta,note)
    values(p_organization,v_reward_vehicle,'manual_adjustment',1,'老客户车辆自动加入活动并赠送首次保养记录 / Existing-customer welcome credit');
  end if;
  return v_reward_vehicle;
end $$;

-- Correct post-launch vehicles that were previously given the old-customer
-- credit. Keep an audit trail instead of deleting history.
with invalid as (
  select rv.id, rv.organization_id
  from public.zg_reward_vehicles rv
  join public.zg_erp_records vr
    on vr.organization_id=rv.organization_id and vr.module='vehicles' and vr.record_id=rv.vehicle_record_id
  where vr.created_at >= timestamptz '2026-09-05 07:00:00+00'
    and rv.qualifying_count > 0
    and exists (
      select 1 from public.zg_reward_events w
      where w.reward_vehicle_id=rv.id and w.event_type='manual_adjustment' and w.delta=1
        and w.note ilike '%Existing-customer welcome credit%'
    )
    and not exists (
      select 1 from public.zg_reward_events c
      where c.reward_vehicle_id=rv.id and c.event_type='manual_adjustment' and c.delta=-1
        and c.note='纠正：车辆在活动开始后录入，不属于老客户首次赠送 / Correction: post-launch vehicle is not eligible for welcome credit'
    )
), corrected as (
  update public.zg_reward_vehicles rv
  set qualifying_count=greatest(0,rv.qualifying_count-1),
      reward_earned_at=case when rv.qualifying_count-1<5 and rv.reward_redeemed_at is null then null else rv.reward_earned_at end,
      reward_expires_at=case when rv.qualifying_count-1<5 and rv.reward_redeemed_at is null then null else rv.reward_expires_at end,
      updated_at=now()
  from invalid i where rv.id=i.id
  returning rv.id,rv.organization_id
)
insert into public.zg_reward_events(organization_id,reward_vehicle_id,event_type,delta,note)
select organization_id,id,'manual_adjustment',-1,
  '纠正：车辆在活动开始后录入，不属于老客户首次赠送 / Correction: post-launch vehicle is not eligible for welcome credit'
from corrected;

revoke execute on function public.zg_auto_enroll_existing_reward_vehicle(uuid,uuid,jsonb) from public, anon, authenticated;

commit;
