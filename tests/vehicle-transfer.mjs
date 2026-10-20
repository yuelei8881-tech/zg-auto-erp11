import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
const sql = name => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');
const db = new PGlite({ extensions: { pgcrypto } });
await db.exec(`
create role anon; create role authenticated;
create schema auth; create schema extensions; create schema zg_private;
create extension pgcrypto with schema extensions;
create function auth.uid() returns uuid language sql stable as
$$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key);
create table zg_organizations(id uuid primary key,name text,created_at timestamptz default now());
create table zg_organization_members(organization_id uuid,user_id uuid,role text,status text,permissions jsonb default '{}');
create table zg_erp_records(organization_id uuid,module text,record_id uuid,payload jsonb,
 created_by uuid default auth.uid(),updated_by uuid default auth.uid(),
 created_at timestamptz default clock_timestamp(),updated_at timestamptz default clock_timestamp(),
 primary key(organization_id,module,record_id));
create function update_time() returns trigger language plpgsql as $$begin new.updated_at=clock_timestamp(); return new; end$$;
create trigger update_time before update on zg_erp_records for each row execute function update_time();
create function zg_is_org_member(uuid) returns boolean language sql as $$select true$$;
create function zg_private.can(uuid,text) returns boolean language sql as $$select true$$;
create function zg_private.readable(uuid,text,jsonb) returns boolean language sql as $$select true$$;
`);
// Use actual production table constraints, unique indexes and actual auto-enrollment.
const initial = sql('016_oil_change_rewards.sql');
await db.exec(initial.slice(initial.indexOf('create table'), initial.indexOf('alter table')));
const auto = sql('026_reward_old_customer_cutoff.sql');
await db.exec(auto.slice(auto.indexOf('create or replace function'), auto.indexOf('end $$;') + 7));
await db.exec(`create function auto_enroll() returns trigger language plpgsql as $$begin
 if new.module='vehicles' then perform public.zg_auto_enroll_existing_reward_vehicle(new.organization_id,new.record_id,new.payload); end if;
 return new; end$$;
create trigger auto_enroll after insert or update on zg_erp_records for each row execute function auto_enroll();`);
await db.exec(sql('20261009153733_verified_oil_service_credits.sql'));
await db.exec(sql('20261009154220_qualify_reward_lookup_variables.sql'));
await db.exec(`create trigger oil_credit after insert or update on zg_erp_records for each row execute function zg_sync_oil_reward_work_order()`);
// Load the real registration implementation, so transfer privacy guard is tested.
const registration = sql('022_auto_enroll_existing_reward_vehicles.sql');
const regStart = registration.indexOf('create or replace function public.zg_submit_oil_reward_registration');
await db.exec(registration.slice(regStart, registration.indexOf('end $$;', regStart) + 7));
await db.exec(sql('20261020183215_vehicle_ownership_transfer.sql'));
const org=randomUUID(), owner=randomUUID(), worker=randomUUID(), oldCompany=randomUUID(), company=randomUUID(), fleet=randomUUID(), car=randomUUID(), otherCar=randomUUID();
await db.query("insert into auth.users values($1),($2)",[owner,worker]);
await db.query("insert into zg_organizations(id,name) values($1,'Z&G test')",[org]);
await db.query("insert into zg_organization_members(organization_id,user_id,role,status) values($1,$2,'owner','active'),($1,$3,'technician','active')",[org,owner,worker]);
await db.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);
const put=async(module,id,payload,date)=>db.query(`insert into zg_erp_records(organization_id,module,record_id,payload,created_at)
values($1,$2,$3,$4,coalesce($5::timestamptz,clock_timestamp()))`,[org,module,id,{id,...payload},date||null]);
await put('customers',oldCompany,{name:'Old Company',type:'公司',phone:'6265551111'});
await put('customers',company,{name:'New Company',type:'公司',phone:'6265552222'});
await put('fleets',fleet,{company:'Next Fleet',phone:'6265553333'});
const carData={ownerId:oldCompany,ownerType:'公司',ownerName:'Old Company',plate:'TEST001',vin:'1GNS5EK87TR342689',year:2026,make:'CHEVROLET',model:'Suburban',driverId:'old-driver',driverName:'Old driver',unit:'OLD-1'};
await put('vehicles',car,carData,'2026-09-01'); // Welcome credit must never be re-added on transfer.
await put('vehicles',otherCar,{...carData,plate:'TEST002',vin:'1FMJK1K89REA28320'},'2026-09-01');
const oldOrder=randomUUID();
const today=(await db.query("select to_char(now() at time zone 'America/Los_Angeles','YYYY-MM-DD') d")).rows[0].d;
const orderData={vehicleId:car,customerId:oldCompany,date:today,status:'已完成',oilChangeCompleted:true,total:100,paid:50,balance:50,customerName:'Old Company'};
await put('workOrders',oldOrder,orderData);
const rewards=async id=>(await db.query("select * from zg_reward_vehicles where vehicle_record_id=$1 order by created_at,id",[id])).rows;
const version=async id=>(await db.query("select updated_at::text v from zg_erp_records where record_id=$1",[id])).rows[0].v;
const source=async id=>(await db.query("select payload from zg_erp_records where record_id=$1",[id])).rows[0].payload;
const oldReward=(await rewards(car))[0];
assert.equal(oldReward.qualifying_count,2);
const originalOrder=await source(oldOrder), request=randomUUID(), expected=await version(car);
const transfer=(id=request,tm='customers',tid=company,v=expected)=>db.query('select zg_transfer_vehicle($1,$2,$3,$4,$5,$6,$7) result',[org,car,tm,tid,v,'Verified owner change',id]);
await db.exec('set role authenticated');
await db.query("select set_config('request.jwt.claim.sub',$1,false)",[worker]);
await assert.rejects(transfer(),/只有店主/);
await db.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);
await assert.rejects(transfer(randomUUID(),'customers',randomUUID()),/不存在/);
await assert.rejects(transfer(randomUUID(),'customers',company,'2020-01-01'),/其他操作更新/);
await assert.rejects(db.query('select * from zg_private.vehicle_transfers'),/permission denied/);
await db.exec('reset role');
// Force a late failure after reward-cycle changes; the entire transaction must roll back.
await db.exec(`create function test_failure() returns trigger language plpgsql as $$begin
 if new.payload ? 'ownershipTransferId' then raise exception 'forced rollback'; end if; return new; end$$;
create trigger test_failure before update on zg_erp_records for each row execute function test_failure();`);
await assert.rejects(transfer(),/forced rollback/);
assert.equal((await rewards(car)).length,1);
assert.equal((await rewards(car))[0].status,'active');
assert.equal((await rewards(car))[0].qualifying_count,2);
assert.equal((await source(car)).ownerId,oldCompany);
await db.exec('drop trigger test_failure on zg_erp_records; set role authenticated');
const result=(await transfer()).rows[0].result;
assert.equal(result.ownerId,company); assert.equal(result.driverId,''); assert.equal(result.unit,'');
assert.ok(result._cloudUpdatedAt);
assert.deepEqual((await transfer()).rows[0].result,result,'lost-response retry must not reset twice');
await assert.rejects(transfer(request,'fleets',fleet),/请求编号/);
await db.exec('reset role');
let cycles=await rewards(car), active=cycles.find(r=>r.status==='active');
assert.equal(cycles.length,2); assert.equal(active.qualifying_count,0);
assert.notEqual(active.enrollment_id,oldReward.enrollment_id);
assert.equal(cycles.find(r=>r.id===oldReward.id).status,'inactive');
assert.deepEqual(await source(oldOrder),originalOrder,'history, invoice identity and old debts must stay unchanged');
assert.equal((await rewards(otherCar))[0].qualifying_count,1,'same company other vehicle must not reset');
await assert.rejects(db.query("update zg_reward_vehicles set qualifying_count=3 where id=$1",[oldReward.id]),/封存/);
const newEnrollment=(await db.query("select * from zg_reward_enrollments where id=$1",[active.enrollment_id])).rows[0];
assert.equal(newEnrollment.phone_normalized,'6265552222'); assert.equal(newEnrollment.sms_consent,false);
assert.notEqual(newEnrollment.access_token_hash,(await db.query("select access_token_hash from zg_reward_enrollments where id=$1",[oldReward.enrollment_id])).rows[0].access_token_hash);
await db.query("update zg_erp_records set payload=payload||'{\"status\":\"已取消\"}' where record_id=$1",[oldOrder]);
await db.query("update zg_erp_records set payload=payload||'{\"status\":\"已完成\"}' where record_id=$1",[oldOrder]);
assert.equal((await rewards(car)).find(r=>r.status==='active').qualifying_count,0,'old order resave/cancel/recomplete must not earn or subtract new owner credit');
const newOrder=randomUUID();
await put('workOrders',newOrder,{...orderData,customerId:company,customerName:'New Company',oilChangeCompleted:false});
assert.equal((await rewards(car)).find(r=>r.status==='active').qualifying_count,0,'opening an order never earns credit');
await db.query("update zg_erp_records set payload=payload||'{\"oilChangeCompleted\":true}' where record_id=$1",[newOrder]);
await db.query("update zg_erp_records set payload=payload where record_id=$1",[newOrder]);
assert.equal((await rewards(car)).find(r=>r.status==='active').qualifying_count,1,'one completed oil change earns exactly once');
await put('workOrders',randomUUID(),{...orderData,customerId:company,date:'2026-09-10'});
await put('workOrders',randomUUID(),orderData);
assert.equal((await rewards(car)).find(r=>r.status==='active').qualifying_count,1,'backdated / old-owner orders cannot earn');
await assert.rejects(db.query("select zg_submit_oil_reward_registration($1)",[{
 accountType:'personal',contactName:'Old Owner',phone:'6265551111',email:'old@example.test',
 termsAccepted:true,termsVersion:'2026-09-05-maintenance-v6',vehicles:[{vin:carData.vin,plate:carData.plate}],
}]),/已办理过户/);
await transfer(randomUUID(),'fleets',fleet,await version(car));
assert.equal((await source(car)).ownerId,fleet);
assert.equal((await rewards(car)).filter(r=>r.status==='active').length,1);
assert.equal((await rewards(car)).find(r=>r.status==='active').qualifying_count,0);
await db.query("update zg_erp_records set payload=payload||'{\"status\":\"已取消\"}' where record_id=$1",[newOrder]);
assert.equal((await rewards(car)).find(r=>r.status==='active').qualifying_count,0);
assert.equal((await db.query("select count(*)::int n from zg_private.vehicle_transfers")).rows[0].n,2);
await db.query("update zg_organization_members set status='disabled' where user_id=$1",[owner]);
await assert.rejects(transfer(randomUUID(),'customers',company,await version(car)),/只有店主/);
assert.equal((await db.query("select has_function_privilege('anon','public.zg_transfer_vehicle(uuid,uuid,text,uuid,timestamptz,text,uuid)','EXECUTE') allowed")).rows[0].allowed,false);
await db.exec(sql('20261020194004_vehicle_transfer_permission.sql'));
await db.query("select set_config('request.jwt.claim.sub',$1,false)",[worker]);
await assert.rejects(transfer(),/没有车辆过户权限/);
await db.query("update zg_organization_members set permissions='{\"transferVehicle\":true}' where user_id=$1",[worker]);
const employeeVersion=await version(car);
await db.exec('set role authenticated');
// A retry is authorized by the same live guard as a new operation.
assert.equal((await transfer()).rows[0].result.ownerId,company);
await transfer(randomUUID(),'customers',company,employeeVersion);
await db.exec('reset role');
await db.query("update zg_organization_members set permissions='{\"transferVehicle\":false}' where user_id=$1",[worker]);
await assert.rejects(transfer(),/没有车辆过户权限/);
await db.query("update zg_organization_members set permissions='{\"transferVehicle\":true}',status='disabled' where user_id=$1",[worker]);
await assert.rejects(transfer(),/没有车辆过户权限/);
await db.exec(sql('20261020194854_vehicle_transfer_personal_owner.sql'));
await db.query("update zg_organization_members set status='active' where user_id=$1",[worker]);
const person=randomUUID();
await put('customers',person,{name:'Personal Owner',type:'个人',phone:'+1 (626) 321-6552'});
await transfer(randomUUID(),'customers',person,await version(car));
assert.equal((await source(car)).ownerType,'个人');
assert.equal((await source(car)).ownerId,person);
const personalCycle=(await rewards(car)).find(r=>r.status==='active');
assert.equal(personalCycle.qualifying_count,0);
const personalEnrollment=(await db.query('select * from zg_reward_enrollments where id=$1',[personalCycle.enrollment_id])).rows[0];
assert.equal(personalEnrollment.customer_record_id,person);
assert.equal(personalEnrollment.company_name,null);
assert.equal((await source(oldOrder)).customerId,oldCompany);
await put('workOrders',randomUUID(),{...orderData,customerId:person,customerName:'Personal Owner'});
assert.equal((await rewards(car)).find(r=>r.status==='active').qualifying_count,1);
await db.close();
const { stripTypeScriptTypes }=await import('node:module');
const searchSource=readFileSync(new URL('../src/lib/transferSearch.ts',import.meta.url),'utf8');
const {matchesTransferOwner}=await import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(searchSource)).toString('base64'));
for(const q of ['6263216552','626-321-6552','(626) 321 6552',' Personal ']) assert.equal(matchesTransferOwner('Personal Owner','+1 (626) 321-6552',q),true);
assert.equal(matchesTransferOwner('Personal Owner',undefined,'626'),false);
assert.equal(matchesTransferOwner('Personal Owner','6263216552','999'),false);
console.log('PASS: personal owner transfer, preserved old invoices, zero new cycle, new oil credit, normalized phone search');
console.log('PASS: explicit employee transfer grant, authorized transfer, revocation and disabled-account denial');
console.log('PASS: owner-only atomic transfer, invalid target/stale version, retry idempotency, zero new cycle, welcome suppression, old history/finance preserved, separate tokens, archived cycle frozen, old/backdated/wrong-owner orders excluded, completed oil change exactly once, repeat transfer');
