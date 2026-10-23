create or replace function zg_private.dashboard_summary(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path='' set jit=off as $$
declare
 caller text:=auth.uid()::text; all_orders boolean; assigned boolean; claim boolean;
 finance boolean; pricing boolean; customers boolean; contacts boolean;
 d text:=to_char(now() at time zone 'America/Los_Angeles','YYYY-MM-DD');
 result jsonb;
begin
 if auth.uid() is null or not public.zg_is_org_member(p_org) then raise exception 'Not authorized' using errcode='42501'; end if;
 all_orders:=zg_private.can(p_org,'workOrders');
 assigned:=zg_private.can(p_org,'assignedWorkOrders'); claim:=zg_private.can(p_org,'claimWorkOrders');
 finance:=zg_private.can(p_org,'finance'); pricing:=finance or zg_private.can(p_org,'pricing');
 customers:=zg_private.can(p_org,'customers'); contacts:=zg_private.can(p_org,'customerContact');
 with orders as materialized (
  select record_id id,payload p,zg_private.summary_day(payload->>'date') date_key
  from zg_private.workspace_records where organization_id=p_org and module='workOrders'
  and zg_private.summary_active(payload)
  and (all_orders or (assigned and (payload->>'technicianUserId'=caller or (claim and coalesce(payload->>'technicianUserId','')=''))))
 ), payments as materialized (
  select payload p,zg_private.summary_day(payload->>'date') date_key from zg_private.workspace_records
  where organization_id=p_org and module='payments' and finance
 ), expenses as materialized (
  select payload p,zg_private.summary_day(payload->>'date') date_key from zg_private.workspace_records
  where organization_id=p_org and module='expenses' and finance and zg_private.summary_active(payload)
 ), ledger as (
  select p->>'workOrderId' id,round(sum(coalesce(nullif(p->>'amount','')::numeric,0)),2) paid
  from payments where coalesce(p->>'workOrderId','')<>'' and coalesce(p->>'archivedAt','')='' group by 1
 ), components as materialized (
  select o.*,
   case when jsonb_typeof(p->'laborItems')='array' then
    (select coalesce(sum(greatest(0,coalesce(nullif(i->>'qty','')::numeric,1))*case when i->>'billingMode'='flat' then coalesce(nullif(i->>'flatAmount','')::numeric,0) else coalesce(nullif(i->>'hours','')::numeric,0)*coalesce(nullif(i->>'rate','')::numeric,0) end),0) from jsonb_array_elements(p->'laborItems') i)
   else coalesce(nullif(p->>'laborHours','')::numeric,0)*coalesce(nullif(p->>'laborRate','')::numeric,0) end labor,
   case when jsonb_typeof(p->'partItems')='array' then
    (select coalesce(sum(coalesce(nullif(i->>'qty','')::numeric,0)*coalesce(nullif(i->>'price','')::numeric,0)),0) from jsonb_array_elements(p->'partItems') i)
   else coalesce(nullif(p->>'partsTotal','')::numeric,0) end parts,
   case when jsonb_typeof(p->'partItems')='array' then
    (select coalesce(sum(coalesce(nullif(i->>'qty','')::numeric,0)*coalesce(nullif(i->>'cost','')::numeric,0)),0) from jsonb_array_elements(p->'partItems') i)
   else case when coalesce(nullif(p->>'partsTotal','')::numeric,0)<>0 then coalesce(nullif(p->>'partsCost','')::numeric,0) else 0 end end cost
  from orders o where pricing
 ), taxed as materialized (
  select *,case when p ? 'taxOverride' then greatest(0,coalesce(nullif(p->>'taxOverride','')::numeric,0)) else greatest(0,parts)*coalesce(nullif(p->>'taxRate','')::numeric,0)/100 end tax from components
 ), totals as materialized (
  select *,case when p ? 'settlementTotal' then greatest(0,coalesce(nullif(p->>'settlementTotal','')::numeric,0)) else greatest(0,labor+parts+coalesce(nullif(p->>'outsource','')::numeric,0)+tax-coalesce(nullif(p->>'discount','')::numeric,0)) end total from taxed
 ), figures as materialized (
  select t.*,floor((total-tax-cost-coalesce(nullif(p->>'outsource','')::numeric,0))*100+0.5)/100 gross,
   greatest(0,total-coalesce(l.paid,coalesce(nullif(p->>'paid','')::numeric,0))) balance
  from totals t left join ledger l on l.id=t.id::text
 ), payment_totals as (
  select coalesce(sum(coalesce(nullif(p->>'amount','')::numeric,0)) filter(where date_key=d),0) today,
   coalesce(sum(coalesce(nullif(p->>'amount','')::numeric,0)) filter(where left(date_key,7)=left(d,7)),0) monthly,
   coalesce(sum(coalesce(nullif(p->>'amount','')::numeric,0)),0) total from payments where zg_private.summary_active(p)
 ), expense_totals as (
  select coalesce(sum(coalesce(nullif(p->>'amount','')::numeric,0)) filter(where date_key=d),0) today,
   coalesce(sum(coalesce(nullif(p->>'amount','')::numeric,0)) filter(where date_key=d and p->>'category'='配件采购'),0) parts,
   coalesce(sum(coalesce(nullif(p->>'amount','')::numeric,0)) filter(where left(date_key,7)=left(d,7)),0) monthly,
   coalesce(sum(coalesce(nullif(p->>'amount','')::numeric,0)),0) total from expenses
 ), vehicles as materialized (
  select record_id id,payload p from zg_private.workspace_records where organization_id=p_org and module='vehicles' and customers and coalesce(payload->>'archived','false')<>'true'
 )
 select jsonb_build_object('generatedAt',now(),'metrics',
  case when pricing then (select jsonb_build_object('todaySales',coalesce(sum(total) filter(where date_key=d),0),'monthSales',coalesce(sum(total) filter(where left(date_key,7)=left(d,7)),0)) from figures) else '{}'::jsonb end ||
  case when finance then (select jsonb_build_object('todayGross',coalesce(sum(gross) filter(where date_key=d),0),'receivables',coalesce(sum(balance),0)) from figures) ||
   (select jsonb_build_object('todayReceived',pt.today,'monthReceived',pt.monthly,'monthExpenses',et.monthly,'monthNet',pt.monthly-et.monthly,'todayExpenses',et.today,'todayPartsExpenses',et.parts,'monthBookBalance',pt.total-et.total) from payment_totals pt cross join expense_totals et)
   else '{}'::jsonb end,
  'operations',(select jsonb_build_object('orders',count(*),'waiting',count(*) filter(where p->>'status'='等待检查'),'repairing',count(*) filter(where p->>'status'='维修中'),'completed',count(*) filter(where date_key=d and p->>'status'='已完成')) from orders),
  'relationships',case when customers then jsonb_build_object(
   'customers',(select count(distinct case when contacts and regexp_replace(coalesce(payload->>'phone',''),'\D','','g')<>'' then 'phone:'||regexp_replace(regexp_replace(payload->>'phone','\D','','g'),'^1([0-9]{10})$','\1') when contacts and btrim(coalesce(payload->>'email',''))<>'' then 'email:'||regexp_replace(lower(btrim(payload->>'email')),'\s+',' ','g') else record_id::text end) from zg_private.workspace_records where organization_id=p_org and module='customers' and coalesce(payload->>'archived','false')<>'true'),
   'fleets',(select count(*) from zg_private.workspace_records where organization_id=p_org and module='fleets' and coalesce(payload->>'archived','false')<>'true'),
   'vehicles',(select count(*) from vehicles),
   'servicedVehicles',(select count(*) from vehicles v where exists(select 1 from orders o where o.p->>'vehicleId'=v.id::text)),
   'newVehiclesThisMonth',(select count(*) from vehicles v where left(coalesce(zg_private.summary_day(nullif(v.p->>'createdAt','')),(select min(o.date_key) from orders o where o.p->>'vehicleId'=v.id::text or (coalesce(v.p->>'plate','')<>'' and upper(regexp_replace(o.p->>'plate','[^a-zA-Z0-9]','','g'))=upper(regexp_replace(v.p->>'plate','[^a-zA-Z0-9]','','g'))) or (coalesce(v.p->>'vin','')<>'' and upper(regexp_replace(o.p->>'vin','[^a-zA-Z0-9]','','g'))=upper(regexp_replace(v.p->>'vin','[^a-zA-Z0-9]','','g'))))),7)=left(d,7))
  ) else null end) into result;
 return result;
end $$;
