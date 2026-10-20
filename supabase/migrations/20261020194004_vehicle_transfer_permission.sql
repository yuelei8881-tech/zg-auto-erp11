-- Explicit, opt-in permission; no existing employee grants are changed.
do $migration$
declare definition text;
begin
 select pg_get_functiondef('public.zg_transfer_vehicle(uuid,uuid,text,uuid,timestamptz,text,uuid)'::regprocedure) into definition;
 if position('role=''owner'' and status=''active''' in definition)=0 then
  raise exception 'Unexpected transfer authorization definition'; end if;
 definition:=replace(definition,'role=''owner'' and status=''active''',
  'status=''active'' and (role=''owner'' or permissions->''transferVehicle''=''true''::jsonb)');
 definition:=replace(definition,'只有店主账号可以办理车辆过户','当前账号没有车辆过户权限，请联系店主授权');
 execute definition;
end $migration$;
notify pgrst,'reload schema';
