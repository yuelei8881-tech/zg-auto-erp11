-- Existing snapshots remain intact. Future updates store reversible field deltas.
alter table public.zg_audit_logs add column if not exists payload_format text not null default 'snapshot-v1';
alter table public.zg_audit_logs add column if not exists changed_fields text[];

create or replace function public.zg_audit_erp_record()
returns trigger language plpgsql security definer set search_path='' as $$
declare before_json jsonb; after_json jsonb; keys text[]; org uuid; mod_name text; rec uuid;
begin
 if tg_op='UPDATE' then
  select array_agg(coalesce(b.key,a.key) order by coalesce(b.key,a.key)),
   coalesce(jsonb_object_agg(b.key,b.value) filter(where b.key is not null),'{}'::jsonb),
   coalesce(jsonb_object_agg(a.key,a.value) filter(where a.key is not null),'{}'::jsonb)
  into keys,before_json,after_json
  from jsonb_each(old.payload) b full join jsonb_each(new.payload) a on a.key=b.key
  where b.value is distinct from a.value;
  if keys is null then return new; end if;
 else
  before_json:=case when tg_op='DELETE' then old.payload else null end;
  after_json:=case when tg_op='INSERT' then new.payload else null end;
 end if;
 if tg_op='DELETE' then org:=old.organization_id;mod_name:=old.module;rec:=old.record_id;
 else org:=new.organization_id;mod_name:=new.module;rec:=new.record_id; end if;
 insert into public.zg_audit_logs(organization_id,actor_id,action,module,record_id,before_data,after_data,payload_format,changed_fields)
 values(org,auth.uid(),tg_op,mod_name,rec,before_json,after_json,
  case when tg_op='UPDATE' then 'changed-fields-v1' else 'snapshot-v1' end,keys);
 return case when tg_op='DELETE' then old else new end;
end $$;
revoke all on function public.zg_audit_erp_record() from public,anon,authenticated;
