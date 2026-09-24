begin;
alter table public.ap_products add column reorder_point numeric(16,3) default 0 check(reorder_point between 0 and 1000000000);
alter table public.ap_products add column target_stock numeric(16,3) default 0 check(target_stock>=coalesce(reorder_point,0) and target_stock<=1000000000);
alter table public.ap_invoices add column payment_hold boolean default false;
alter table public.ap_invoices add column hold_reason text;
create table public.ap_stock_counts(id uuid primary key,business_id uuid not null references public.ap_businesses(id),date date not null,reason text not null,lines jsonb not null,created_at timestamptz not null default now(),created_by uuid not null references auth.users(id));
create index ap_stock_counts_business on public.ap_stock_counts(business_id,created_at);
alter table public.ap_stock_counts enable row level security;
revoke all on public.ap_stock_counts from public,anon,authenticated;
grant select on public.ap_stock_counts to authenticated;
create policy ap_stock_counts_read on public.ap_stock_counts for select to authenticated using(public.ap_role_v2(business_id) is not null);
alter table public.ap_inventory_moves drop constraint ap_inventory_moves_kind_check;
alter table public.ap_inventory_moves add constraint ap_inventory_moves_kind_check check(kind in ('receipt','void','adjustment','production','waste','kitchen_reversal','count'));
-- Preserve existing entrypoints; all consumers receive the same extended snapshot.
alter function ap_private.kitchen_snapshot(uuid) rename to kitchen_snapshot_base;
revoke all on function ap_private.kitchen_snapshot_base(uuid) from public,anon,authenticated;
create function ap_private.kitchen_snapshot(business uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or public.ap_role_v2(business) is null then raise exception 'No access to this business.'; end if;
 return ap_private.kitchen_snapshot_base(business)||jsonb_build_object('stock_counts',coalesce((select jsonb_agg(to_jsonb(c)) from public.ap_stock_counts c where business_id=business),'[]'::jsonb));
end $$;
revoke all on function ap_private.kitchen_snapshot(uuid) from public,anon;
grant execute on function ap_private.kitchen_snapshot(uuid) to authenticated;
-- SQL wrappers are redefined because PostgreSQL binds SQL function dependencies by OID.
create or replace function public.ap_snapshot_v2(business uuid) returns jsonb language sql security invoker set search_path='' as $$ select ap_private.kitchen_snapshot(business) $$;

alter function public.ap_command_v2(uuid,uuid,text,jsonb) rename to ap_command_inventory_v2;
revoke all on function public.ap_command_inventory_v2(uuid,uuid,text,jsonb) from public,anon,authenticated;
create function ap_private.operations_command(business uuid,request_id uuid,action text,payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare r text; old_request public.ap_requests; target uuid; p public.ap_products; inv public.ap_invoices; ord public.ap_orders;
 item jsonb; result jsonb; prior jsonb; stored jsonb:='[]'::jsonb; ids uuid[]:=array[]::uuid[]; prod uuid;
 counted numeric; actual numeric; expected numeric; diff numeric; min_qty numeric; target_qty numeric; n numeric; stock_qty numeric;
 reason text; day_today date:=(now() at time zone 'America/New_York')::date; total bigint:=0; child uuid;
begin
 r:=public.ap_role_v2(business);
 if auth.uid() is null or r is null or r='viewer' then raise exception 'Your account does not have write access.'; end if;
 if request_id is null or payload is null then raise exception 'Invalid request.'; end if;
 perform 1 from public.ap_settings where business_id=business for update;
 select * into old_request from public.ap_requests where id=request_id;
 if found then
  if old_request.business_id=business and old_request.user_id=auth.uid() and old_request.action=action and old_request.payload=payload then return public.ap_snapshot_v2(business); end if;
  raise exception 'Request ID already used.';
 end if;
 target:=coalesce(nullif(payload->>'id','')::uuid,request_id);
 -- Validate financial and purchasing transitions on the server, including batch children.
 if action='payment.record' then
  if exists(select 1 from public.ap_invoices where business_id=business and id=(payload->>'invoice_id')::uuid and payment_hold) then raise exception 'Invoice is on payment hold. Release the hold after review.'; end if;
 elsif action='invoice.save' then
  if (payload->>'issue_date')::date>day_today then raise exception 'Invoice date cannot be in the future.'; end if;
  if exists(select 1 from public.ap_invoices where business_id=business and supplier_id=(payload->>'supplier_id')::uuid and id<>target and lower(regexp_replace(number,'[[:space:]]','','g'))=lower(regexp_replace(payload->>'number','[[:space:]]','','g'))) then raise exception 'Duplicate supplier invoice number (check spaces and capitalization).'; end if;
  if exists(select 1 from public.ap_invoice_lines where business_id=business and invoice_id=target) then
   select sum(amount_cents) into total from public.ap_invoice_lines where business_id=business and invoice_id=target;
   if total is distinct from (payload->>'subtotal_cents')::bigint then raise exception 'Subtotal must match the stored invoice lines. Void this draft and import the corrected supplier invoice.'; end if;
  end if;
 elsif action='invoice.approve' or action='inventory.receive' then
  select * into inv from public.ap_invoices where business_id=business and id=target;
  if exists(select 1 from public.ap_invoice_lines where business_id=business and invoice_id=target) then
   select sum(amount_cents) into total from public.ap_invoice_lines where business_id=business and invoice_id=target;
   if total is distinct from inv.subtotal_cents then raise exception 'Invoice lines do not reconcile with the subtotal.'; end if;
  end if;
  if action='inventory.receive' and not exists(select 1 from public.ap_invoice_lines where business_id=business and invoice_id=target and product_id is not null) then raise exception 'This invoice has no inventory products to receive.'; end if;
 elsif action='order.save' then
  if (payload->>'date')::date>day_today then raise exception 'Order date cannot be in the future.'; end if;
  if exists(select 1 from public.ap_orders where business_id=business and id<>target and lower(btrim(number))=lower(btrim(payload->>'number'))) then raise exception 'Duplicate purchase order number.'; end if;
  for item in select * from jsonb_array_elements(payload->'lines') loop
   prod:=nullif(item->>'product_id','')::uuid;
   if prod is not null then
    select * into p from public.ap_products where business_id=business and id=prod and active;
    stock_qty:=(item->>'stock_quantity')::numeric;
    if p.id is null or p.unit is distinct from item->>'stock_unit' or stock_qty is null or stock_qty<=0 or stock_qty>1000000000 or stock_qty<>round(stock_qty,3) then raise exception 'Review the mapped inventory product, unit and stock quantity.'; end if;
   end if;
  end loop;
 elsif action='order.status' and payload->>'status'='Ordered' then
  if not exists(select 1 from public.ap_orders o join public.ap_suppliers s on s.id=o.supplier_id and s.business_id=o.business_id where o.business_id=business and o.id=target and s.status='Active') then raise exception 'Choose an active supplier before ordering.'; end if;
 elsif action='quote.save' then
  if not exists(select 1 from public.ap_suppliers where business_id=business and id=(payload->>'supplier_id')::uuid and status='Active') then raise exception 'Choose an active supplier.'; end if;
  if (payload->>'date')::date>day_today then raise exception 'Quote date cannot be in the future.'; end if;
 elsif action='plan.save' then
  if jsonb_typeof(payload->'items') is distinct from 'array' or jsonb_array_length(payload->'items') not between 1 and 100 then raise exception 'Select 1 to 100 planned invoices.'; end if;
  for item in select * from jsonb_array_elements(payload->'items') loop
   select * into inv from public.ap_invoices where business_id=business and id=(item->>'invoice_id')::uuid and status='Approved';
   if inv.id is null or inv.payment_hold or inv.id=any(ids) then raise exception 'Planned invoices must be unique, approved and not on hold.'; end if;ids:=array_append(ids,inv.id);
   n:=inv.subtotal_cents+inv.tax_cents+inv.shipping_cents-inv.discount_cents-coalesce((select sum(amount_cents) from public.ap_payments where business_id=business and invoice_id=inv.id and reversed_at is null),0)-coalesce((select sum(amount_cents) from public.ap_credit_allocations where business_id=business and invoice_id=inv.id and reversed_at is null),0);
   if (item->>'amount_cents')::bigint>n then raise exception 'Planned amount exceeds invoice balance.'; end if;
   total:=total+(item->>'amount_cents')::bigint;
  end loop;
  if total>(payload->>'budget_cents')::bigint then raise exception 'Plan exceeds its budget.'; end if;
 end if;
 -- Converting an order now retains its lines and explicit stock mapping.
 if action='order.invoice' then
  perform public.ap_command_inventory_v2(business,request_id,action,payload);
  select * into ord from public.ap_orders where business_id=business and id=target;
  for item in select * from jsonb_array_elements(ord.lines) loop
   prod:=nullif(item->>'product_id','')::uuid;stock_qty:=0;
   if prod is not null then
    select * into p from public.ap_products where business_id=business and id=prod and active;
    stock_qty:=(item->>'stock_quantity')::numeric;
    if p.id is null or p.unit is distinct from item->>'stock_unit' then raise exception 'Mapped product changed. Import the supplier invoice and link it instead.'; end if;
   end if;
   insert into public.ap_invoice_lines(business_id,invoice_id,product_id,description,quantity,unit,unit_price,amount_cents,stock_quantity)
    values(business,ord.invoice_id,prod,item->>'product',(item->>'quantity')::numeric,item->>'unit',(item->>'unit_cents')::numeric/100,round((item->>'quantity')::numeric*(item->>'unit_cents')::numeric)::bigint,stock_qty);
  end loop;
  return public.ap_snapshot_v2(business);
 end if;
 if action not in ('stock.policy','stock.count','invoice.hold','order.link','order.batch') then
  return public.ap_command_inventory_v2(business,request_id,action,payload);
 end if;
 if not exists(select 1 from public.ap_backups where business_id=business and created_at>=date_trunc('day',now())) then
  insert into public.ap_backups(business_id,created_by,label,data) values(business,auth.uid(),'Automatic daily snapshot',public.ap_snapshot_v2(business)-'backups');
  delete from public.ap_backups where business_id=business and id not in(select id from public.ap_backups where business_id=business order by created_at desc limit 30);
 end if;
 reason:=btrim(payload->>'reason');
 if action='stock.policy' then
  if r<>'admin' then raise exception 'Administrator required.'; end if;
  select * into p from public.ap_products where business_id=business and id=target;
  if p.id is null or p.version is distinct from (payload->>'version')::int then raise exception 'Product changed. Refresh.'; end if;
  min_qty:=(payload->>'reorder_point')::numeric;target_qty:=(payload->>'target_stock')::numeric;
  if min_qty is null or target_qty is null or min_qty<0 or target_qty<min_qty or target_qty>1000000000 or min_qty<>round(min_qty,3) or target_qty<>round(target_qty,3) then raise exception 'Target must be at least the minimum; use nonnegative quantities with up to 3 decimals.'; end if;
  prior:=to_jsonb(p);update public.ap_products set reorder_point=min_qty,target_stock=target_qty,version=version+1 where business_id=business and id=target;
  select to_jsonb(x) into result from public.ap_products x where id=target;
 elsif action='stock.count' then
  if r<>'admin' then raise exception 'Administrator required for stock counts.'; end if;
  if payload->>'reviewed' is distinct from 'true' or reason is null or length(reason) not between 5 and 500 then raise exception 'Review quantities and enter a count reason.'; end if;
  if jsonb_typeof(payload->'lines') is distinct from 'array' or jsonb_array_length(payload->'lines') not between 1 and 1000 then raise exception 'Count 1 to 1000 products.'; end if;
  for item in select * from jsonb_array_elements(payload->'lines') loop
   select * into p from public.ap_products where business_id=business and id=(item->>'product_id')::uuid and active;
   if p.id is null or p.id=any(ids) or p.unit is distinct from item->>'unit' then raise exception 'Products must be active, unique and use their inventory unit.'; end if;ids:=array_append(ids,p.id);
   counted:=(item->>'counted')::numeric;expected:=(item->>'expected')::numeric;
   if counted is null or counted<0 or counted>1000000000 or counted<>round(counted,3) then raise exception 'Counted quantity must be nonnegative with up to 3 decimals.'; end if;
   select coalesce(sum(quantity),0) into actual from public.ap_inventory_moves where business_id=business and product_id=p.id;
   if expected is distinct from actual then raise exception 'Stock changed for %. Cancel this count and recount before posting.',p.name; end if;
   diff:=counted-actual;
   stored:=stored||jsonb_build_array(jsonb_build_object('product_id',p.id,'name',p.name,'unit',p.unit,'before',actual,'counted',counted,'difference',diff));
   if diff<>0 then insert into public.ap_inventory_moves(business_id,product_id,quantity,date,kind,reason,created_by) values(business,p.id,diff,day_today,'count','Physical count: '||reason,auth.uid()); end if;
  end loop;
  insert into public.ap_stock_counts(id,business_id,date,reason,lines,created_by) values(request_id,business,day_today,reason,stored,auth.uid());target:=request_id;result:=jsonb_build_object('lines',stored,'reason',reason);
 elsif action='invoice.hold' then
  select * into inv from public.ap_invoices where business_id=business and id=target;
  if inv.id is null or inv.status<>'Approved' or inv.version is distinct from (payload->>'version')::int then raise exception 'Invoice changed or is not approved. Refresh.'; end if;
  if (payload->>'hold') is null or reason is null or length(reason) not between 5 and 500 then raise exception 'A reason is required for hold or release.'; end if;
  prior:=to_jsonb(inv);update public.ap_invoices set payment_hold=(payload->>'hold')::boolean,hold_reason=reason,version=version+1 where business_id=business and id=target;
  select to_jsonb(x) into result from public.ap_invoices x where id=target;
 elsif action='order.link' then
  select * into ord from public.ap_orders where business_id=business and id=target;
  select * into inv from public.ap_invoices where business_id=business and id=(payload->>'invoice_id')::uuid;
  if ord.id is null or ord.status<>'Received' or ord.version is distinct from (payload->>'version')::int then raise exception 'Confirm delivery and refresh this order before matching.'; end if;
  if ord.invoice_id is not null and exists(select 1 from public.ap_invoices where id=ord.invoice_id and status<>'Void') then raise exception 'Order already has an invoice.'; end if;
  if inv.id is null or inv.status='Void' or inv.supplier_id<>ord.supplier_id or exists(select 1 from public.ap_orders where business_id=business and invoice_id=inv.id) then raise exception 'Choose an unlinked invoice from the same supplier.'; end if;
  if reason is null or length(reason) not between 5 and 500 then raise exception 'Document the matching review and any variance.'; end if;
  prior:=to_jsonb(ord);update public.ap_orders set invoice_id=inv.id,version=version+1 where business_id=business and id=target;
  result:=jsonb_build_object('invoice_id',inv.id,'subtotal_variance_cents',inv.subtotal_cents-ord.total_cents,'reason',reason);
 elsif action='order.batch' then
  if jsonb_typeof(payload->'orders') is distinct from 'array' or jsonb_array_length(payload->'orders') not between 1 and 100 then raise exception 'Create 1 to 100 orders per batch.'; end if;
  for item in select * from jsonb_array_elements(payload->'orders') loop
   child:=gen_random_uuid();perform public.ap_command_v2(business,child,'order.save',item-'id');stored:=stored||jsonb_build_array(child);
  end loop;target:=request_id;result:=jsonb_build_object('order_ids',stored);
 end if;
 insert into public.ap_requests(id,business_id,user_id,action,payload) values(request_id,business,auth.uid(),action,payload);
 insert into public.ap_audit(id,business_id,type,entity_id,actor,before,after) values(request_id,business,action,target::text,coalesce(auth.jwt()->>'email',auth.uid()::text),prior,result);
 update public.ap_settings set revision=revision+1 where business_id=business;
 return public.ap_snapshot_v2(business);
end $$;
revoke all on function ap_private.operations_command(uuid,uuid,text,jsonb) from public,anon;
grant execute on function ap_private.operations_command(uuid,uuid,text,jsonb) to authenticated;
create function public.ap_command_v2(business uuid,request_id uuid,action text,payload jsonb) returns jsonb language sql security invoker set search_path='' as $$ select ap_private.operations_command(business,request_id,action,payload) $$;
revoke all on function public.ap_command_v2(uuid,uuid,text,jsonb) from public,anon;
grant execute on function public.ap_command_v2(uuid,uuid,text,jsonb) to authenticated;

create or replace function public.ap_backup_restore(business uuid,backup uuid,request_id uuid) returns uuid language plpgsql security definer set search_path='' as $$
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
 for row_id in select distinct item->>'id' from jsonb_each(snapshot) j cross join lateral jsonb_array_elements(case when jsonb_typeof(j.value)='array' then j.value else '[]'::jsonb end) item where j.key in ('suppliers','invoices','payments','audit','categories','credits','credit_allocations','quotes','orders','plans','products','invoice_lines','recipes','kitchen_entries','stock_counts','inventory_moves') and item ? 'id' loop
  serialized:=replace(serialized,'"'||row_id||'"','"'||gen_random_uuid()::text||'"');
 end loop;
 serialized:=replace(serialized,'"'||business::text||'"','"'||request_id::text||'"');snapshot:=serialized::jsonb;
 business_name:=left((snapshot->'settings'->>'business_name')||' · Recovered '||to_char(now(),'YYYY-MM-DD HH24:MI'),250);
 insert into public.ap_businesses(id,name) values(request_id,business_name);
 insert into public.ap_business_members values(request_id,auth.uid(),'admin',true);
 insert into public.ap_settings(id,business_id,business_name,address,phone,email,terms_days,revision) values(1,request_id,business_name,coalesce(snapshot->'settings'->>'address',''),coalesce(snapshot->'settings'->>'phone',''),coalesce(snapshot->'settings'->>'email',''),(snapshot->'settings'->>'terms_days')::int,coalesce((snapshot->>'revision')::int,0));
 foreach target_table in array array['suppliers','invoices','payments','categories','credits','credit_allocations','quotes','orders','plans','products','invoice_lines','recipes','kitchen_entries','stock_counts','inventory_moves','audit'] loop
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
