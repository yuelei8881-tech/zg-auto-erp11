import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

// Real PostgreSQL execution in an isolated in-memory database, never production.
const db = new PGlite();
await db.exec(`
create role anon; create role authenticated;
create schema auth;
create function auth.uid() returns uuid language sql stable as
$$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create table zg_organization_members(organization_id uuid,user_id uuid,role text,status text,permissions jsonb default '{}',primary key(organization_id,user_id));
create table zg_erp_records(organization_id uuid,module text,record_id uuid,payload jsonb,created_by uuid default auth.uid(),updated_by uuid,updated_at timestamptz default clock_timestamp(),primary key(organization_id,module,record_id));
create function update_time() returns trigger language plpgsql as $$ begin new.updated_at=clock_timestamp(); return new; end $$;
create trigger update_time before update on zg_erp_records for each row execute function update_time();
create table zg_audit_logs(organization_id uuid);
create table zg_customer_approvals(organization_id uuid);
create table zg_reward_enrollments(organization_id uuid,id uuid);
create table zg_reward_vehicles(organization_id uuid,id uuid);
create table zg_reward_events(organization_id uuid);
create table zg_staff_invites(organization_id uuid);
alter table zg_erp_records enable row level security;
grant usage on schema auth to authenticated;
grant all on zg_erp_records to authenticated;
create function zg_is_org_member(p_org uuid) returns boolean language sql stable security definer as
$$ select exists(select 1 from public.zg_organization_members where organization_id=p_org and user_id=auth.uid() and status='active') $$;
create function zg_record_payment(uuid,uuid,jsonb) returns jsonb language sql as $$ select $3 $$;
create function zg_set_oil_reward_count(uuid,integer,text) returns jsonb language sql as $$ select '{}'::jsonb $$;
create function zg_review_oil_reward_enrollment(uuid,boolean,text) returns jsonb language sql as $$ select '{}'::jsonb $$;
create function zg_create_customer_approval(uuid,uuid,text,text,jsonb) returns text language sql as $$ select 'test-token'::text $$;
`);
const migration = readFileSync(new URL('../supabase/migrations/20261009150337_enforce_record_permissions.sql', import.meta.url),'utf8');
await db.exec(migration);
await db.exec(readFileSync(new URL('../supabase/migrations/20261009151334_activate_record_permissions.sql',import.meta.url),'utf8'));
await db.exec(readFileSync(new URL('../supabase/migrations/20261009151541_secure_privileged_actions.sql',import.meta.url),'utf8'));
const org='00000000-0000-4000-8000-000000000001', owner='00000000-0000-4000-8000-000000000002', worker='00000000-0000-4000-8000-000000000003', order='00000000-0000-4000-8000-000000000004';
await db.query("insert into zg_organization_members values ($1,$2,'owner','active','{}'),($1,$3,'workshop_supervisor','active','{}')",[org,owner,worker]);
const original={id:order,total:550,paid:100,balance:450,grossProfit:200,phone:'private',status:'维修中',diagnosis:'old',laborItems:[{id:'labor',description:'换机油',rate:100,total:100}],partItems:[{id:'part',cost:40,price:60,qty:1}],notes:'sensitive'};
await db.query("insert into zg_erp_records(organization_id,module,record_id,payload) values ($1,'workOrders',$2,$3)",[org,order,original]);
await db.exec(`set role authenticated; set request.jwt.claim.sub='${worker}'`);
assert.equal((await db.query('select * from zg_erp_records')).rows.length,0,'raw JSON must not be accessible');
let rows=(await db.query('select * from zg_read_records($1)',[org])).rows;
assert.equal(rows.length,1);
assert.equal(rows[0].payload.total,undefined);
assert.equal(rows[0].payload.partItems[0].cost,undefined);
assert.equal(rows[0].payload.laborItems[0].rate,undefined);
assert.equal(rows[0].payload.notes,undefined);
await assert.rejects(db.query('select zg_write_records($1,$2)',[org,[{module:'payments',row:{id:order,amount:999}}]]),/权限/);
await assert.rejects(db.query('select zg_record_payment($1,$2,$3)',[org,order,{amount:1}]),/收款权限/);
await assert.rejects(db.query('select zg_set_oil_reward_count($1,5,$2)',[order,'test']),/活动管理权限/);
await assert.rejects(db.query('select zg_create_customer_approval($1,$2,$3,$4,$5)',[org,order,'test@example.test','test',{}]),/报价确认/);
await db.query('select zg_save_operational_order($1,$2)',[org,{...original,total:0,paid:0,diagnosis:'updated',partItems:[]}]);
await db.exec(`set request.jwt.claim.sub='${owner}'`);
rows=(await db.query('select * from zg_read_records($1)',[org])).rows;
assert.equal(rows[0].payload.total,550,'price-free save must preserve total');
assert.equal(rows[0].payload.paid,100);
assert.equal(rows[0].payload.partItems.length,1);
assert.equal(rows[0].payload.diagnosis,'updated');
await db.exec('reset role');
await db.exec(readFileSync(new URL('../supabase/migrations/20261009151922_versioned_atomic_saves.sql',import.meta.url),'utf8'));
await db.exec(readFileSync(new URL('../supabase/migrations/20261009152208_activate_versioned_writes.sql',import.meta.url),'utf8'));
const part='00000000-0000-4000-8000-000000000005';
await db.query("insert into zg_erp_records(organization_id,module,record_id,payload) values($1,'parts',$2,$3)",[org,part,{id:part,qty:10}]);
await db.exec(`set role authenticated; set request.jwt.claim.sub='${owner}'`);
const snapshot=async ()=>(await db.query('select module,payload,updated_at::text as version from zg_read_records($1)',[org])).rows;
let snapshotRows=await snapshot();
const expected=(module)=>snapshotRows.find(x=>x.module===module).version;
const changeOrder={...rows[0].payload,total:600,_cloudUpdatedAt:expected('workOrders')};
const batch=[{module:'parts',row:{id:part,qty:9,_cloudUpdatedAt:expected('parts')}},{module:'workOrders',row:changeOrder}];
const ack=(await db.query('select zg_write_records_v2($1,$2) as saved',[org,batch])).rows[0].saved;
assert.equal(ack.length,2);
assert.ok(ack.every(x=>x.row._cloudUpdatedAt),'save must return authoritative versions');
// A repeated request with identical content is safe even if its response was lost.
await db.query('select zg_write_records_v2($1,$2)',[org,batch]);
const currentOrder=ack.find(x=>x.module==='workOrders').row;
await assert.rejects(db.query('select zg_write_records_v2($1,$2)',[org,[
 {module:'workOrders',row:{...currentOrder,total:650}},
 {module:'parts',row:{...batch[0].row,qty:8}},
]]),/其他操作更新/);
snapshotRows=await snapshot();
assert.equal(snapshotRows.find(x=>x.module==='workOrders').payload.total,600,'batch failure must roll back order');
assert.equal(snapshotRows.find(x=>x.module==='parts').payload.qty,9,'stale inventory must not overwrite stock');
await assert.rejects(db.query("update zg_erp_records set payload='{}' where record_id=$1 returning *",[order]).then(r=>{if(!r.rows.length) throw new Error('raw write denied');}),/raw write denied/);
console.log('PASS: stale-write rejection, atomic batch rollback, idempotent retry, returned versions, raw-write bypass blocked');
await db.exec("set request.jwt.claim.sub='00000000-0000-4000-8000-000000000099'");
await assert.rejects(db.query('select * from zg_read_records($1)',[org]),/Not authorized/);
await db.exec('reset role');
await db.query("update zg_organization_members set status='disabled' where user_id=$1",[worker]);
await db.exec(`set role authenticated; set request.jwt.claim.sub='${worker}'`);
await assert.rejects(db.query('select zg_save_operational_order($1,$2)',[org,original]),/Not authorized|保存权限/);
await db.close();
console.log('PASS: actual PostgreSQL RLS, redaction, forbidden payments, price-preserving operational save, cross-tenant and disabled-account denial');
