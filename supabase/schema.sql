create extension if not exists pgcrypto;

create table if not exists organizations(id uuid primary key default gen_random_uuid(),name text not null,created_at timestamptz not null default now());

create table if not exists organization_members(organization_id uuid not null references organizations(id) on delete cascade,user_id uuid not null references auth.users(id) on delete cascade,role text not null default 'owner',created_at timestamptz not null default now(),primary key(organization_id,user_id));

create or replace function bootstrap_organization(p_name text) returns uuid language plpgsql security definer set search_path=public as $$ declare v_org uuid; begin select organization_id into v_org from organization_members where user_id=auth.uid() limit 1; if v_org is null then insert into organizations(name) values(p_name) returning id into v_org; insert into organization_members(organization_id,user_id,role) values(v_org,auth.uid(),'owner'); end if; return v_org; end $$;

create table if not exists customers(id uuid primary key default gen_random_uuid(),organization_id uuid not null references organizations(id) on delete cascade,display_name text not null, customer_type text default 'individual', phone text, email text, address text, credit_limit numeric default 0, balance numeric default 0, notes text,created_at timestamptz not null default now());

create table if not exists fleets(id uuid primary key default gen_random_uuid(),organization_id uuid not null references organizations(id) on delete cascade,name text not null, contact_name text, phone text, email text, billing_cycle text, credit_limit numeric default 0, balance numeric default 0,created_at timestamptz not null default now());

create table if not exists vehicles(id uuid primary key default gen_random_uuid(),organization_id uuid not null references organizations(id) on delete cascade,owner_name text, year integer, make text, model text, vin text, license_plate text, unit_number text, mileage integer, engine text, transmission text,created_at timestamptz not null default now());

create table if not exists appointments(id uuid primary key default gen_random_uuid(),organization_id uuid not null references organizations(id) on delete cascade,appointment_date date, appointment_time text, customer_name text, vehicle_desc text, service_type text, status text default 'scheduled', notes text,created_at timestamptz not null default now());

create table if not exists work_orders(id uuid primary key default gen_random_uuid(),organization_id uuid not null references organizations(id) on delete cascade,order_number text not null, customer_name text, vehicle_desc text, status text default 'draft', technician text, labor_total numeric default 0, parts_total numeric default 0, tax numeric default 0, total numeric default 0, complaint text, diagnosis text,created_at timestamptz not null default now());

create table if not exists estimates(id uuid primary key default gen_random_uuid(),organization_id uuid not null references organizations(id) on delete cascade,estimate_number text not null, customer_name text, vehicle_desc text, status text default 'draft', subtotal numeric default 0, tax numeric default 0, total numeric default 0, notes text,created_at timestamptz not null default now());

create table if not exists invoices(id uuid primary key default gen_random_uuid(),organization_id uuid not null references organizations(id) on delete cascade,invoice_number text not null, customer_name text, invoice_date date, due_date date, status text default 'unpaid', total numeric default 0, paid_amount numeric default 0, balance numeric default 0,created_at timestamptz not null default now());

create table if not exists inventory_parts(id uuid primary key default gen_random_uuid(),organization_id uuid not null references organizations(id) on delete cascade,part_number text, name text not null, quantity numeric default 0, min_quantity numeric default 0, cost numeric default 0, price numeric default 0, location text, supplier text,created_at timestamptz not null default now());

create table if not exists purchase_orders(id uuid primary key default gen_random_uuid(),organization_id uuid not null references organizations(id) on delete cascade,po_number text not null, vendor_name text, order_date date, status text default 'draft', total numeric default 0, notes text,created_at timestamptz not null default now());

create table if not exists vendors(id uuid primary key default gen_random_uuid(),organization_id uuid not null references organizations(id) on delete cascade,name text not null, contact_name text, phone text, email text, payment_terms text, balance numeric default 0,created_at timestamptz not null default now());

create table if not exists finance_entries(id uuid primary key default gen_random_uuid(),organization_id uuid not null references organizations(id) on delete cascade,entry_date date not null, entry_type text not null, category text, amount numeric not null default 0, payment_method text, reference text, memo text,created_at timestamptz not null default now());

create table if not exists warranties(id uuid primary key default gen_random_uuid(),organization_id uuid not null references organizations(id) on delete cascade,vehicle_desc text, warranty_item text not null, start_date date, end_date date, mileage_limit numeric, status text default 'active', notes text,created_at timestamptz not null default now());

create table if not exists approval_requests(id uuid primary key default gen_random_uuid(),organization_id uuid not null references organizations(id) on delete cascade,request_type text, title text not null, amount numeric default 0, required_approvals integer default 2, approved_count integer default 0, status text default 'pending', notes text,created_at timestamptz not null default now());

create table if not exists staff_accounts(id uuid primary key default gen_random_uuid(),organization_id uuid not null references organizations(id) on delete cascade,display_name text not null, email text not null, role text not null, active boolean not null default true, phone text,created_at timestamptz not null default now());

create table if not exists audit_logs(id uuid primary key default gen_random_uuid(),organization_id uuid not null references organizations(id) on delete cascade,action text, entity_type text, entity_label text, actor_email text,created_at timestamptz not null default now());

alter table organizations enable row level security;

alter table organization_members enable row level security;

alter table customers enable row level security;

alter table fleets enable row level security;

alter table vehicles enable row level security;

alter table appointments enable row level security;

alter table work_orders enable row level security;

alter table estimates enable row level security;

alter table invoices enable row level security;

alter table inventory_parts enable row level security;

alter table purchase_orders enable row level security;

alter table vendors enable row level security;

alter table finance_entries enable row level security;

alter table warranties enable row level security;

alter table approval_requests enable row level security;

alter table staff_accounts enable row level security;

alter table audit_logs enable row level security;

drop policy if exists "read own memberships" on organization_members; create policy "read own memberships" on organization_members for select using(user_id=auth.uid());

drop policy if exists "read member organizations" on organizations; create policy "read member organizations" on organizations for select using(exists(select 1 from organization_members m where m.organization_id=organizations.id and m.user_id=auth.uid()));

do $$ declare t text; begin foreach t in array array['customers','fleets','vehicles','appointments','work_orders','estimates','invoices','inventory_parts','purchase_orders','vendors','finance_entries','warranties','approval_requests','staff_accounts','audit_logs'] loop execute format('drop policy if exists "organization access" on %I',t); execute format('create policy "organization access" on %I for all using(exists(select 1 from organization_members m where m.organization_id=%I.organization_id and m.user_id=auth.uid())) with check(exists(select 1 from organization_members m where m.organization_id=%I.organization_id and m.user_id=auth.uid()))',t,t,t); end loop; end $$;