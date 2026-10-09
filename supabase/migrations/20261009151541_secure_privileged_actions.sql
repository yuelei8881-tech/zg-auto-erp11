-- Guard legacy privileged RPCs with the same current permission model.
alter function public.zg_set_oil_reward_count(uuid,integer,text) set schema zg_private;
revoke all on function zg_private.zg_set_oil_reward_count(uuid,integer,text) from public,anon,authenticated;
create function public.zg_set_oil_reward_count(p_reward_vehicle uuid,p_count integer,p_note text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare org uuid;
begin
 select organization_id into org from public.zg_reward_vehicles where id=p_reward_vehicle;
 if not zg_private.can(org,'campaigns') then raise exception '没有活动管理权限' using errcode='42501'; end if;
 return zg_private.zg_set_oil_reward_count(p_reward_vehicle,p_count,p_note);
end $$;
revoke all on function public.zg_set_oil_reward_count(uuid,integer,text) from public,anon;
grant execute on function public.zg_set_oil_reward_count(uuid,integer,text) to authenticated;

alter function public.zg_review_oil_reward_enrollment(uuid,boolean,text) set schema zg_private;
revoke all on function zg_private.zg_review_oil_reward_enrollment(uuid,boolean,text) from public,anon,authenticated;
create function public.zg_review_oil_reward_enrollment(p_enrollment uuid,p_approve boolean,p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare org uuid;
begin
 select organization_id into org from public.zg_reward_enrollments where id=p_enrollment;
 if not zg_private.can(org,'campaigns') or not zg_private.can(org,'customerContact') then raise exception '没有活动登记审核权限' using errcode='42501'; end if;
 return zg_private.zg_review_oil_reward_enrollment(p_enrollment,p_approve,p_note);
end $$;
revoke all on function public.zg_review_oil_reward_enrollment(uuid,boolean,text) from public,anon;
grant execute on function public.zg_review_oil_reward_enrollment(uuid,boolean,text) to authenticated;

alter function public.zg_create_customer_approval(uuid,uuid,text,text,jsonb) set schema zg_private;
revoke all on function zg_private.zg_create_customer_approval(uuid,uuid,text,text,jsonb) from public,anon,authenticated;
create function public.zg_create_customer_approval(p_organization_id uuid,p_work_order_id uuid,p_customer_email text,p_customer_name text,p_snapshot jsonb)
returns text language plpgsql security definer set search_path = '' as $$
begin
 if not zg_private.can(p_organization_id,'pricing') or not zg_private.can(p_organization_id,'customerContact') then raise exception '没有发送客户报价确认的权限' using errcode='42501'; end if;
 return zg_private.zg_create_customer_approval(p_organization_id,p_work_order_id,p_customer_email,p_customer_name,p_snapshot);
end $$;
revoke all on function public.zg_create_customer_approval(uuid,uuid,text,text,jsonb) from public,anon;
grant execute on function public.zg_create_customer_approval(uuid,uuid,text,text,jsonb) to authenticated;

create or replace function zg_private.writable(p_org uuid,p_module text)
returns boolean language sql stable set search_path = '' as $$
 select zg_private.can(p_org,'owner') or case
 when p_module='workOrders' then zg_private.can(p_org,'pricing') and zg_private.can(p_org,'workOrders')
 when p_module in ('customers','vehicles','fleets','drivers') then zg_private.can(p_org,'customers') and zg_private.can(p_org,'customerContact')
 when p_module in ('parts','inventoryLogs') then zg_private.can(p_org,'inventory') and (zg_private.can(p_org,'pricing') or zg_private.can(p_org,'finance'))
 when p_module='payments' then zg_private.can(p_org,'finance') and (zg_private.can(p_org,'collectPayment') or zg_private.can(p_org,'approve'))
 when p_module='expenses' then zg_private.can(p_org,'finance')
 when p_module='servicePackages' then zg_private.can(p_org,'pricing')
 when p_module in ('campaigns','warranties') then zg_private.can(p_org,'campaigns')
 when p_module='settings' then zg_private.can(p_org,'settings')
 when p_module='approvalRequests' then zg_private.can(p_org,'finance') and zg_private.can(p_org,'approve')
 when p_module='changeLogs' then zg_private.can(p_org,'pricing') or zg_private.can(p_org,'diagnosis') else false end
$$;
revoke all on function zg_private.writable(uuid,text) from public,anon,authenticated;
notify pgrst, 'reload schema';
