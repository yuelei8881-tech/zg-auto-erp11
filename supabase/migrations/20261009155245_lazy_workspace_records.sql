-- A private, transactionally maintained read model; source records are untouched.
create or replace function zg_private.workspace_payload(p_module text,p jsonb)
returns jsonb language plpgsql immutable set search_path='' as $$
begin
 if p_module='changeLogs' then return (p-'before'-'after')||'{"_detailsDeferred":true}'::jsonb; end if;
 if p_module='workOrders' then
  return (p-'customerSignature'-'evidencePhotos')||jsonb_build_object('_detailsDeferred',true,'evidencePhotos',
   coalesce((select jsonb_agg(photo-'dataUrl' order by ordinal) from jsonb_array_elements(
    case when jsonb_typeof(p->'evidencePhotos')='array' then p->'evidencePhotos' else '[]'::jsonb end) with ordinality as a(photo,ordinal)),'[]'::jsonb));
 end if;
 return p;
end $$;
revoke all on function zg_private.workspace_payload(text,jsonb) from public,anon,authenticated;
create table zg_private.workspace_records (
 organization_id uuid not null,module text not null,record_id uuid not null,payload jsonb not null,updated_at timestamptz not null,
 primary key(organization_id,module,record_id)
);
alter table zg_private.workspace_records enable row level security;
revoke all on zg_private.workspace_records from public,anon,authenticated;
create index workspace_sync_idx on zg_private.workspace_records(organization_id,updated_at desc,record_id desc,module);

create or replace function zg_private.sync_workspace_record()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='DELETE' then
  delete from zg_private.workspace_records where organization_id=old.organization_id and module=old.module and record_id=old.record_id;
  return old;
 end if;
 insert into zg_private.workspace_records(organization_id,module,record_id,payload,updated_at)
 values(new.organization_id,new.module,new.record_id,zg_private.workspace_payload(new.module,new.payload),new.updated_at)
 on conflict(organization_id,module,record_id) do update set payload=excluded.payload,updated_at=excluded.updated_at;
 return new;
end $$;
revoke all on function zg_private.sync_workspace_record() from public,anon,authenticated;
create trigger zg_workspace_sync after insert or update or delete on public.zg_erp_records
 for each row execute function zg_private.sync_workspace_record();
insert into zg_private.workspace_records select organization_id,module,record_id,zg_private.workspace_payload(module,payload),updated_at
 from public.zg_erp_records on conflict(organization_id,module,record_id) do nothing;

create or replace function public.zg_read_workspace(p_org uuid,p_since timestamptz default null,p_offset integer default 0,p_limit integer default 1000,p_module text default null)
returns table(module text,record_id uuid,payload jsonb,updated_at timestamptz)
language plpgsql stable security definer set search_path='' as $$
declare prices boolean; finances boolean; contacts boolean;
begin
 if auth.uid() is null or not public.zg_is_org_member(p_org) then raise exception 'Not authorized' using errcode='42501'; end if;
 prices:=zg_private.can(p_org,'pricing') or zg_private.can(p_org,'finance');
 finances:=zg_private.can(p_org,'finance');contacts:=zg_private.can(p_org,'customerContact');
 return query select r.module,r.record_id,
 case when r.module='settings' then jsonb_build_object('id',r.record_id,'shopName',r.payload->'shopName','address',r.payload->'address','phone',r.payload->'phone','email',r.payload->'email','invoiceTerms',r.payload->'invoiceTerms')||case when prices then r.payload else '{}'::jsonb end
 when prices and finances and contacts then r.payload
 else zg_private.redact(r.payload,prices,finances or (r.module='payments' and zg_private.can(p_org,'collectPayment')),contacts) end,
 r.updated_at from zg_private.workspace_records r
 where r.organization_id=p_org and (p_since is null or r.updated_at>p_since) and (p_module is null or r.module=p_module)
 and zg_private.readable(p_org,r.module,r.payload)
 order by r.updated_at desc,r.record_id desc,r.module limit least(greatest(p_limit,1),1000) offset greatest(p_offset,0);
