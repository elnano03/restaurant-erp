-- SINTECH AP 1.0: run once in Supabase SQL Editor as project administrator.
-- One business per installation. The existing public."Suppliers" is untouched.
begin;
create table public.ap_members (
  user_id uuid primary key references auth.users(id),
  role text not null check (role in ('admin','accountant','viewer')),
  active boolean not null default true
);
create table public.ap_settings (
  id integer primary key check(id=1), business_name text not null default 'SINTECH Restaurant',
  address text not null default '', phone text not null default '', email text not null default '',
  terms_days integer not null default 30 check(terms_days between 0 and 365), revision integer not null default 0
);
insert into public.ap_settings(id) values(1);
create table public.ap_suppliers (
  id uuid primary key, business_name text not null check(length(business_name) between 1 and 250),
  contact text not null default '', phone text not null default '', email text not null default '',
  address text not null default '', category text not null default '', status text not null check(status in ('Active','Inactive','Blocked')),
  terms_days integer not null check(terms_days between 0 and 365), notes text not null default '',
  version integer not null default 1, created_at timestamptz not null default now(), legacy_id text unique
);
create unique index ap_supplier_name_unique on public.ap_suppliers(lower(business_name));
create table public.ap_invoices (
  id uuid primary key, supplier_id uuid not null references public.ap_suppliers(id), number text not null check(length(number) between 1 and 100),
  issue_date date not null, due_date date not null check(due_date >= issue_date),
  category text not null default '', description text not null default '',
  subtotal_cents bigint not null check(subtotal_cents between 0 and 100000000000),
  tax_cents bigint not null check(tax_cents between 0 and 100000000000),
  shipping_cents bigint not null check(shipping_cents between 0 and 100000000000),
  discount_cents bigint not null check(discount_cents between 0 and 100000000000),
  status text not null check(status in ('Draft','Approved','Void')), version integer not null default 1,
  created_at timestamptz not null default now(), approved_at timestamptz, voided_at timestamptz, void_reason text,
  check(subtotal_cents+tax_cents+shipping_cents-discount_cents between 1 and 100000000000)
);
create unique index ap_invoice_number_unique on public.ap_invoices(supplier_id,lower(number));
create index ap_invoices_due on public.ap_invoices(due_date) where status='Approved';
create table public.ap_payments (
  id uuid primary key, invoice_id uuid not null references public.ap_invoices(id),
  amount_cents bigint not null check(amount_cents between 1 and 100000000000), date date not null,
  method text not null check(method in ('ACH','Check','Cash','Card','Wire','Other')),
  reference text not null default '', notes text not null default '', created_at timestamptz not null default now(),
  reversed_at timestamptz, reversal_reason text
);
create index ap_payments_invoice on public.ap_payments(invoice_id);
create table public.ap_audit (
  id uuid primary key, type text not null, entity_id text, actor text not null, at timestamptz not null default now(),
  before jsonb, after jsonb
);
create table public.ap_requests (
  id uuid primary key, user_id uuid not null, action text not null, payload jsonb not null, created_at timestamptz default now()
);

create function public.ap_role() returns text language sql stable security definer set search_path='' as $$
  select role from public.ap_members where user_id=auth.uid() and active;
$$;
revoke all on function public.ap_role() from public, anon;
grant execute on function public.ap_role() to authenticated;

alter table public.ap_members enable row level security;
alter table public.ap_settings enable row level security;
alter table public.ap_suppliers enable row level security;
alter table public.ap_invoices enable row level security;
alter table public.ap_payments enable row level security;
alter table public.ap_audit enable row level security;
alter table public.ap_requests enable row level security;
-- No client table writes: all mutations go through the validated atomic command function.
revoke all on public.ap_members,public.ap_settings,public.ap_suppliers,public.ap_invoices,public.ap_payments,public.ap_audit,public.ap_requests from anon,authenticated;
grant select on public.ap_members,public.ap_settings,public.ap_suppliers,public.ap_invoices,public.ap_payments,public.ap_audit to authenticated;
create policy ap_members_read on public.ap_members for select to authenticated using(user_id=auth.uid());
create policy ap_settings_read on public.ap_settings for select to authenticated using(public.ap_role() is not null);
create policy ap_suppliers_read on public.ap_suppliers for select to authenticated using(public.ap_role() is not null);
create policy ap_invoices_read on public.ap_invoices for select to authenticated using(public.ap_role() is not null);
create policy ap_payments_read on public.ap_payments for select to authenticated using(public.ap_role() is not null);
create policy ap_audit_read on public.ap_audit for select to authenticated using(public.ap_role() is not null);

