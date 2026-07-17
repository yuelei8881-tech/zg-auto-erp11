-- Store repair evidence outside the work-order JSON payload.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('zg-evidence', 'zg-evidence', false, 10485760, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists zg_evidence_read on storage.objects;
create policy zg_evidence_read on storage.objects for select to authenticated
using (
  bucket_id = 'zg-evidence'
  and public.zg_is_org_member(((storage.foldername(name))[1])::uuid)
);

drop policy if exists zg_evidence_insert on storage.objects;
create policy zg_evidence_insert on storage.objects for insert to authenticated
with check (
  bucket_id = 'zg-evidence'
  and public.zg_is_org_member(((storage.foldername(name))[1])::uuid)
);

drop policy if exists zg_evidence_update on storage.objects;
create policy zg_evidence_update on storage.objects for update to authenticated
using (
  bucket_id = 'zg-evidence'
  and public.zg_is_org_member(((storage.foldername(name))[1])::uuid)
)
with check (
  bucket_id = 'zg-evidence'
  and public.zg_is_org_member(((storage.foldername(name))[1])::uuid)
);

drop policy if exists zg_evidence_delete on storage.objects;
create policy zg_evidence_delete on storage.objects for delete to authenticated
using (
  bucket_id = 'zg-evidence'
  and public.zg_has_org_role(((storage.foldername(name))[1])::uuid, array['owner','manager','frontdesk'])
);
