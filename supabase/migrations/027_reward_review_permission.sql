begin;

create or replace function public.zg_review_oil_reward_enrollment(p_enrollment uuid, p_approve boolean, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  e public.zg_reward_enrollments;
  v public.zg_reward_vehicles;
  v_owner uuid;
  v_vehicle uuid;
  v_authorized boolean := false;
begin
  select * into e from public.zg_reward_enrollments where id=p_enrollment for update;
  if e.id is null then raise exception '找不到这份活动报名'; end if;

  select exists(
    select 1 from public.zg_organization_members m
    where m.organization_id=e.organization_id and m.user_id=auth.uid() and m.status='active'
      and (m.role in ('owner','manager','frontdesk') or coalesce((m.permissions->>'approve')::boolean,false))
  ) into v_authorized;
  if not v_authorized then raise exception '当前账号没有活动审批权限'; end if;

  if not p_approve then
    update public.zg_reward_enrollments set status='rejected',review_note=p_note,reviewed_at=now(),reviewed_by=auth.uid() where id=e.id;
    return jsonb_build_object('status','rejected');
  end if;
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

revoke execute on function public.zg_review_oil_reward_enrollment(uuid,boolean,text) from public, anon;
grant execute on function public.zg_review_oil_reward_enrollment(uuid,boolean,text) to authenticated;

commit;
