begin;

-- Keep reward-program reads and work-order reward matching on small indexed paths.
create index if not exists zg_reward_vehicles_org_record_active_idx
  on public.zg_reward_vehicles(organization_id,vehicle_record_id)
  where status='active' and vehicle_record_id is not null;

create index if not exists zg_reward_vehicles_enrollment_idx
  on public.zg_reward_vehicles(enrollment_id,created_at);

create index if not exists zg_reward_vehicles_org_plate_active_idx
  on public.zg_reward_vehicles(organization_id,plate_normalized)
  where status='active';

create index if not exists zg_reward_events_vehicle_created_idx
  on public.zg_reward_events(reward_vehicle_id,created_at desc);

commit;
