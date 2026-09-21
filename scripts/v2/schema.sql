-- SINTECH 2: additive upgrade, preserving v1 data and a private rollback snapshot.
begin;
create schema if not exists sintech_private;
revoke all on schema sintech_private from public,anon,authenticated;
create table sintech_private.upgrade_backups(id uuid primary key default gen_random_uuid(), created_at timestamptz default now(), data jsonb not null);
insert into sintech_private.upgrade_backups(data) select jsonb_build_object('suppliers',(select jsonb_agg(s) from public.ap_suppliers s),'invoices',(select jsonb_agg(s) from public.ap_invoices s),'payments',(select jsonb_agg(s) from public.ap_payments s),'members',(select jsonb_agg(s) from public.ap_members s),'settings',(select jsonb_agg(s) from public.ap_settings s),'audit',(select jsonb_agg(s) from public.ap_audit s));
create table public.ap_businesses(id uuid primary key default gen_random_uuid(), name text not null check(length(btrim(name)) between 1 and 250), created_at timestamptz default now());
insert into public.ap_businesses(name) select business_name from public.ap_settings where id=1;
create table public.ap_business_members(business_id uuid references public.ap_businesses(id),user_id uuid references auth.users(id),role text not null check(role in ('admin','accountant','viewer')),active boolean not null default true,primary key(business_id,user_id));
insert into public.ap_business_members select b.id,m.user_id,m.role,m.active from public.ap_businesses b cross join public.ap_members m;
alter table public.ap_settings add column business_id uuid references public.ap_businesses(id);
update public.ap_settings set business_id=(select id from public.ap_businesses);
alter table public.ap_settings alter column business_id set not null;
create index ap_settings_business on public.ap_settings(business_id);
alter table public.ap_suppliers add column business_id uuid references public.ap_businesses(id);
update public.ap_suppliers set business_id=(select id from public.ap_businesses);
alter table public.ap_suppliers alter column business_id set not null;
create index ap_suppliers_business on public.ap_suppliers(business_id);
alter table public.ap_invoices add column business_id uuid references public.ap_businesses(id);
update public.ap_invoices set business_id=(select id from public.ap_businesses);
alter table public.ap_invoices alter column business_id set not null;
create index ap_invoices_business on public.ap_invoices(business_id);
alter table public.ap_payments add column business_id uuid references public.ap_businesses(id);
update public.ap_payments set business_id=(select id from public.ap_businesses);
alter table public.ap_payments alter column business_id set not null;
create index ap_payments_business on public.ap_payments(business_id);
alter table public.ap_audit add column business_id uuid references public.ap_businesses(id);
update public.ap_audit set business_id=(select id from public.ap_businesses);
alter table public.ap_audit alter column business_id set not null;
create index ap_audit_business on public.ap_audit(business_id);
alter table public.ap_requests add column business_id uuid references public.ap_businesses(id);
update public.ap_requests set business_id=(select id from public.ap_businesses);
alter table public.ap_requests alter column business_id set not null;
create index ap_requests_business on public.ap_requests(business_id);
alter table public.ap_settings drop constraint ap_settings_pkey;
alter table public.ap_settings add primary key(business_id);
drop index public.ap_supplier_name_unique;
create unique index ap_supplier_name_unique on public.ap_suppliers(business_id,lower(business_name));
alter table public.ap_suppliers add unique(business_id,id);
alter table public.ap_invoices add unique(business_id,id);
alter table public.ap_invoices add foreign key(business_id,supplier_id) references public.ap_suppliers(business_id,id);
alter table public.ap_payments add foreign key(business_id,invoice_id) references public.ap_invoices(business_id,id);
alter table public.ap_payments add column batch_id uuid;
create table public.ap_categories(id uuid primary key default gen_random_uuid(),business_id uuid not null references public.ap_businesses(id),name text not null check(length(btrim(name)) between 1 and 100),active boolean not null default true,version int not null default 1);
create unique index ap_category_name on public.ap_categories(business_id,lower(name));
insert into public.ap_categories(business_id,name) select b.id,n from public.ap_businesses b cross join unnest(array['Food & Beverages','Packaging','Utilities','Rent','Equipment','Maintenance','Services','Other']) n;
insert into public.ap_categories(business_id,name) select distinct business_id,category from public.ap_suppliers where category<>'' on conflict do nothing;
create table public.ap_credits(id uuid primary key,business_id uuid not null references public.ap_businesses(id), supplier_id uuid not null,number text not null check(length(btrim(number)) between 1 and 100),date date not null,amount_cents bigint not null check(amount_cents between 1 and 100000000000),reason text not null check(length(btrim(reason))>=5),created_at timestamptz default now(),voided_at timestamptz,void_reason text,foreign key(business_id,supplier_id) references public.ap_suppliers(business_id,id),unique(business_id,id));
create unique index ap_credit_number on public.ap_credits(business_id,supplier_id,lower(number));
create table public.ap_credit_allocations(id uuid primary key,business_id uuid not null,credit_id uuid not null,invoice_id uuid not null,amount_cents bigint not null check(amount_cents>0),date date not null,created_at timestamptz default now(),reversed_at timestamptz,reversal_reason text,foreign key(business_id,credit_id) references public.ap_credits(business_id,id),foreign key(business_id,invoice_id) references public.ap_invoices(business_id,id));
create index ap_credit_invoice on public.ap_credit_allocations(business_id,invoice_id);
create index ap_credit_credit on public.ap_credit_allocations(business_id,credit_id);
create table public.ap_quotes(id uuid primary key,business_id uuid not null,supplier_id uuid not null,product text not null,brand text not null default '',unit text not null,unit_cents bigint not null check(unit_cents between 1 and 100000000000),date date not null,notes text not null default '',active boolean not null default true,version int not null default 1,foreign key(business_id,supplier_id) references public.ap_suppliers(business_id,id));
create table public.ap_orders(id uuid primary key,business_id uuid not null,supplier_id uuid not null,number text not null,date date not null,status text not null check(status in ('Draft','Ordered','Received','Cancelled')),lines jsonb not null,notes text not null default '',total_cents bigint not null check(total_cents between 1 and 100000000000),version int not null default 1,created_at timestamptz default now(),received_at timestamptz,invoice_id uuid,foreign key(business_id,supplier_id) references public.ap_suppliers(business_id,id),foreign key(business_id,invoice_id) references public.ap_invoices(business_id,id));
create unique index ap_order_number on public.ap_orders(business_id,lower(number));
create table public.ap_documents(id uuid primary key,business_id uuid not null references public.ap_businesses(id),entity_type text not null check(entity_type in ('supplier','invoice','payment','order','credit')),entity_id uuid not null,name text not null,path text not null unique,mime text not null,size bigint not null check(size between 1 and 10485760),created_at timestamptz default now(),created_by uuid not null references auth.users(id),archived_at timestamptz);
create table public.ap_plans(id uuid primary key,business_id uuid not null references public.ap_businesses(id),name text not null,date date not null,budget_cents bigint not null check(budget_cents>=0),items jsonb not null,version int not null default 1);
create table public.ap_backups(id uuid primary key default gen_random_uuid(),business_id uuid not null references public.ap_businesses(id),created_at timestamptz default now(),created_by uuid references auth.users(id),label text not null,data jsonb not null);
create function public.ap_role_v2(business uuid) returns text language sql stable security definer set search_path='' as $$ select role from public.ap_business_members where business_id=business and user_id=auth.uid() and active $$;
revoke all on function public.ap_role_v2(uuid) from public,anon;
grant execute on function public.ap_role_v2(uuid) to authenticated;
create function public.ap_business_list() returns jsonb language sql stable security definer set search_path='' as $$ select coalesce(jsonb_agg(jsonb_build_object('id',b.id,'name',b.name,'role',m.role) order by b.created_at),'[]'::jsonb) from public.ap_businesses b join public.ap_business_members m on b.id=m.business_id where m.user_id=auth.uid() and m.active $$;
revoke all on function public.ap_business_list() from public,anon;
grant execute on function public.ap_business_list() to authenticated;
alter table public.ap_businesses enable row level security;
revoke all on public.ap_businesses from anon,authenticated;
alter table public.ap_business_members enable row level security;
revoke all on public.ap_business_members from anon,authenticated;
alter table public.ap_categories enable row level security;
revoke all on public.ap_categories from anon,authenticated;
alter table public.ap_credits enable row level security;
revoke all on public.ap_credits from anon,authenticated;
alter table public.ap_credit_allocations enable row level security;
revoke all on public.ap_credit_allocations from anon,authenticated;
alter table public.ap_quotes enable row level security;
revoke all on public.ap_quotes from anon,authenticated;
alter table public.ap_orders enable row level security;
revoke all on public.ap_orders from anon,authenticated;
alter table public.ap_documents enable row level security;
revoke all on public.ap_documents from anon,authenticated;
alter table public.ap_plans enable row level security;
revoke all on public.ap_plans from anon,authenticated;
alter table public.ap_backups enable row level security;
revoke all on public.ap_backups from anon,authenticated;
drop policy ap_settings_read on public.ap_settings;
create policy ap_settings_read on public.ap_settings for select to authenticated using(public.ap_role_v2(business_id) is not null);
drop policy ap_suppliers_read on public.ap_suppliers;
create policy ap_suppliers_read on public.ap_suppliers for select to authenticated using(public.ap_role_v2(business_id) is not null);
drop policy ap_invoices_read on public.ap_invoices;
create policy ap_invoices_read on public.ap_invoices for select to authenticated using(public.ap_role_v2(business_id) is not null);
drop policy ap_payments_read on public.ap_payments;
create policy ap_payments_read on public.ap_payments for select to authenticated using(public.ap_role_v2(business_id) is not null);
drop policy ap_audit_read on public.ap_audit;
create policy ap_audit_read on public.ap_audit for select to authenticated using(public.ap_role_v2(business_id) is not null);
grant select on public.ap_categories to authenticated;
create policy ap_categories_read on public.ap_categories for select to authenticated using(public.ap_role_v2(business_id) is not null);
create index ap_categories_business on public.ap_categories(business_id);
grant select on public.ap_credits to authenticated;
create policy ap_credits_read on public.ap_credits for select to authenticated using(public.ap_role_v2(business_id) is not null);
create index ap_credits_business on public.ap_credits(business_id);
grant select on public.ap_credit_allocations to authenticated;
create policy ap_credit_allocations_read on public.ap_credit_allocations for select to authenticated using(public.ap_role_v2(business_id) is not null);
create index ap_credit_allocations_business on public.ap_credit_allocations(business_id);
grant select on public.ap_quotes to authenticated;
create policy ap_quotes_read on public.ap_quotes for select to authenticated using(public.ap_role_v2(business_id) is not null);
create index ap_quotes_business on public.ap_quotes(business_id);
grant select on public.ap_orders to authenticated;
create policy ap_orders_read on public.ap_orders for select to authenticated using(public.ap_role_v2(business_id) is not null);
create index ap_orders_business on public.ap_orders(business_id);
grant select on public.ap_documents to authenticated;
create policy ap_documents_read on public.ap_documents for select to authenticated using(public.ap_role_v2(business_id) is not null);
create index ap_documents_business on public.ap_documents(business_id);
grant select on public.ap_plans to authenticated;
create policy ap_plans_read on public.ap_plans for select to authenticated using(public.ap_role_v2(business_id) is not null);
create index ap_plans_business on public.ap_plans(business_id);
create function public.ap_snapshot_v2(business uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if public.ap_role_v2(business) is null then raise exception 'No access to this business.'; end if;
 select jsonb_build_object('schema',2,'business_id',business,'revision',x.revision,'role',public.ap_role_v2(business),'settings',to_jsonb(x)-'id'-'revision'-'business_id','commands','[]'::jsonb,
'suppliers',coalesce((select jsonb_agg(to_jsonb(s)) from public.ap_suppliers s where s.business_id=business),'[]'::jsonb),
'invoices',coalesce((select jsonb_agg(to_jsonb(s)) from public.ap_invoices s where s.business_id=business),'[]'::jsonb),
'payments',coalesce((select jsonb_agg(to_jsonb(s)) from public.ap_payments s where s.business_id=business),'[]'::jsonb),
'audit',coalesce((select jsonb_agg(to_jsonb(s)) from public.ap_audit s where s.business_id=business),'[]'::jsonb),
'categories',coalesce((select jsonb_agg(to_jsonb(s)) from public.ap_categories s where s.business_id=business),'[]'::jsonb),
'credits',coalesce((select jsonb_agg(to_jsonb(s)) from public.ap_credits s where s.business_id=business),'[]'::jsonb),
'credit_allocations',coalesce((select jsonb_agg(to_jsonb(s)) from public.ap_credit_allocations s where s.business_id=business),'[]'::jsonb),
'quotes',coalesce((select jsonb_agg(to_jsonb(s)) from public.ap_quotes s where s.business_id=business),'[]'::jsonb),
'orders',coalesce((select jsonb_agg(to_jsonb(s)) from public.ap_orders s where s.business_id=business),'[]'::jsonb),
'documents',coalesce((select jsonb_agg(to_jsonb(s)) from public.ap_documents s where s.business_id=business),'[]'::jsonb),
'plans',coalesce((select jsonb_agg(to_jsonb(s)) from public.ap_plans s where s.business_id=business),'[]'::jsonb),
'members',case when public.ap_role_v2(business)='admin' then coalesce((select jsonb_agg(jsonb_build_object('user_id',m.user_id,'email',u.email,'role',m.role,'active',m.active)) from public.ap_business_members m join auth.users u on u.id=m.user_id where m.business_id=business),'[]'::jsonb) else '[]'::jsonb end,
'backups',case when public.ap_role_v2(business)='admin' then coalesce((select jsonb_agg(jsonb_build_object('id',z.id,'created_at',z.created_at,'label',z.label)) from (select * from public.ap_backups where business_id=business order by created_at desc limit 30) z),'[]'::jsonb) else '[]'::jsonb end)
 into result from public.ap_settings x where business_id=business;
 return result;
end $$;
revoke all on function public.ap_snapshot_v2(uuid) from public,anon;
grant execute on function public.ap_snapshot_v2(uuid) to authenticated;
