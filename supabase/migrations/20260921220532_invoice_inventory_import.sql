begin;
alter table public.ap_invoices add column inventory_received_at timestamptz;
create table public.ap_products(
 id uuid primary key default gen_random_uuid(), business_id uuid not null references public.ap_businesses(id),
 name text not null check(length(btrim(name)) between 1 and 250),sku text not null default '',unit text not null check(length(btrim(unit)) between 1 and 30),
 active boolean not null default true,version int not null default 1,unique(business_id,id));
create unique index ap_product_identity on public.ap_products(business_id,lower(name),lower(unit));
create unique index ap_product_sku on public.ap_products(business_id,lower(sku)) where sku<>'';
create table public.ap_invoice_lines(
 id uuid primary key default gen_random_uuid(),business_id uuid not null,invoice_id uuid not null,product_id uuid,
 description text not null check(length(btrim(description)) between 1 and 500),quantity numeric(16,3) not null check(quantity>0),unit text not null,
 unit_price numeric(16,4) not null check(unit_price>=0),amount_cents bigint not null check(amount_cents between 0 and 100000000000),
 stock_quantity numeric(16,3) not null check(stock_quantity>=0),
 foreign key(business_id,invoice_id) references public.ap_invoices(business_id,id),foreign key(business_id,product_id) references public.ap_products(business_id,id),
 check((product_id is null and stock_quantity=0) or (product_id is not null and stock_quantity>0)));
create index ap_invoice_lines_invoice on public.ap_invoice_lines(business_id,invoice_id);
create index ap_invoice_lines_product on public.ap_invoice_lines(business_id,product_id);
create table public.ap_inventory_moves(
 id uuid primary key default gen_random_uuid(),business_id uuid not null,product_id uuid not null,invoice_id uuid,
 quantity numeric(16,3) not null check(quantity<>0),date date not null,kind text not null check(kind in ('receipt','void','adjustment')),
 reason text not null,created_at timestamptz not null default now(),created_by uuid references auth.users(id),
 foreign key(business_id,product_id) references public.ap_products(business_id,id),foreign key(business_id,invoice_id) references public.ap_invoices(business_id,id));
create index ap_inventory_moves_product on public.ap_inventory_moves(business_id,product_id);
create index ap_inventory_moves_invoice on public.ap_inventory_moves(business_id,invoice_id);
create table public.ap_invoice_imports(
 id uuid primary key,business_id uuid not null,invoice_id uuid not null,file_hash text not null check(file_hash~'^[a-f0-9]{64}$'),path text not null,
 created_at timestamptz not null default now(),unique(business_id,file_hash),unique(business_id,path),
 foreign key(business_id,invoice_id) references public.ap_invoices(business_id,id));
