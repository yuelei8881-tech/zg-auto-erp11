do $migration$
declare definition text;
begin
 select pg_get_functiondef('public.zg_transfer_vehicle(uuid,uuid,text,uuid,timestamptz,text,uuid)'::regprocedure) into definition;
 if position('not in (''公司'',''车队'')' in definition)=0 then raise exception 'Unexpected target validation'; end if;
 definition:=replace(definition,'not in (''公司'',''车队'')','not in (''个人'',''公司'',''车队'')');
 definition:=replace(definition,'then ''车队'' else ''公司'' end','then ''车队'' when t.payload->>''type''=''个人'' then ''个人'' else ''公司'' end');
 definition:=replace(definition,'请选择公司或车队资料','请选择个人客户、公司或车队资料');
 definition:=replace(definition,'新公司','新车主');
 definition:=replace(definition,'email,email,owner_name,''zh''','email,email,case when owner_type=''个人'' then null else owner_name end,''zh''');
 execute definition;
end $migration$;
notify pgrst,'reload schema';
