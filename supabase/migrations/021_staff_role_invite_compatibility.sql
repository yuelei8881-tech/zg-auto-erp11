-- Permit built-in and owner-defined staff role names. Authorization continues
-- to be controlled by the per-account permissions JSON and existing RLS rules.
do $$
declare
  item record;
begin
  for item in
    select conname, conrelid::regclass as table_name
    from pg_constraint
    where contype = 'c'
      and conrelid in ('public.zg_organization_members'::regclass, 'public.zg_staff_invites'::regclass)
      and pg_get_constraintdef(oid) ilike '%role%'
  loop
    execute format('alter table %s drop constraint %I', item.table_name, item.conname);
  end loop;
end $$;

alter table public.zg_organization_members
  add constraint zg_organization_members_role_name_check
  check (length(trim(role)) between 1 and 60);

alter table public.zg_staff_invites
  add constraint zg_staff_invites_role_name_check
  check (length(trim(role)) between 1 and 60);