create index ap_invoice_imports_invoice on public.ap_invoice_imports(business_id,invoice_id);
alter table public.ap_products enable row level security;
alter table public.ap_invoice_lines enable row level security;
alter table public.ap_inventory_moves enable row level security;
alter table public.ap_invoice_imports enable row level security;
revoke all on public.ap_products,public.ap_invoice_lines,public.ap_inventory_moves,public.ap_invoice_imports from public,anon,authenticated;
grant select on public.ap_products,public.ap_invoice_lines,public.ap_inventory_moves,public.ap_invoice_imports to authenticated;
create policy ap_products_read on public.ap_products for select to authenticated using(public.ap_role_v2(business_id) is not null);
create policy ap_invoice_lines_read on public.ap_invoice_lines for select to authenticated using(public.ap_role_v2(business_id) is not null);
create policy ap_inventory_moves_read on public.ap_inventory_moves for select to authenticated using(public.ap_role_v2(business_id) is not null);
create policy ap_invoice_imports_read on public.ap_invoice_imports for select to authenticated using(public.ap_role_v2(business_id) is not null);
alter function public.ap_snapshot_v2(uuid) rename to ap_snapshot_base_v2;
revoke all on function public.ap_snapshot_base_v2(uuid) from public,anon,authenticated;
create function public.ap_snapshot_v2(business uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if public.ap_role_v2(business) is null then raise exception 'No access to this business.'; end if;
 return public.ap_snapshot_base_v2(business)||jsonb_build_object(
 'products',coalesce((select jsonb_agg(to_jsonb(p)) from public.ap_products p where business_id=business),'[]'::jsonb),
 'invoice_lines',coalesce((select jsonb_agg(to_jsonb(p)) from public.ap_invoice_lines p where business_id=business),'[]'::jsonb),
 'inventory_moves',coalesce((select jsonb_agg(to_jsonb(p)) from public.ap_inventory_moves p where business_id=business),'[]'::jsonb),
 'invoice_imports',coalesce((select jsonb_agg(to_jsonb(p)) from public.ap_invoice_imports p where business_id=business),'[]'::jsonb));
end $$;
revoke all on function public.ap_snapshot_v2(uuid) from public,anon;
grant execute on function public.ap_snapshot_v2(uuid) to authenticated;
-- Keep the existing AP implementation private. Its internal snapshot calls use the extended snapshot above.
alter function public.ap_command_v2(uuid,uuid,text,jsonb) rename to ap_command_base_v2;
revoke all on function public.ap_command_base_v2(uuid,uuid,text,jsonb) from public,anon,authenticated;
create function public.ap_command_v2(business uuid,request_id uuid,action text,payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 r text; old_request public.ap_requests; target uuid; supplier uuid; product uuid; invoice uuid; document uuid;
 p public.ap_products; i public.ap_invoices; d public.ap_documents; row_data jsonb; prior jsonb; result jsonb;
 qty numeric; stock_qty numeric; price numeric; amount bigint; subtotal bigint:=0; total bigint; sum_stock numeric;
 child uuid; file_path text; v_hash text; v_name text; v_unit text;
begin
 r:=public.ap_role_v2(business);
 if r is null or r='viewer' then raise exception 'Your account does not have write access.'; end if;
 if request_id is null or payload is null then raise exception 'Invalid request.'; end if;
 perform 1 from public.ap_settings where business_id=business for update;
 select * into old_request from public.ap_requests where id=request_id;
 if found then
  if old_request.business_id=business and old_request.user_id=auth.uid() and old_request.action=action and old_request.payload=payload then return public.ap_snapshot_v2(business); end if;
  raise exception 'Request ID already used.';
 end if;
 if action not in ('invoice.import','inventory.receive','inventory.adjust','product.save','invoice.void') then
  return public.ap_command_base_v2(business,request_id,action,payload);
 end if;
 if not exists(select 1 from public.ap_backups where business_id=business and created_at>=date_trunc('day',now())) then
  insert into public.ap_backups(business_id,created_by,label,data) values(business,auth.uid(),'Automatic daily snapshot',public.ap_snapshot_v2(business)-'backups');
  delete from public.ap_backups where business_id=business and id not in(select id from public.ap_backups where business_id=business order by created_at desc limit 30);
 end if;
 target:=coalesce(nullif(payload->>'id','')::uuid,request_id);
 if action='invoice.void' then
  select * into i from public.ap_invoices where business_id=business and id=target;
  if i.inventory_received_at is not null then
   for row_data in select jsonb_build_object('product_id',product_id,'quantity',sum(quantity)) from public.ap_inventory_moves where business_id=business and invoice_id=target and kind='receipt' group by product_id loop
    select coalesce(sum(quantity),0) into sum_stock from public.ap_inventory_moves where business_id=business and product_id=(row_data->>'product_id')::uuid;
    if sum_stock<(row_data->>'quantity')::numeric then raise exception 'Cannot void: received stock has already been used. Correct inventory with an audited adjustment first.'; end if;
   end loop;
  end if;
  perform public.ap_command_base_v2(business,request_id,action,payload);
  if i.inventory_received_at is not null then
   insert into public.ap_inventory_moves(business_id,product_id,invoice_id,quantity,date,kind,reason,created_by)
    select business,product_id,target,-sum(quantity),(now() at time zone 'America/New_York')::date,'void',payload->>'reason',auth.uid() from public.ap_inventory_moves where business_id=business and invoice_id=target and kind='receipt' group by product_id;
  end if;
  return public.ap_snapshot_v2(business);
 elsif action='product.save' then
  if r<>'admin' then raise exception 'Administrator required.'; end if;
  select * into p from public.ap_products where id=target;
  if p.id is not null and p.business_id<>business then raise exception 'Product not found.'; end if;
  if (payload ? 'id' and p.id is null) or (p.id is not null and p.version is distinct from (payload->>'version')::int) then raise exception 'Product changed. Refresh.'; end if;
  v_name:=btrim(payload->>'name');v_unit:=lower(btrim(payload->>'unit'));
  if p.id is not null and p.unit<>v_unit and exists(select 1 from public.ap_invoice_lines where product_id=target) then raise exception 'Unit cannot change after invoicing. Create a separate product.'; end if;
  if p.id is not null and p.unit<>v_unit and exists(select 1 from public.ap_inventory_moves where product_id=target) then raise exception 'Unit cannot change after stock movements.'; end if;
  prior:=case when p.id is null then null else to_jsonb(p) end;
  insert into public.ap_products(id,business_id,name,sku,unit,active) values(target,business,v_name,btrim(coalesce(payload->>'sku','')),v_unit,coalesce((payload->>'active')::boolean,true))
   on conflict(id) do update set name=excluded.name,sku=excluded.sku,unit=excluded.unit,active=excluded.active,version=ap_products.version+1;
  select to_jsonb(x) into result from public.ap_products x where id=target;
 elsif action='inventory.adjust' then
  if r<>'admin' or length(btrim(coalesce(payload->>'reason','')))<5 then raise exception 'Administrator and a reason required.'; end if;
  product:=(payload->>'product_id')::uuid;qty:=(payload->>'quantity')::numeric;
  if not exists(select 1 from public.ap_products where business_id=business and id=product and active) or qty is null or qty=0 or abs(qty)>1000000000 or qty<>round(qty,3) then raise exception 'Choose an active product and a quantity with up to 3 decimals.'; end if;
  select coalesce(sum(quantity),0) into sum_stock from public.ap_inventory_moves where business_id=business and product_id=product;
  if sum_stock+qty<0 then raise exception 'Adjustment would make stock negative.'; end if;
  if (payload->>'date') is null or (payload->>'date')::date>(now() at time zone 'America/New_York')::date then raise exception 'Valid movement date required.'; end if;
  insert into public.ap_inventory_moves(id,business_id,product_id,quantity,date,kind,reason,created_by) values(request_id,business,product,qty,(payload->>'date')::date,'adjustment',payload->>'reason',auth.uid());
  result:=payload;target:=product;
 elsif action='invoice.import' then
  if payload->>'reviewed' is distinct from 'true' then raise exception 'Review and confirm the extracted invoice first.'; end if;
  v_hash:=payload->>'file_hash';file_path:=payload->>'path';
  if v_hash is null or v_hash!~'^[a-f0-9]{64}$' then raise exception 'Invalid file fingerprint.'; end if;
  if exists(select 1 from public.ap_invoice_imports where business_id=business and (ap_invoice_imports.file_hash=v_hash or path=file_path)) then raise exception 'This file was already imported. Open its existing invoice instead.'; end if;
  if not exists(select 1 from storage.objects where bucket_id='sintech-documents' and name=file_path and split_part(name,'/',1)=business::text) then raise exception 'Upload the original invoice to this business first.'; end if;
  select * into d from public.ap_documents where path=file_path;
  if d.id is not null and d.business_id<>business then raise exception 'Document belongs to another business.'; end if;
  if d.archived_at is not null then raise exception 'Archived documents cannot be imported.'; end if;
  supplier:=nullif(payload->>'supplier_id','')::uuid;
  if supplier is null then
   supplier:=gen_random_uuid();
   perform public.ap_command_v2(business,supplier,'supplier.save',(payload->'new_supplier')||jsonb_build_object('status','Active'));
  end if;
  if not exists(select 1 from public.ap_suppliers where id=supplier and business_id=business and status='Active') then raise exception 'Choose an active supplier.'; end if;
  if jsonb_typeof(payload->'lines') is distinct from 'array' or jsonb_array_length(payload->'lines') not between 1 and 300 then raise exception 'Review 1 to 300 invoice lines.'; end if;
  invoice:=request_id;
  for row_data in select * from jsonb_array_elements(payload->'lines') loop
   qty:=(row_data->>'quantity')::numeric;price:=(row_data->>'unit_price')::numeric;amount:=(row_data->>'amount_cents')::bigint;
   if qty is null or qty<=0 or qty>1000000000 or qty<>round(qty,3) or price is null or price<0 or price>1000000000 or price<>round(price,4) or amount is null or amount<0 or amount>100000000000 then raise exception 'Invalid quantity, price or line amount.'; end if;
   subtotal:=subtotal+amount;
  end loop;
  if subtotal is distinct from (payload->>'subtotal_cents')::bigint then raise exception 'Product line amounts must equal the invoice subtotal.'; end if;
  total:=subtotal+(payload->>'tax_cents')::bigint+(payload->>'shipping_cents')::bigint-(payload->>'discount_cents')::bigint;
  if total is null or total<=0 or total is distinct from (payload->>'total_cents')::bigint then raise exception 'Invoice total does not reconcile.'; end if;
  if (payload->>'issue_date') is null or (payload->>'issue_date')::date>(now() at time zone 'America/New_York')::date then raise exception 'Valid invoice date required.'; end if;
  -- Child commands share this transaction; no debt survives an invalid inventory line.
  child:=gen_random_uuid();invoice:=child;
  perform public.ap_command_v2(business,child,'invoice.save',payload||jsonb_build_object('supplier_id',supplier,'description','Imported invoice · reviewed before posting'));
  for row_data in select * from jsonb_array_elements(payload->'lines') loop
   product:=null;stock_qty:=0;
   if coalesce((row_data->>'track_stock')::boolean,false) then
    product:=nullif(row_data->>'product_id','')::uuid;stock_qty:=(row_data->>'stock_quantity')::numeric;
    if stock_qty is null or stock_qty<=0 or stock_qty>1000000000 or stock_qty<>round(stock_qty,3) then raise exception 'Stock quantity must be positive with up to 3 decimals.'; end if;
    if product is null then
     v_name:=btrim(row_data->>'product_name');v_unit:=lower(btrim(row_data->>'stock_unit'));
     -- An identical product is reused, including repeated lines in this import.
     select id into product from public.ap_products where business_id=business and lower(ap_products.name)=lower(v_name) and lower(ap_products.unit)=lower(v_unit) and active;
     if product is null then
      product:=gen_random_uuid();insert into public.ap_products(id,business_id,name,unit,sku) values(product,business,v_name,v_unit,btrim(coalesce(row_data->>'sku','')));
     end if;
    end if;
    if not exists(select 1 from public.ap_products where business_id=business and id=product and active and lower(ap_products.unit)=lower(btrim(row_data->>'stock_unit'))) then raise exception 'Product unit does not match. Review stock quantity and unit.'; end if;
   end if;
   insert into public.ap_invoice_lines(business_id,invoice_id,product_id,description,quantity,unit,unit_price,amount_cents,stock_quantity)
    values(business,invoice,product,btrim(row_data->>'description'),(row_data->>'quantity')::numeric,coalesce(row_data->>'unit',''),(row_data->>'unit_price')::numeric,(row_data->>'amount_cents')::bigint,stock_qty);
  end loop;
  perform public.ap_command_v2(business,gen_random_uuid(),'invoice.approve',jsonb_build_object('id',invoice,'version',1));
  if coalesce((payload->>'received')::boolean,false) then
   perform public.ap_command_v2(business,gen_random_uuid(),'inventory.receive',jsonb_build_object('id',invoice,'date',payload->>'received_date'));
  end if;
  if d.id is null then
   document:=gen_random_uuid();perform public.ap_command_v2(business,document,'document.add',jsonb_build_object('entity_type','invoice','entity_id',invoice,'path',file_path,'name',payload->>'file_name','mime',payload->>'mime','size',payload->>'size'));
  else
   document:=d.id;prior:=to_jsonb(d);update public.ap_documents set entity_type='invoice',entity_id=invoice where id=document;
  end if;
  insert into public.ap_invoice_imports(id,business_id,invoice_id,file_hash,path) values(request_id,business,invoice,v_hash,file_path);
  target:=invoice;result:=jsonb_build_object('invoice_id',invoice,'document_id',document,'total_cents',total,'received',payload->'received','line_count',jsonb_array_length(payload->'lines'));
 elsif action='inventory.receive' then
  select * into i from public.ap_invoices where business_id=business and id=target;
  if i.id is null or i.status<>'Approved' or i.inventory_received_at is not null then raise exception 'Invoice must be approved and not already received.'; end if;
  if not exists(select 1 from public.ap_invoice_lines where business_id=business and invoice_id=target) then raise exception 'No reviewed product lines on this invoice.'; end if;
  if (payload->>'date') is null or (payload->>'date')::date<i.issue_date or (payload->>'date')::date>(now() at time zone 'America/New_York')::date then raise exception 'Receipt date must be between invoice date and today.'; end if;
  insert into public.ap_inventory_moves(business_id,product_id,invoice_id,quantity,date,kind,reason,created_by)
   select business,product_id,target,sum(stock_quantity),(payload->>'date')::date,'receipt','Invoice '||i.number,auth.uid() from public.ap_invoice_lines where business_id=business and invoice_id=target and product_id is not null group by product_id;
  update public.ap_invoices set inventory_received_at=now(),version=version+1 where id=target;
  result:=jsonb_build_object('invoice_id',target,'date',payload->>'date');
 end if;
 insert into public.ap_requests(id,business_id,user_id,action,payload) values(request_id,business,auth.uid(),action,payload);
 insert into public.ap_audit(id,business_id,type,entity_id,actor,before,after) values(request_id,business,action,target::text,coalesce(auth.jwt()->>'email',auth.uid()::text),prior,result);
 update public.ap_settings set revision=revision+1 where business_id=business;
 return public.ap_snapshot_v2(business);
end $$;
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
 for row_id in select distinct item->>'id' from jsonb_each(snapshot) j cross join lateral jsonb_array_elements(case when jsonb_typeof(j.value)='array' then j.value else '[]'::jsonb end) item where j.key in ('suppliers','invoices','payments','audit','categories','credits','credit_allocations','quotes','orders','plans','products','invoice_lines','inventory_moves') and item ? 'id' loop
  serialized:=replace(serialized,'"'||row_id||'"','"'||gen_random_uuid()::text||'"');
 end loop;
 serialized:=replace(serialized,'"'||business::text||'"','"'||request_id::text||'"');snapshot:=serialized::jsonb;
 business_name:=left((snapshot->'settings'->>'business_name')||' · Recovered '||to_char(now(),'YYYY-MM-DD HH24:MI'),250);
 insert into public.ap_businesses(id,name) values(request_id,business_name);
 insert into public.ap_business_members values(request_id,auth.uid(),'admin',true);
 insert into public.ap_settings(id,business_id,business_name,address,phone,email,terms_days,revision) values(1,request_id,business_name,coalesce(snapshot->'settings'->>'address',''),coalesce(snapshot->'settings'->>'phone',''),coalesce(snapshot->'settings'->>'email',''),(snapshot->'settings'->>'terms_days')::int,coalesce((snapshot->>'revision')::int,0));
 foreach target_table in array array['suppliers','invoices','payments','categories','credits','credit_allocations','quotes','orders','plans','products','invoice_lines','inventory_moves','audit'] loop
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
