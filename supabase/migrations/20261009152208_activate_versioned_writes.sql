-- Activate after v0.96.3 consumes authoritative save acknowledgements.
create or replace function public.zg_write_records(p_org uuid,p_records jsonb)
returns void language plpgsql security definer set search_path='' as $$
begin perform public.zg_write_records_v2(p_org,p_records); end $$;
-- Raw browser writes (including older owner clients) must not bypass versioning.
drop policy if exists zg_records_insert on public.zg_erp_records;
drop policy if exists zg_records_update on public.zg_erp_records;
drop policy if exists zg_records_delete on public.zg_erp_records;
notify pgrst, 'reload schema';