create function public.ap_snapshot() returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  if public.ap_role() is null then raise exception 'Your user has not been authorized for this business.'; end if;
  select jsonb_build_object('schema',1,'revision',x.revision,'role',public.ap_role(),
    'settings',to_jsonb(x)-'id'-'revision',
    'suppliers',coalesce((select jsonb_agg(to_jsonb(s) order by s.business_name) from public.ap_suppliers s),'[]'::jsonb),
    'invoices',coalesce((select jsonb_agg(to_jsonb(i) order by i.created_at desc) from public.ap_invoices i),'[]'::jsonb),
    'payments',coalesce((select jsonb_agg(to_jsonb(p) order by p.created_at desc) from public.ap_payments p),'[]'::jsonb),
    'audit',coalesce((select jsonb_agg(to_jsonb(a) order by a.at desc) from public.ap_audit a),'[]'::jsonb),
    'commands','[]'::jsonb) into result from public.ap_settings x where id=1;
  return result;
end $$;
revoke all on function public.ap_snapshot() from public,anon;
grant execute on function public.ap_snapshot() to authenticated;

create function public.ap_command(request_id uuid, action text, payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  r text; target uuid; prev jsonb; next_value jsonb; i public.ap_invoices; sp public.ap_suppliers;
  pay public.ap_payments; existing public.ap_requests; n text; paid bigint; total bigint; v bigint;
  actor_name text; day_today date := (now() at time zone 'America/New_York')::date;
begin
  r:=public.ap_role();
  if r is null or r='viewer' then raise exception 'Your account does not have write access.'; end if;
  if request_id is null or payload is null then raise exception 'Invalid request.'; end if;
  -- Serialize financial writes for this business. This also prevents racing partial payments.
  perform 1 from public.ap_settings where id=1 for update;
  select * into existing from public.ap_requests where id=request_id;
  if found then
    if existing.user_id<>auth.uid() or existing.action<>action or existing.payload<>payload then raise exception 'Request ID already used.'; end if;
    return public.ap_snapshot();
  end if;
  actor_name:=coalesce(auth.jwt()->>'email',auth.uid()::text);
  target:=coalesce(nullif(payload->>'id','')::uuid,request_id);
  if action='supplier.save' then
    select * into sp from public.ap_suppliers where id=target;
    if payload ? 'id' and sp.id is null then raise exception 'Supplier no longer exists.'; end if;
    if sp.id is not null and (payload->>'version')::integer is distinct from sp.version then raise exception 'Supplier changed. Refresh and reopen it.'; end if;
    prev:=case when sp.id is null then null else to_jsonb(sp) end;
    n:=btrim(coalesce(payload->>'business_name',''));
    if length(n)<1 or length(n)>250 then raise exception 'Business name is required (max 250 characters).'; end if;
    if coalesce(payload->>'email','')<>'' and (payload->>'email') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Invalid email.'; end if;
    insert into public.ap_suppliers(id,business_name,contact,phone,email,address,category,status,terms_days,notes)
      values(target,n,left(coalesce(payload->>'contact',''),250),left(coalesce(payload->>'phone',''),60),left(coalesce(payload->>'email',''),250),left(coalesce(payload->>'address',''),1000),left(coalesce(payload->>'category',''),250),payload->>'status',(payload->>'terms_days')::integer,left(coalesce(payload->>'notes',''),3000))
      on conflict(id) do update set business_name=excluded.business_name,contact=excluded.contact,phone=excluded.phone,email=excluded.email,address=excluded.address,category=excluded.category,status=excluded.status,terms_days=excluded.terms_days,notes=excluded.notes,version=ap_suppliers.version+1;
    select to_jsonb(s) into next_value from public.ap_suppliers s where id=target;
  elsif action='invoice.save' then
    select * into i from public.ap_invoices where id=target;
    if payload ? 'id' and i.id is null then raise exception 'Invoice no longer exists.'; end if;
    if i.id is not null and (i.status<>'Draft' or (payload->>'version')::integer is distinct from i.version) then raise exception 'Only unchanged drafts can be edited.'; end if;
    prev:=case when i.id is null then null else to_jsonb(i) end;
    select * into sp from public.ap_suppliers where id=(payload->>'supplier_id')::uuid;
    if sp.id is null or sp.status<>'Active' then raise exception 'Choose an active supplier.'; end if;
    n:=btrim(coalesce(payload->>'number',''));
    insert into public.ap_invoices(id,supplier_id,number,issue_date,due_date,category,description,subtotal_cents,tax_cents,shipping_cents,discount_cents,status)
      values(target,sp.id,n,(payload->>'issue_date')::date,(payload->>'due_date')::date,left(coalesce(payload->>'category',''),250),left(coalesce(payload->>'description',''),3000),(payload->>'subtotal_cents')::bigint,(payload->>'tax_cents')::bigint,(payload->>'shipping_cents')::bigint,(payload->>'discount_cents')::bigint,'Draft')
      on conflict(id) do update set supplier_id=excluded.supplier_id,number=excluded.number,issue_date=excluded.issue_date,due_date=excluded.due_date,category=excluded.category,description=excluded.description,subtotal_cents=excluded.subtotal_cents,tax_cents=excluded.tax_cents,shipping_cents=excluded.shipping_cents,discount_cents=excluded.discount_cents,version=ap_invoices.version+1;
    select to_jsonb(x) into next_value from public.ap_invoices x where id=target;
  elsif action in ('invoice.approve','invoice.void') then
    select * into i from public.ap_invoices where id=target;
    if i.id is null or (payload->>'version')::integer is distinct from i.version then raise exception 'Invoice changed or no longer exists. Refresh.'; end if;
    prev:=to_jsonb(i);
    if action='invoice.approve' then
      if i.status<>'Draft' then raise exception 'Only drafts can be approved.'; end if;
      if not exists(select 1 from public.ap_suppliers where id=i.supplier_id and status='Active') then raise exception 'Supplier is not active.'; end if;
      update public.ap_invoices set status='Approved',approved_at=now(),version=version+1 where id=target;
    else
      if r<>'admin' then raise exception 'Only administrators can void invoices.'; end if;
      if i.status='Void' or exists(select 1 from public.ap_payments where invoice_id=target and reversed_at is null) then raise exception 'Reverse payments before voiding an invoice.'; end if;
      if length(btrim(coalesce(payload->>'reason','')))<5 then raise exception 'A reason of at least five characters is required.'; end if;
      update public.ap_invoices set status='Void',voided_at=now(),void_reason=left(payload->>'reason',1000),version=version+1 where id=target;
    end if;
    select to_jsonb(x) into next_value from public.ap_invoices x where id=target;
  elsif action='payment.record' then
    select * into i from public.ap_invoices where id=(payload->>'invoice_id')::uuid;
    if i.id is null or i.status<>'Approved' then raise exception 'Payments require an approved invoice.'; end if;
    if exists(select 1 from public.ap_suppliers where id=i.supplier_id and status='Blocked') then raise exception 'Payments to a blocked supplier are not allowed.'; end if;
    select coalesce(sum(amount_cents),0) into paid from public.ap_payments where invoice_id=i.id and reversed_at is null;
    total:=i.subtotal_cents+i.tax_cents+i.shipping_cents-i.discount_cents;v:=(payload->>'amount_cents')::bigint;
    if v is null or v<=0 or v>total-paid then raise exception 'Payment exceeds the outstanding balance or is invalid.'; end if;
    if (payload->>'date')::date<i.issue_date or (payload->>'date')::date>day_today then raise exception 'Payment date must be between invoice date and today.'; end if;
    target:=request_id;
    insert into public.ap_payments(id,invoice_id,amount_cents,date,method,reference,notes) values(target,i.id,v,(payload->>'date')::date,payload->>'method',left(coalesce(payload->>'reference',''),250),left(coalesce(payload->>'notes',''),3000));
    select to_jsonb(x) into next_value from public.ap_payments x where id=target;
  elsif action='payment.reverse' then
    if r<>'admin' then raise exception 'Only administrators can reverse payments.'; end if;
    select * into pay from public.ap_payments where id=target;
    if pay.id is null or pay.reversed_at is not null then raise exception 'Payment is missing or already reversed.'; end if;
    if length(btrim(coalesce(payload->>'reason','')))<5 then raise exception 'A reason of at least five characters is required.'; end if;
    prev:=to_jsonb(pay);
    update public.ap_payments set reversed_at=now(),reversal_reason=left(payload->>'reason',1000) where id=target;
    select to_jsonb(x) into next_value from public.ap_payments x where id=target;
  elsif action='settings.save' then
    if r<>'admin' then raise exception 'Only administrators can change settings.'; end if;
    n:=btrim(coalesce(payload->>'business_name',''));if length(n)<1 then raise exception 'Business name is required.'; end if;
    select to_jsonb(x) into prev from public.ap_settings x where id=1;
    update public.ap_settings set business_name=left(n,250),address=left(coalesce(payload->>'address',''),1000),phone=left(coalesce(payload->>'phone',''),60),email=left(coalesce(payload->>'email',''),250),terms_days=(payload->>'terms_days')::integer where id=1;
    select to_jsonb(x) into next_value from public.ap_settings x where id=1;
  else raise exception 'Unknown operation.';
  end if;
  insert into public.ap_audit(id,type,entity_id,actor,before,after) values(request_id,action,target::text,actor_name,prev,next_value);
  insert into public.ap_requests(id,user_id,action,payload) values(request_id,auth.uid(),action,payload);
  update public.ap_settings set revision=revision+1 where id=1;
  return public.ap_snapshot();
exception when unique_violation then raise exception 'A supplier name or invoice number already exists. Refresh and check the existing records.';
end $$;
revoke all on function public.ap_command(uuid,text,jsonb) from public,anon;
grant execute on function public.ap_command(uuid,text,jsonb) to authenticated;
commit;
