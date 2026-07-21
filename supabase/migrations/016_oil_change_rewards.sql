begin;

create extension if not exists pgcrypto;

create table if not exists public.zg_reward_enrollments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.zg_organizations(id) on delete cascade,
  account_type text not null check (account_type in ('personal','fleet')),
  contact_name text not null, phone text not null, phone_normalized text not null,
  email text not null, email_normalized text not null,
  company_name text, tcp_number text, preferred_language text not null default 'zh',
  terms_version text not null, terms_accepted_at timestamptz not null,
  sms_consent boolean not null default false, sms_consent_at timestamptz,
  status text not null default 'pending' check (status in ('pending','approved','rejected','duplicate')),
  customer_record_id uuid, fleet_record_id uuid, review_note text,
  access_token_hash text not null unique, submitted_ip_hash text,
  created_at timestamptz not null default now(), reviewed_at timestamptz, reviewed_by uuid references auth.users(id)
);

create table if not exists public.zg_reward_vehicles (
  id uuid primary key default gen_random_uuid(), enrollment_id uuid not null references public.zg_reward_enrollments(id) on delete cascade,
  organization_id uuid not null references public.zg_organizations(id) on delete cascade,
  vehicle_record_id uuid, vin text not null, vin_normalized text not null, plate text not null, plate_normalized text not null,
  state text not null default 'CA', year text not null, make text not null, model text not null, engine text,
  unit_number text, driver_name text, driver_phone text,
  qualifying_count integer not null default 0 check (qualifying_count between 0 and 5),
  reward_earned_at timestamptz, reward_expires_at timestamptz, reward_redeemed_at timestamptz,
  status text not null default 'pending' check (status in ('pending','active','duplicate','inactive')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create unique index if not exists zg_reward_active_vin_idx on public.zg_reward_vehicles(organization_id,vin_normalized) where status in ('pending','active');
create index if not exists zg_reward_enrollments_org_idx on public.zg_reward_enrollments(organization_id,created_at desc);

create table if not exists public.zg_reward_events (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.zg_organizations(id) on delete cascade,
  reward_vehicle_id uuid not null references public.zg_reward_vehicles(id) on delete cascade,
  event_type text not null check (event_type in ('qualifying_service','manual_adjustment','reward_earned','reward_redeemed','reversal')),
  delta integer not null default 0, work_order_record_id uuid, work_order_number text, service_at timestamptz,
  note text, created_by uuid references auth.users(id), created_at timestamptz not null default now()
);
create unique index if not exists zg_reward_event_work_order_idx on public.zg_reward_events(reward_vehicle_id,work_order_record_id,event_type) where work_order_record_id is not null;

alter table public.zg_reward_enrollments enable row level security;
alter table public.zg_reward_vehicles enable row level security;
alter table public.zg_reward_events enable row level security;

drop policy if exists zg_reward_enrollments_staff on public.zg_reward_enrollments;
create policy zg_reward_enrollments_staff on public.zg_reward_enrollments for all using (public.zg_is_org_member(organization_id)) with check (public.zg_is_org_member(organization_id));
drop policy if exists zg_reward_vehicles_staff on public.zg_reward_vehicles;
create policy zg_reward_vehicles_staff on public.zg_reward_vehicles for all using (public.zg_is_org_member(organization_id)) with check (public.zg_is_org_member(organization_id));
drop policy if exists zg_reward_events_staff on public.zg_reward_events;
create policy zg_reward_events_staff on public.zg_reward_events for all using (public.zg_is_org_member(organization_id)) with check (public.zg_is_org_member(organization_id));

create or replace function public.zg_submit_oil_reward_registration(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_org uuid; v_enrollment uuid; v_token text := encode(gen_random_bytes(24),'hex'); v_vehicle jsonb;
  v_account text := coalesce(p_payload->>'accountType',''); v_phone text := regexp_replace(coalesce(p_payload->>'phone',''),'[^0-9]','','g');
  v_email text := lower(trim(coalesce(p_payload->>'email',''))); v_vin text; v_plate text;
begin
  select id into v_org from public.zg_organizations where lower(name) like '%z&g%' order by created_at limit 1;
  if v_org is null then raise exception 'Reward program is temporarily unavailable'; end if;
  if v_account not in ('personal','fleet') then raise exception 'Please select an account type'; end if;
  if length(trim(coalesce(p_payload->>'contactName',''))) < 2 or length(v_phone) < 10 or position('@' in v_email) < 2 then raise exception 'Please complete name, phone, and email'; end if;
  if v_account='fleet' and (length(trim(coalesce(p_payload->>'companyName','')))<2 or length(trim(coalesce(p_payload->>'tcpNumber','')))<2) then raise exception 'Company name and TCP number are required for fleets'; end if;
  if coalesce((p_payload->>'termsAccepted')::boolean,false) is not true or coalesce(p_payload->>'termsVersion','') <> '2026-07-20-v1' then raise exception 'Program terms must be accepted'; end if;
  if jsonb_array_length(coalesce(p_payload->'vehicles','[]'::jsonb)) < 1 then raise exception 'At least one vehicle is required'; end if;

  for v_vehicle in select value from jsonb_array_elements(p_payload->'vehicles') loop
    v_vin := upper(regexp_replace(coalesce(v_vehicle->>'vin',''),'[^A-HJ-NPR-Z0-9]','','g'));
    v_plate := upper(regexp_replace(coalesce(v_vehicle->>'plate',''),'[^A-Z0-9]','','g'));
    if length(v_vin) < 11 or length(v_plate) < 2 then raise exception 'Every vehicle needs a valid VIN and plate'; end if;
    if exists(select 1 from public.zg_reward_vehicles where organization_id=v_org and vin_normalized=v_vin and status in ('pending','active')) then raise exception 'Vehicle already enrolled: %', v_vin; end if;
  end loop;

  insert into public.zg_reward_enrollments(organization_id,account_type,contact_name,phone,phone_normalized,email,email_normalized,company_name,tcp_number,preferred_language,terms_version,terms_accepted_at,sms_consent,sms_consent_at,access_token_hash)
  values(v_org,v_account,trim(p_payload->>'contactName'),trim(p_payload->>'phone'),v_phone,v_email,v_email,nullif(trim(p_payload->>'companyName'),''),nullif(trim(p_payload->>'tcpNumber'),''),coalesce(p_payload->>'preferredLanguage','zh'),'2026-07-20-v1',now(),coalesce((p_payload->>'smsConsent')::boolean,false),case when coalesce((p_payload->>'smsConsent')::boolean,false) then now() end,crypt(v_token,gen_salt('bf')))
  returning id into v_enrollment;

  for v_vehicle in select value from jsonb_array_elements(p_payload->'vehicles') loop
    v_vin := upper(regexp_replace(coalesce(v_vehicle->>'vin',''),'[^A-HJ-NPR-Z0-9]','','g'));
    v_plate := upper(regexp_replace(coalesce(v_vehicle->>'plate',''),'[^A-Z0-9]','','g'));
    insert into public.zg_reward_vehicles(enrollment_id,organization_id,vin,vin_normalized,plate,plate_normalized,state,year,make,model,engine,unit_number,driver_name,driver_phone)
    values(v_enrollment,v_org,v_vin,v_vin,upper(trim(v_vehicle->>'plate')),v_plate,upper(coalesce(nullif(trim(v_vehicle->>'state'),''),'CA')),trim(v_vehicle->>'year'),trim(v_vehicle->>'make'),trim(v_vehicle->>'model'),nullif(trim(v_vehicle->>'engine'),''),nullif(trim(v_vehicle->>'unit'),''),nullif(trim(v_vehicle->>'driverName'),''),nullif(trim(v_vehicle->>'driverPhone'),''));
  end loop;
  return jsonb_build_object('enrollmentId',v_enrollment,'token',v_token,'status','pending');
end $$;

create or replace function public.zg_get_oil_reward_registration(p_token text)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare v_enrollment public.zg_reward_enrollments; begin
  select * into v_enrollment from public.zg_reward_enrollments where access_token_hash=crypt(p_token,access_token_hash);
  if v_enrollment.id is null then raise exception 'Invalid progress link'; end if;
  return jsonb_build_object('status',v_enrollment.status,'contactName',v_enrollment.contact_name,'vehicles',(select coalesce(jsonb_agg(jsonb_build_object('id',v.id,'vinLast6',right(v.vin_normalized,6),'plate',v.plate,'year',v.year,'make',v.make,'model',v.model,'count',v.qualifying_count,'rewardEarnedAt',v.reward_earned_at,'rewardExpiresAt',v.reward_expires_at,'rewardRedeemedAt',v.reward_redeemed_at,'status',v.status) order by v.created_at),'[]'::jsonb) from public.zg_reward_vehicles v where v.enrollment_id=v_enrollment.id));
end $$;

create or replace function public.zg_review_oil_reward_enrollment(p_enrollment uuid, p_approve boolean, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare e public.zg_reward_enrollments; v public.zg_reward_vehicles; v_owner uuid; v_vehicle uuid;
begin
  select * into e from public.zg_reward_enrollments where id=p_enrollment for update;
  if e.id is null or not public.zg_has_org_role(e.organization_id,array['owner','manager','frontdesk']) then raise exception 'Not authorized'; end if;
  if not p_approve then update public.zg_reward_enrollments set status='rejected',review_note=p_note,reviewed_at=now(),reviewed_by=auth.uid() where id=e.id; return jsonb_build_object('status','rejected'); end if;
  if e.account_type='fleet' then
    select record_id into v_owner from public.zg_erp_records where organization_id=e.organization_id and module='fleets' and (regexp_replace(coalesce(payload->>'phone',''),'[^0-9]','','g')=e.phone_normalized or lower(coalesce(payload->>'company',''))=lower(coalesce(e.company_name,'')) or (e.tcp_number is not null and lower(coalesce(payload->>'tcpNumber',payload->>'notes','')) like '%'||lower(e.tcp_number)||'%')) limit 1;
    if v_owner is null then v_owner:=gen_random_uuid(); insert into public.zg_erp_records(organization_id,module,record_id,payload,updated_by) values(e.organization_id,'fleets',v_owner,jsonb_build_object('id',v_owner,'company',e.company_name,'contact',e.contact_name,'phone',e.phone,'billingEmail',e.email,'notes',case when e.tcp_number is null then '' else 'TCP '||e.tcp_number end),auth.uid()); end if;
    update public.zg_reward_enrollments set fleet_record_id=v_owner where id=e.id;
  else
    select record_id into v_owner from public.zg_erp_records where organization_id=e.organization_id and module='customers' and (regexp_replace(coalesce(payload->>'phone',''),'[^0-9]','','g')=e.phone_normalized or lower(coalesce(payload->>'email',''))=e.email_normalized) limit 1;
    if v_owner is null then v_owner:=gen_random_uuid(); insert into public.zg_erp_records(organization_id,module,record_id,payload,updated_by) values(e.organization_id,'customers',v_owner,jsonb_build_object('id',v_owner,'type','个人','name',e.contact_name,'phone',e.phone,'email',e.email,'notes',case when e.tcp_number is null then '' else 'TCP '||e.tcp_number end),auth.uid()); end if;
    update public.zg_reward_enrollments set customer_record_id=v_owner where id=e.id;
  end if;
  for v in select * from public.zg_reward_vehicles where enrollment_id=e.id loop
    select record_id into v_vehicle from public.zg_erp_records where organization_id=e.organization_id and module='vehicles' and (upper(regexp_replace(coalesce(payload->>'vin',''),'[^A-Z0-9]','','g'))=v.vin_normalized or upper(regexp_replace(coalesce(payload->>'plate',''),'[^A-Z0-9]','','g'))=v.plate_normalized) limit 1;
    if v_vehicle is null then v_vehicle:=gen_random_uuid(); insert into public.zg_erp_records(organization_id,module,record_id,payload,updated_by) values(e.organization_id,'vehicles',v_vehicle,jsonb_build_object('id',v_vehicle,'ownerType',case when e.account_type='fleet' then '车队' else '个人' end,'ownerId',v_owner,'ownerName',case when e.account_type='fleet' then e.company_name else e.contact_name end,'unit',coalesce(v.unit_number,''),'plate',v.plate,'state',v.state,'vin',v.vin,'year',v.year,'make',v.make,'model',v.model,'engine',coalesce(v.engine,''),'driverName',coalesce(v.driver_name,''),'driverPhone',coalesce(v.driver_phone,''),'notes','客户活动预登记资料；车辆到店后必须用 VIN/车牌扫描并由员工核对，正式到店资料优先。 / Customer reward pre-registration; verify at arrival. Shop-verified ERP data controls.'),auth.uid()); end if;
    update public.zg_reward_vehicles set vehicle_record_id=v_vehicle,status='active',updated_at=now() where id=v.id;
  end loop;
  update public.zg_reward_enrollments set status='approved',review_note=p_note,reviewed_at=now(),reviewed_by=auth.uid() where id=e.id;
  return jsonb_build_object('status','approved','ownerRecordId',v_owner);
end $$;

grant execute on function public.zg_submit_oil_reward_registration(jsonb) to anon, authenticated;
grant execute on function public.zg_get_oil_reward_registration(text) to anon, authenticated;
grant execute on function public.zg_review_oil_reward_enrollment(uuid,boolean,text) to authenticated;
grant select,insert,update on public.zg_reward_enrollments, public.zg_reward_vehicles, public.zg_reward_events to authenticated;

commit;
