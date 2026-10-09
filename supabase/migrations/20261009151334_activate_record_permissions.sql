-- Activate only after the frontend uses the redacted read/write RPCs.
drop policy if exists zg_records_read on public.zg_erp_records;
create policy zg_records_read on public.zg_erp_records for select to authenticated
 using (zg_private.can(organization_id,'owner'));
drop policy if exists zg_records_insert on public.zg_erp_records;
drop policy if exists zg_records_update on public.zg_erp_records;
drop policy if exists zg_records_delete on public.zg_erp_records;
create policy zg_records_insert on public.zg_erp_records for insert to authenticated with check(zg_private.can(organization_id,'owner'));
create policy zg_records_update on public.zg_erp_records for update to authenticated using(zg_private.can(organization_id,'owner')) with check(zg_private.can(organization_id,'owner'));
create policy zg_records_delete on public.zg_erp_records for delete to authenticated using(zg_private.can(organization_id,'owner'));
drop policy if exists zg_audit_read on public.zg_audit_logs;
create policy zg_audit_read on public.zg_audit_logs for select to authenticated using(zg_private.can(organization_id,'finance'));
drop policy if exists zg_customer_approvals_read on public.zg_customer_approvals;
create policy zg_customer_approvals_read on public.zg_customer_approvals for select to authenticated
 using(zg_private.can(organization_id,'pricing') and zg_private.can(organization_id,'customerContact'));
drop policy if exists zg_reward_enrollments_staff on public.zg_reward_enrollments;
drop policy if exists zg_reward_vehicles_staff on public.zg_reward_vehicles;
drop policy if exists zg_reward_events_staff on public.zg_reward_events;
create policy zg_reward_enrollments_staff on public.zg_reward_enrollments for select to authenticated using(zg_private.can(organization_id,'campaigns') and zg_private.can(organization_id,'customerContact'));
create policy zg_reward_vehicles_staff on public.zg_reward_vehicles for select to authenticated using(zg_private.can(organization_id,'campaigns'));
create policy zg_reward_events_staff on public.zg_reward_events for select to authenticated using(zg_private.can(organization_id,'campaigns'));
notify pgrst, 'reload schema';
-- A manager without financial access must not promote themselves to owner.
drop policy if exists zg_members_manage on public.zg_organization_members;
create policy zg_members_manage on public.zg_organization_members for all to authenticated
 using(zg_private.can(organization_id,'owner')) with check(zg_private.can(organization_id,'owner'));
drop policy if exists zg_invites_manage on public.zg_staff_invites;
create policy zg_invites_manage on public.zg_staff_invites for all to authenticated
 using(zg_private.can(organization_id,'owner')) with check(zg_private.can(organization_id,'owner'));
