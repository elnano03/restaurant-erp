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
create function public.ap_command_v2(business uuid, request_id uuid, action text, payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  r text; target uuid; prev jsonb; next_value jsonb; i public.ap_invoices; sp public.ap_suppliers;
  pay public.ap_payments; existing public.ap_requests; n text; paid bigint; total bigint; v bigint;
  actor_name text; item jsonb; cr public.ap_credits; alloc public.ap_credit_allocations; ord public.ap_orders; who uuid; quantity numeric; sum_total bigint:=0; batch_supplier uuid; child uuid; old_name text; day_today date := (now() at time zone 'America/New_York')::date;
begin
  r:=public.ap_role_v2(business);
  if r is null or r='viewer' then raise exception 'Your account does not have write access.'; end if;
  if request_id is null or payload is null then raise exception 'Invalid request.'; end if;
  -- Serialize financial writes for this business. This also prevents racing partial payments.
  perform 1 from public.ap_settings where business_id=business and id=1 for update;
  select * into existing from public.ap_requests where business_id=business and id=request_id;
  if found then
    if existing.user_id<>auth.uid() or existing.action<>action or existing.payload<>payload then raise exception 'Request ID already used.'; end if;
    return public.ap_snapshot_v2(business);
  end if;
  if exists(select 1 from public.ap_requests where id=request_id and business_id<>business) then raise exception 'Request ID already used.'; end if;
  if not exists(select 1 from public.ap_backups where business_id=business and created_at >= date_trunc('day',now())) then insert into public.ap_backups(business_id,created_by,label,data) values(business,auth.uid(),'Automatic daily snapshot',public.ap_snapshot_v2(business)-'backups'); delete from public.ap_backups where business_id=business and id not in (select id from public.ap_backups where business_id=business order by created_at desc limit 30); end if;
  actor_name:=coalesce(auth.jwt()->>'email',auth.uid()::text);
  target:=coalesce(nullif(payload->>'id','')::uuid,request_id);
  if exists(select 1 from public.ap_suppliers where id=target and business_id<>business) or exists(select 1 from public.ap_invoices where id=target and business_id<>business) or exists(select 1 from public.ap_payments where id=target and business_id<>business) or exists(select 1 from public.ap_categories where id=target and business_id<>business) or exists(select 1 from public.ap_credits where id=target and business_id<>business) or exists(select 1 from public.ap_credit_allocations where id=target and business_id<>business) or exists(select 1 from public.ap_quotes where id=target and business_id<>business) or exists(select 1 from public.ap_orders where id=target and business_id<>business) or exists(select 1 from public.ap_documents where id=target and business_id<>business) or exists(select 1 from public.ap_plans where id=target and business_id<>business) then raise exception 'ID belongs to another business.'; end if;
  if action='supplier.save' then
    select * into sp from public.ap_suppliers where business_id=business and id=target;
    if payload ? 'id' and sp.id is null then raise exception 'Supplier no longer exists.'; end if;
    if sp.id is not null and (payload->>'version')::integer is distinct from sp.version then raise exception 'Supplier changed. Refresh and reopen it.'; end if;
    prev:=case when sp.id is null then null else to_jsonb(sp) end;
    n:=btrim(coalesce(payload->>'business_name',''));
    if length(n)<1 or length(n)>250 then raise exception 'Business name is required (max 250 characters).'; end if;
    if coalesce(payload->>'email','')<>'' and (payload->>'email') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Invalid email.'; end if;
    if not exists(select 1 from public.ap_categories where business_id=business and name=payload->>'category' and active) and (sp.id is null or sp.category is distinct from payload->>'category') then raise exception 'Choose an active category.'; end if;
    insert into public.ap_suppliers(business_id,id,business_name,contact,phone,email,address,category,status,terms_days,notes)
      values(business,target,n,left(coalesce(payload->>'contact',''),250),left(coalesce(payload->>'phone',''),60),left(coalesce(payload->>'email',''),250),left(coalesce(payload->>'address',''),1000),left(coalesce(payload->>'category',''),250),payload->>'status',(payload->>'terms_days')::integer,left(coalesce(payload->>'notes',''),3000))
      on conflict(id) do update set business_name=excluded.business_name,contact=excluded.contact,phone=excluded.phone,email=excluded.email,address=excluded.address,category=excluded.category,status=excluded.status,terms_days=excluded.terms_days,notes=excluded.notes,version=ap_suppliers.version+1;
    select to_jsonb(s) into next_value from public.ap_suppliers s where business_id=business and id=target;
  elsif action='invoice.save' then
    select * into i from public.ap_invoices where business_id=business and id=target;
    if payload ? 'id' and i.id is null then raise exception 'Invoice no longer exists.'; end if;
    if i.id is not null and (i.status<>'Draft' or (payload->>'version')::integer is distinct from i.version) then raise exception 'Only unchanged drafts can be edited.'; end if;
    prev:=case when i.id is null then null else to_jsonb(i) end;
    select * into sp from public.ap_suppliers where business_id=business and id=(payload->>'supplier_id')::uuid;
    if sp.id is null or sp.status<>'Active' then raise exception 'Choose an active supplier.'; end if;
    n:=btrim(coalesce(payload->>'number',''));
    insert into public.ap_invoices(business_id,id,supplier_id,number,issue_date,due_date,category,description,subtotal_cents,tax_cents,shipping_cents,discount_cents,status)
      values(business,target,sp.id,n,(payload->>'issue_date')::date,(payload->>'due_date')::date,left(coalesce(payload->>'category',''),250),left(coalesce(payload->>'description',''),3000),(payload->>'subtotal_cents')::bigint,(payload->>'tax_cents')::bigint,(payload->>'shipping_cents')::bigint,(payload->>'discount_cents')::bigint,'Draft')
      on conflict(id) do update set supplier_id=excluded.supplier_id,number=excluded.number,issue_date=excluded.issue_date,due_date=excluded.due_date,category=excluded.category,description=excluded.description,subtotal_cents=excluded.subtotal_cents,tax_cents=excluded.tax_cents,shipping_cents=excluded.shipping_cents,discount_cents=excluded.discount_cents,version=ap_invoices.version+1;
    select to_jsonb(x) into next_value from public.ap_invoices x where business_id=business and id=target;
  elsif action in ('invoice.approve','invoice.void') then
    select * into i from public.ap_invoices where business_id=business and id=target;
    if i.id is null or (payload->>'version')::integer is distinct from i.version then raise exception 'Invoice changed or no longer exists. Refresh.'; end if;
    prev:=to_jsonb(i);
    if action='invoice.approve' then
      if i.status<>'Draft' then raise exception 'Only drafts can be approved.'; end if;
      if not exists(select 1 from public.ap_suppliers where business_id=business and id=i.supplier_id and status='Active') then raise exception 'Supplier is not active.'; end if;
      update public.ap_invoices set status='Approved',approved_at=now(),version=version+1 where business_id=business and id=target;
    else
      if r<>'admin' then raise exception 'Only administrators can void invoices.'; end if;
      if exists(select 1 from public.ap_credit_allocations where business_id=business and invoice_id=target and reversed_at is null) then raise exception 'Reverse allocated credits first.'; end if;
      if i.status='Void' or exists(select 1 from public.ap_payments where business_id=business and invoice_id=target and reversed_at is null) then raise exception 'Reverse payments before voiding an invoice.'; end if;
      if length(btrim(coalesce(payload->>'reason','')))<5 then raise exception 'A reason of at least five characters is required.'; end if;
      update public.ap_invoices set status='Void',voided_at=now(),void_reason=left(payload->>'reason',1000),version=version+1 where business_id=business and id=target;
    end if;
    select to_jsonb(x) into next_value from public.ap_invoices x where business_id=business and id=target;
  elsif action='payment.record' then
    select * into i from public.ap_invoices where business_id=business and id=(payload->>'invoice_id')::uuid;
    if i.id is null or i.status<>'Approved' then raise exception 'Payments require an approved invoice.'; end if;
    if exists(select 1 from public.ap_suppliers where business_id=business and id=i.supplier_id and status='Blocked') then raise exception 'Payments to a blocked supplier are not allowed.'; end if;
    select coalesce(sum(amount_cents),0) into paid from public.ap_payments where business_id=business and invoice_id=i.id and reversed_at is null;
    paid:=paid+coalesce((select sum(amount_cents) from public.ap_credit_allocations where business_id=business and invoice_id=i.id and reversed_at is null),0);
    total:=i.subtotal_cents+i.tax_cents+i.shipping_cents-i.discount_cents;v:=(payload->>'amount_cents')::bigint;
    if v is null or v<=0 or v>total-paid then raise exception 'Payment exceeds the outstanding balance or is invalid.'; end if;
    if (payload->>'date')::date<i.issue_date or (payload->>'date')::date>day_today then raise exception 'Payment date must be between invoice date and today.'; end if;
    target:=request_id;
    insert into public.ap_payments(business_id,id,invoice_id,amount_cents,date,method,reference,notes) values(business,target,i.id,v,(payload->>'date')::date,payload->>'method',left(coalesce(payload->>'reference',''),250),left(coalesce(payload->>'notes',''),3000));
    select to_jsonb(x) into next_value from public.ap_payments x where business_id=business and id=target;
  elsif action='payment.reverse' then
    if r<>'admin' then raise exception 'Only administrators can reverse payments.'; end if;
    select * into pay from public.ap_payments where business_id=business and id=target;
    if pay.id is null or pay.reversed_at is not null then raise exception 'Payment is missing or already reversed.'; end if;
    if length(btrim(coalesce(payload->>'reason','')))<5 then raise exception 'A reason of at least five characters is required.'; end if;
    prev:=to_jsonb(pay);
    update public.ap_payments set reversed_at=now(),reversal_reason=left(payload->>'reason',1000) where business_id=business and id=target;
    select to_jsonb(x) into next_value from public.ap_payments x where business_id=business and id=target;
  elsif action='settings.save' then
    if r<>'admin' then raise exception 'Only administrators can change settings.'; end if;
    n:=btrim(coalesce(payload->>'business_name',''));if length(n)<1 then raise exception 'Business name is required.'; end if;
    select to_jsonb(x) into prev from public.ap_settings x where business_id=business and id=1;
    update public.ap_businesses set name=left(n,250) where id=business;
    update public.ap_settings set business_name=left(n,250),address=left(coalesce(payload->>'address',''),1000),phone=left(coalesce(payload->>'phone',''),60),email=left(coalesce(payload->>'email',''),250),terms_days=(payload->>'terms_days')::integer where business_id=business and id=1;
    select to_jsonb(x) into next_value from public.ap_settings x where business_id=business and id=1;
  elsif action='category.save' then
    if r<>'admin' then raise exception 'Administrator required.'; end if;
    n:=btrim(payload->>'name');
    if n is null or length(n) not between 1 and 100 then raise exception 'Category name required (100 characters max).'; end if;
    select to_jsonb(c) into prev from public.ap_categories c where business_id=business and id=target;
    if payload ? 'id' and (prev is null or (prev->>'version')::int is distinct from (payload->>'version')::int) then raise exception 'Category changed. Refresh.'; end if;
    old_name:=prev->>'name';
    insert into public.ap_categories(id,business_id,name,active) values(target,business,n,coalesce((payload->>'active')::boolean,true))
    on conflict(id) do update set name=excluded.name,active=excluded.active,version=ap_categories.version+1 where ap_categories.business_id=business;
    if old_name is not null and old_name<>n then update public.ap_suppliers set category=n,version=version+1 where business_id=business and category=old_name; end if;
    select to_jsonb(c) into next_value from public.ap_categories c where business_id=business and id=target;
  elsif action='member.save' then
    if r<>'admin' then raise exception 'Administrator required.'; end if;
    select id into who from auth.users where lower(email)=lower(btrim(payload->>'email')) and email_confirmed_at is not null;
    if who is null then raise exception 'Create and confirm this account in Supabase Authentication first.'; end if;
    if payload->>'role' not in ('admin','accountant','viewer') then raise exception 'Invalid role.'; end if;
    if who=auth.uid() and (payload->>'role'<>'admin' or not coalesce((payload->>'active')::boolean,false)) then raise exception 'You cannot remove your own administrator access.'; end if;
    select to_jsonb(m) into prev from public.ap_business_members m where business_id=business and user_id=who;
    insert into public.ap_business_members(business_id,user_id,role,active) values(business,who,payload->>'role',coalesce((payload->>'active')::boolean,true)) on conflict(business_id,user_id) do update set role=excluded.role,active=excluded.active;
    target:=who; select to_jsonb(m) into next_value from public.ap_business_members m where business_id=business and user_id=who;
  elsif action='business.create' then
    if r<>'admin' then raise exception 'Administrator required.'; end if;
    n:=btrim(payload->>'name');if n is null or length(n) not between 1 and 250 then raise exception 'Business name required.'; end if;
    insert into public.ap_businesses(id,name) values(target,n);
    insert into public.ap_business_members values(target,auth.uid(),'admin',true);
    insert into public.ap_settings(id,business_id,business_name) values(1,target,n);
    insert into public.ap_categories(business_id,name) select target,c.name from public.ap_categories c where c.business_id=business and active;
    next_value:=jsonb_build_object('id',target,'name',n);
  elsif action='credit.create' then
    if not exists(select 1 from public.ap_suppliers where business_id=business and id=(payload->>'supplier_id')::uuid) then raise exception 'Supplier not found.'; end if;
    if (payload->>'date')::date>day_today then raise exception 'Credit date cannot be in the future.'; end if;
    insert into public.ap_credits(id,business_id,supplier_id,number,date,amount_cents,reason) values(target,business,(payload->>'supplier_id')::uuid,btrim(payload->>'number'),(payload->>'date')::date,(payload->>'amount_cents')::bigint,btrim(payload->>'reason'));
    select to_jsonb(c) into next_value from public.ap_credits c where id=target;
  elsif action='credit.apply' then
    select * into cr from public.ap_credits where business_id=business and id=(payload->>'credit_id')::uuid;
    select * into i from public.ap_invoices where business_id=business and id=(payload->>'invoice_id')::uuid;
    if cr.id is null or cr.voided_at is not null or i.id is null or i.status<>'Approved' or i.supplier_id<>cr.supplier_id then raise exception 'Choose an approved invoice from the same supplier.'; end if;
    v:=(payload->>'amount_cents')::bigint;
    paid:=coalesce((select sum(amount_cents) from public.ap_credit_allocations where business_id=business and credit_id=cr.id and reversed_at is null),0);
    if v is null or v<=0 or v>cr.amount_cents-paid then raise exception 'Amount exceeds available credit.'; end if;
    paid:=coalesce((select sum(amount_cents) from public.ap_payments where business_id=business and invoice_id=i.id and reversed_at is null),0)+coalesce((select sum(amount_cents) from public.ap_credit_allocations where business_id=business and invoice_id=i.id and reversed_at is null),0);
    if v>i.subtotal_cents+i.tax_cents+i.shipping_cents-i.discount_cents-paid then raise exception 'Credit exceeds invoice balance.'; end if;
    if (payload->>'date')::date<greatest(cr.date,i.issue_date) or (payload->>'date')::date>day_today then raise exception 'Invalid application date.'; end if;
    insert into public.ap_credit_allocations(id,business_id,credit_id,invoice_id,amount_cents,date) values(target,business,cr.id,i.id,v,(payload->>'date')::date);
    select to_jsonb(c) into next_value from public.ap_credit_allocations c where id=target;
  elsif action='credit.reverse' then
    if r<>'admin' or length(btrim(coalesce(payload->>'reason','')))<5 then raise exception 'Administrator and a reason required.'; end if;
    select * into alloc from public.ap_credit_allocations where business_id=business and id=target;
    if alloc.id is null or alloc.reversed_at is not null then raise exception 'Application missing or already reversed.'; end if;
    prev:=to_jsonb(alloc);update public.ap_credit_allocations set reversed_at=now(),reversal_reason=payload->>'reason' where id=target;
    select to_jsonb(c) into next_value from public.ap_credit_allocations c where id=target;
  elsif action='credit.void' then
    if r<>'admin' or length(btrim(coalesce(payload->>'reason','')))<5 then raise exception 'Administrator and a reason required.'; end if;
    select * into cr from public.ap_credits where business_id=business and id=target;
    if cr.id is null or cr.voided_at is not null or exists(select 1 from public.ap_credit_allocations where credit_id=target and reversed_at is null) then raise exception 'Reverse credit applications before voiding.'; end if;
    prev:=to_jsonb(cr); update public.ap_credits set voided_at=now(),void_reason=payload->>'reason' where id=target;
    select to_jsonb(c) into next_value from public.ap_credits c where id=target;
  elsif action='payment.batch' then
    if jsonb_typeof(payload->'items') is distinct from 'array' or jsonb_array_length(payload->'items') not between 1 and 100 then raise exception 'Select 1 to 100 invoices.'; end if;
    if (select count(distinct x->>'invoice_id') from jsonb_array_elements(payload->'items') x)<>jsonb_array_length(payload->'items') then raise exception 'Duplicate invoice allocation.'; end if;
    for item in select * from jsonb_array_elements(payload->'items') loop
      select * into i from public.ap_invoices where business_id=business and id=(item->>'invoice_id')::uuid;
      if i.id is null then raise exception 'Invoice not found.'; end if;
      if batch_supplier is not null and batch_supplier<>i.supplier_id then raise exception 'One payment batch must use one supplier.'; end if; batch_supplier:=i.supplier_id;
      child:=gen_random_uuid();
      perform public.ap_command_v2(business,child,'payment.record',jsonb_build_object('invoice_id',i.id,'amount_cents',item->'amount_cents','date',payload->>'date','method',payload->>'method','reference',payload->>'reference','notes',payload->>'notes'));
      update public.ap_payments set batch_id=request_id where id=child;
      sum_total:=sum_total+(item->>'amount_cents')::bigint;
    end loop;
    target:=request_id;next_value:=jsonb_build_object('batch_id',request_id,'supplier_id',batch_supplier,'amount_cents',sum_total,'items',payload->'items');
  elsif action='quote.save' then
    select to_jsonb(q) into prev from public.ap_quotes q where business_id=business and id=target;
    if payload ? 'id' and (prev is null or (prev->>'version')::int is distinct from (payload->>'version')::int) then raise exception 'Quote changed. Refresh.'; end if;
    if length(btrim(coalesce(payload->>'product','')))=0 or length(btrim(coalesce(payload->>'unit','')))=0 then raise exception 'Product and unit are required.'; end if;
    insert into public.ap_quotes(id,business_id,supplier_id,product,brand,unit,unit_cents,date,notes,active) values(target,business,(payload->>'supplier_id')::uuid,btrim(payload->>'product'),coalesce(payload->>'brand',''),lower(btrim(payload->>'unit')),(payload->>'unit_cents')::bigint,(payload->>'date')::date,coalesce(payload->>'notes',''),coalesce((payload->>'active')::boolean,true)) on conflict(id) do update set supplier_id=excluded.supplier_id,product=excluded.product,brand=excluded.brand,unit=excluded.unit,unit_cents=excluded.unit_cents,date=excluded.date,notes=excluded.notes,active=excluded.active,version=ap_quotes.version+1 where ap_quotes.business_id=business;
    select to_jsonb(q) into next_value from public.ap_quotes q where id=target;
  elsif action='order.save' then
    select * into ord from public.ap_orders where business_id=business and id=target;
    if payload ? 'id' and (ord.id is null or ord.status<>'Draft' or ord.version is distinct from (payload->>'version')::int) then raise exception 'Only unchanged draft orders can be edited.'; end if;
    if not exists(select 1 from public.ap_suppliers where business_id=business and id=(payload->>'supplier_id')::uuid and status='Active') then raise exception 'Choose an active supplier.'; end if;
    if length(btrim(coalesce(payload->>'number','')))=0 or jsonb_typeof(payload->'lines') is distinct from 'array' or jsonb_array_length(payload->'lines') not between 1 and 100 then raise exception 'Order number and 1 to 100 lines required.'; end if;
    for item in select * from jsonb_array_elements(payload->'lines') loop
      quantity:=(item->>'quantity')::numeric;v:=(item->>'unit_cents')::bigint;
      if quantity is null or quantity<=0 or quantity>1000000 or quantity<>round(quantity,3) or v is null or v<=0 or v>100000000000 or length(btrim(coalesce(item->>'product','')))=0 or length(btrim(coalesce(item->>'unit','')))=0 then raise exception 'Invalid order line.'; end if;
      sum_total:=sum_total+round(quantity*v)::bigint;
    end loop;
    prev:=case when ord.id is null then null else to_jsonb(ord) end;
    insert into public.ap_orders(id,business_id,supplier_id,number,date,status,lines,notes,total_cents) values(target,business,(payload->>'supplier_id')::uuid,btrim(payload->>'number'),(payload->>'date')::date,'Draft',payload->'lines',coalesce(payload->>'notes',''),sum_total) on conflict(id) do update set supplier_id=excluded.supplier_id,number=excluded.number,date=excluded.date,lines=excluded.lines,notes=excluded.notes,total_cents=excluded.total_cents,version=ap_orders.version+1 where ap_orders.business_id=business;
    select to_jsonb(o) into next_value from public.ap_orders o where id=target;
  elsif action='order.status' then
    select * into ord from public.ap_orders where business_id=business and id=target;
    if ord.id is null or ord.version is distinct from (payload->>'version')::int then raise exception 'Order changed. Refresh.'; end if;
    if not ((ord.status='Draft' and payload->>'status' in ('Ordered','Cancelled')) or (ord.status='Ordered' and payload->>'status' in ('Received','Cancelled'))) then raise exception 'Invalid order transition.'; end if;
    prev:=to_jsonb(ord);update public.ap_orders set status=payload->>'status',version=version+1,received_at=case when payload->>'status'='Received' then now() else received_at end where id=target;
    select to_jsonb(o) into next_value from public.ap_orders o where id=target;
  elsif action='order.invoice' then
    select * into ord from public.ap_orders where business_id=business and id=target;
    if ord.id is null or ord.status<>'Received' or ord.invoice_id is not null then raise exception 'Receive this order first. It can be converted only once.'; end if;
    child:=gen_random_uuid();
    perform public.ap_command_v2(business,child,'invoice.save',jsonb_build_object('supplier_id',ord.supplier_id,'number',payload->>'number','issue_date',payload->>'issue_date','due_date',payload->>'due_date','category','Purchases','description','Purchase order '||ord.number,'subtotal_cents',ord.total_cents,'tax_cents',coalesce((payload->>'tax_cents')::bigint,0),'shipping_cents',coalesce((payload->>'shipping_cents')::bigint,0),'discount_cents',0));
    prev:=to_jsonb(ord);update public.ap_orders set invoice_id=child,version=version+1 where id=target;
    select to_jsonb(o) into next_value from public.ap_orders o where id=target;
  elsif action='plan.save' then
    select to_jsonb(p) into prev from public.ap_plans p where business_id=business and id=target;
    if payload ? 'id' and (prev is null or (prev->>'version')::int is distinct from (payload->>'version')::int) then raise exception 'Plan changed. Refresh.'; end if;
    if length(btrim(coalesce(payload->>'name','')))=0 or jsonb_typeof(payload->'items') is distinct from 'array' then raise exception 'Plan name and items required.'; end if;
    for item in select * from jsonb_array_elements(payload->'items') loop
      if not exists(select 1 from public.ap_invoices where business_id=business and id=(item->>'invoice_id')::uuid and status='Approved') or (item->>'amount_cents') is null or (item->>'amount_cents')::bigint<=0 then raise exception 'Invalid planned invoice.'; end if;
    end loop;
    insert into public.ap_plans values(target,business,payload->>'name',(payload->>'date')::date,(payload->>'budget_cents')::bigint,payload->'items',1) on conflict(id) do update set name=excluded.name,date=excluded.date,budget_cents=excluded.budget_cents,items=excluded.items,version=ap_plans.version+1 where ap_plans.business_id=business;
    select to_jsonb(p) into next_value from public.ap_plans p where id=target;
  elsif action='document.add' then
    if not exists(select 1 from storage.objects where bucket_id='sintech-documents' and name=payload->>'path' and split_part(name,'/',1)=business::text) then raise exception 'Upload not found in this business.'; end if;
    if not ((payload->>'entity_type'='supplier' and exists(select 1 from public.ap_suppliers where business_id=business and id=(payload->>'entity_id')::uuid)) or (payload->>'entity_type'='invoice' and exists(select 1 from public.ap_invoices where business_id=business and id=(payload->>'entity_id')::uuid)) or (payload->>'entity_type'='payment' and exists(select 1 from public.ap_payments where business_id=business and id=(payload->>'entity_id')::uuid)) or (payload->>'entity_type'='order' and exists(select 1 from public.ap_orders where business_id=business and id=(payload->>'entity_id')::uuid)) or (payload->>'entity_type'='credit' and exists(select 1 from public.ap_credits where business_id=business and id=(payload->>'entity_id')::uuid))) then raise exception 'Document target not found.'; end if;
    insert into public.ap_documents(id,business_id,entity_type,entity_id,name,path,mime,size,created_by) values(target,business,payload->>'entity_type',(payload->>'entity_id')::uuid,left(payload->>'name',250),payload->>'path',payload->>'mime',(payload->>'size')::bigint,auth.uid());
    select to_jsonb(d) into next_value from public.ap_documents d where id=target;
  elsif action='document.archive' then
    if r<>'admin' then raise exception 'Administrator required.'; end if;
    select to_jsonb(d) into prev from public.ap_documents d where business_id=business and id=target;
    if prev is null then raise exception 'Document not found.'; end if;
    update public.ap_documents set archived_at=now() where business_id=business and id=target;
    select to_jsonb(d) into next_value from public.ap_documents d where id=target;
  elsif action='backup.create' then
    if r<>'admin' then raise exception 'Administrator required.'; end if;
    insert into public.ap_backups(id,business_id,created_by,label,data) values(target,business,auth.uid(),'Manual snapshot',public.ap_snapshot_v2(business)-'backups');
    next_value:=jsonb_build_object('backup_id',target);
  else raise exception 'Unknown operation.';
  end if;
  insert into public.ap_audit(business_id,id,type,entity_id,actor,before,after) values(business,request_id,action,target::text,actor_name,prev,next_value);
  insert into public.ap_requests(business_id,id,user_id,action,payload) values(business,request_id,auth.uid(),action,payload);
  update public.ap_settings set revision=revision+1 where business_id=business and id=1;
  return public.ap_snapshot_v2(business);
exception when unique_violation then raise exception 'A supplier name or invoice number already exists. Refresh and check the existing records.';
end $$;

revoke all on function public.ap_command_v2(uuid,uuid,text,jsonb) from public,anon;
grant execute on function public.ap_command_v2(uuid,uuid,text,jsonb) to authenticated;
-- Disable obsolete unscoped endpoints. No legacy data is deleted.
revoke execute on function public.ap_command(uuid,text,jsonb),public.ap_snapshot(),public.ap_role() from public,anon,authenticated;
revoke all on public."Suppliers",public.ap_members from anon,authenticated;
alter table public."Suppliers" enable row level security;
-- Documents remain private. Immutable objects avoid replacing audit evidence.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('sintech-documents','sintech-documents',false,10485760,array['application/pdf','image/jpeg','image/png','image/webp']);
create policy sintech_documents_read on storage.objects for select to authenticated using(bucket_id='sintech-documents' and public.ap_role_v2((storage.foldername(name))[1]::uuid) is not null);
create policy sintech_documents_insert on storage.objects for insert to authenticated with check(bucket_id='sintech-documents' and public.ap_role_v2((storage.foldername(name))[1]::uuid) in ('admin','accountant'));
-- No client update/delete policy. Archive metadata retains original proof.
create function public.ap_backup_download(business uuid,backup uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; begin
 if public.ap_role_v2(business)<>'admin' or public.ap_role_v2(business) is null then raise exception 'Administrator required.'; end if;
 select data into result from public.ap_backups where business_id=business and id=backup;
 if result is null then raise exception 'Backup not found.'; end if; return result;
end $$;
revoke all on function public.ap_backup_download(uuid,uuid) from public,anon;
grant execute on function public.ap_backup_download(uuid,uuid) to authenticated;
create function public.ap_backup_restore(business uuid,backup uuid,request_id uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare snapshot jsonb; serialized text; row_id text; target_table text; cols text; old_request public.ap_requests; business_name text;
begin
 if public.ap_role_v2(business) is distinct from 'admin' then raise exception 'Administrator required.'; end if;
 perform 1 from public.ap_settings where business_id=business for update;
 select * into old_request from public.ap_requests where id=request_id;
 if found then
  if old_request.business_id=business and old_request.user_id=auth.uid() and old_request.action='backup.restore' and old_request.payload=jsonb_build_object('backup',backup) then return request_id; end if;
  raise exception 'Request ID already used.';
 end if;
 select data into snapshot from public.ap_backups where business_id=business and id=backup;
 if snapshot is null then raise exception 'Backup not found.'; end if;
 if exists(select 1 from public.ap_businesses where id=request_id) then raise exception 'Business ID already used.'; end if;
 snapshot:=jsonb_set(snapshot,'{suppliers}',coalesce((select jsonb_agg(x || '{"legacy_id":null}'::jsonb) from jsonb_array_elements(snapshot->'suppliers') x),'[]'::jsonb));
 serialized:=snapshot::text;
 for row_id in select distinct item->>'id' from jsonb_each(snapshot) j cross join lateral jsonb_array_elements(case when jsonb_typeof(j.value)='array' then j.value else '[]'::jsonb end) item where j.key in ('suppliers','invoices','payments','audit','categories','credits','credit_allocations','quotes','orders','plans') and item ? 'id' loop
  serialized:=replace(serialized,'"'||row_id||'"','"'||gen_random_uuid()::text||'"');
 end loop;
 serialized:=replace(serialized,'"'||business::text||'"','"'||request_id::text||'"');snapshot:=serialized::jsonb;
 business_name:=left((snapshot->'settings'->>'business_name')||' · Recovered '||to_char(now(),'YYYY-MM-DD HH24:MI'),250);
 insert into public.ap_businesses(id,name) values(request_id,business_name);
 insert into public.ap_business_members values(request_id,auth.uid(),'admin',true);
 insert into public.ap_settings(id,business_id,business_name,address,phone,email,terms_days,revision) values(1,request_id,business_name,coalesce(snapshot->'settings'->>'address',''),coalesce(snapshot->'settings'->>'phone',''),coalesce(snapshot->'settings'->>'email',''),(snapshot->'settings'->>'terms_days')::int,coalesce((snapshot->>'revision')::int,0));
 foreach target_table in array array['suppliers','invoices','payments','categories','credits','credit_allocations','quotes','orders','plans','audit'] loop
  -- Tables are selected from a constant allowlist, never user input.
  select string_agg(quote_ident(column_name),',' order by ordinal_position) into cols from information_schema.columns where table_schema='public' and information_schema.columns.table_name='ap_'||target_table;
  execute format('insert into public.%I(%s) select %s from jsonb_populate_recordset(null::public.%I,$1)','ap_'||target_table,cols,cols,'ap_'||target_table) using coalesce(snapshot->target_table,'[]'::jsonb);
 end loop;
 insert into public.ap_audit(id,business_id,type,entity_id,actor,after) values(gen_random_uuid(),request_id,'backup.restored',request_id::text,auth.uid()::text,jsonb_build_object('source_business',business,'source_backup',backup,'documents','File contents remain in the original business. Download them there.'));
 insert into public.ap_requests(id,business_id,user_id,action,payload) values(request_id,business,auth.uid(),'backup.restore',jsonb_build_object('backup',backup));
 return request_id;
end $$;
revoke all on function public.ap_backup_restore(uuid,uuid,uuid) from public,anon;
grant execute on function public.ap_backup_restore(uuid,uuid,uuid) to authenticated;

commit;