end $$;
revoke all on function public.zg_read_workspace(uuid,timestamptz,integer,integer,text) from public,anon;
grant execute on function public.zg_read_workspace(uuid,timestamptz,integer,integer,text) to authenticated;

create or replace function public.zg_read_work_order(p_org uuid,p_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare r public.zg_erp_records; p jsonb;
begin
 if auth.uid() is null or not public.zg_is_org_member(p_org) then raise exception 'Not authorized' using errcode='42501'; end if;
 select * into r from public.zg_erp_records where organization_id=p_org and module='workOrders' and record_id=p_id;
 if not found or not zg_private.readable(p_org,'workOrders',r.payload) then raise exception '工单不存在或无权查看' using errcode='42501'; end if;
 p:=zg_private.redact(r.payload,zg_private.can(p_org,'pricing') or zg_private.can(p_org,'finance'),zg_private.can(p_org,'finance'),zg_private.can(p_org,'customerContact'));
 return (p-'_detailsDeferred')||jsonb_build_object('id',r.record_id,'_cloudUpdatedAt',r.updated_at);
end $$;
revoke all on function public.zg_read_work_order(uuid,uuid) from public,anon;
grant execute on function public.zg_read_work_order(uuid,uuid) to authenticated;

-- Summary-based list actions must never erase attachments or signatures.
-- Versioned RPCs have already locked and checked this row before this trigger.
create or replace function zg_private.preserve_deferred_attachments()
returns trigger language plpgsql set search_path='' as $$
declare original jsonb;
begin
 if new.module='workOrders' and new.payload->'_detailsDeferred'='true'::jsonb then
  if tg_op='UPDATE' then original:=old.payload;
  else select payload into original from public.zg_erp_records where organization_id=new.organization_id and module=new.module and record_id=new.record_id;
  end if;
  if original is null then raise exception '请读取完整工单后保存，不能用列表摘要新建工单'; end if;
  new.payload:=new.payload-'_detailsDeferred'-'evidencePhotos'-'customerSignature';
  if original ? 'evidencePhotos' then new.payload:=new.payload||jsonb_build_object('evidencePhotos',original->'evidencePhotos'); end if;
  if original ? 'customerSignature' then new.payload:=new.payload||jsonb_build_object('customerSignature',original->'customerSignature'); end if;
 end if;
 return new;
end $$;
revoke all on function zg_private.preserve_deferred_attachments() from public,anon,authenticated;
create trigger zg_preserve_deferred_attachments before insert or update on public.zg_erp_records
 for each row execute function zg_private.preserve_deferred_attachments();
create or replace function public.zg_save_operational_order(p_org uuid,p_order jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; version timestamptz; original jsonb;
begin
 if not public.zg_is_org_member(p_org) or not zg_private.can(p_org,'diagnosis') then raise exception '没有施工记录保存权限' using errcode='42501'; end if;
 perform zg_private.assert_record_version(p_org,'workOrders',p_order);
 if p_order->'_detailsDeferred'='true'::jsonb then
  select payload into original from public.zg_erp_records where organization_id=p_org and module='workOrders' and record_id=(p_order->>'id')::uuid;
  if original is null then raise exception '请读取完整工单后保存'; end if;
  p_order:=(p_order-'_detailsDeferred'-'evidencePhotos')||jsonb_build_object('evidencePhotos',coalesce(original->'evidencePhotos','[]'::jsonb));
 end if;
 result:=zg_private.zg_save_operational_order(p_org,p_order-'_cloudUpdatedAt');
 select updated_at into version from public.zg_erp_records where organization_id=p_org and module='workOrders' and record_id=(p_order->>'id')::uuid;
 return result||jsonb_build_object('_cloudUpdatedAt',version);
end $$;
revoke all on function public.zg_save_operational_order(uuid,jsonb) from public,anon;
grant execute on function public.zg_save_operational_order(uuid,jsonb) to authenticated;
notify pgrst,'reload schema';
