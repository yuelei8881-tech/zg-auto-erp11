begin;

create or replace function public.zg_recover_oil_reward_registration(p_phone text, p_vin_last6 text)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_enrollment public.zg_reward_enrollments;
  v_phone text := regexp_replace(coalesce(p_phone,''),'[^0-9]','','g');
  v_vin6 text := upper(regexp_replace(coalesce(p_vin_last6,''),'[^A-HJ-NPR-Z0-9]','','g'));
  v_token text := encode(extensions.gen_random_bytes(24),'hex');
begin
  if length(v_phone) < 10 or length(v_vin6) <> 6 then
    raise exception 'Phone number and VIN last 6 are required';
  end if;
  select e.* into v_enrollment
  from public.zg_reward_enrollments e
  join public.zg_reward_vehicles v on v.enrollment_id=e.id
  where right(e.phone_normalized,10)=right(v_phone,10)
    and right(v.vin_normalized,6)=v_vin6
    and e.status in ('pending','approved')
  order by e.created_at desc limit 1;
  if v_enrollment.id is null then raise exception 'No matching enrollment found'; end if;
  update public.zg_reward_enrollments
  set access_token_hash=extensions.crypt(v_token,extensions.gen_salt('bf'))
  where id=v_enrollment.id;
  return jsonb_build_object('token',v_token,'contactName',v_enrollment.contact_name);
end $$;

grant execute on function public.zg_recover_oil_reward_registration(text,text) to anon, authenticated;

commit;
