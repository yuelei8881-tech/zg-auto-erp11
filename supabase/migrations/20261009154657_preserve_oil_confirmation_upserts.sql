-- BEFORE INSERT also runs for ON CONFLICT updates: preserve existing flags.
create or replace function zg_private.keep_oil_confirmation()
returns trigger language plpgsql set search_path='' as $$
declare existing jsonb;
begin
 if new.module='workOrders' and not (new.payload ? 'oilChangeCompleted') then
  if tg_op='INSERT' then
   select payload into existing from public.zg_erp_records
    where organization_id=new.organization_id and module=new.module and record_id=new.record_id;
   if not found then new.payload:=new.payload||'{"oilChangeCompleted":false}'::jsonb;
   elsif existing ? 'oilChangeCompleted' then
    new.payload:=new.payload||jsonb_build_object('oilChangeCompleted',existing->'oilChangeCompleted');
   end if;
  elsif old.payload ? 'oilChangeCompleted' then
   new.payload:=new.payload||jsonb_build_object('oilChangeCompleted',old.payload->'oilChangeCompleted');
  end if;
 end if;
 return new;
end $$;
revoke all on function zg_private.keep_oil_confirmation() from public,anon,authenticated;
