begin;
create table public.ap_recipes (
 id uuid primary key default gen_random_uuid(),business_id uuid not null references public.ap_businesses(id),
 name text not null check(length(btrim(name)) between 1 and 200),yield_portions numeric(12,3) not null check(yield_portions>0 and yield_portions<=100000),
 selling_price_cents bigint not null check(selling_price_cents between 0 and 10000000),target_food_percent numeric(5,2) not null check(target_food_percent between 1 and 100),
 ingredients jsonb not null check(jsonb_typeof(ingredients)='array' and jsonb_array_length(ingredients) between 1 and 100),
 notes text not null default '' check(length(notes)<=4000),active boolean not null default true,version integer not null default 1,
 created_at timestamptz not null default now(),unique(business_id,id));
create unique index ap_recipe_name on public.ap_recipes(business_id,lower(name));
create table public.ap_kitchen_entries (
 id uuid primary key,business_id uuid not null references public.ap_businesses(id),kind text not null check(kind in ('production','waste')),
 recipe_id uuid,recipe_version integer,label text not null,quantity numeric(12,3) not null check(quantity>0 and quantity<=100000),unit text not null,
 date date not null,reason text not null check(length(btrim(reason)) between 5 and 500),lines jsonb not null,
 cost_cents bigint check(cost_cents>=0),created_at timestamptz not null default now(),created_by uuid not null references auth.users(id),
 reversed_at timestamptz,reversed_by uuid references auth.users(id),reversal_reason text,
 unique(business_id,id),foreign key(business_id,recipe_id) references public.ap_recipes(business_id,id));
create index ap_kitchen_entries_date on public.ap_kitchen_entries(business_id,date);
create index ap_kitchen_entries_recipe on public.ap_kitchen_entries(business_id,recipe_id);
alter table public.ap_inventory_moves drop constraint ap_inventory_moves_kind_check;
alter table public.ap_inventory_moves add constraint ap_inventory_moves_kind_check check(kind in ('receipt','void','adjustment','production','waste','kitchen_reversal'));
alter table public.ap_inventory_moves add column kitchen_entry_id uuid;
alter table public.ap_inventory_moves add constraint ap_move_kitchen_entry_fk foreign key(business_id,kitchen_entry_id) references public.ap_kitchen_entries(business_id,id);
create index ap_inventory_moves_kitchen on public.ap_inventory_moves(business_id,kitchen_entry_id) where kitchen_entry_id is not null;
alter table public.ap_recipes enable row level security;
alter table public.ap_kitchen_entries enable row level security;
revoke all on public.ap_recipes,public.ap_kitchen_entries from public,anon,authenticated;
grant select on public.ap_recipes,public.ap_kitchen_entries to authenticated;
create policy ap_recipes_read on public.ap_recipes for select to authenticated using(public.ap_role_v2(business_id) is not null);
create policy ap_kitchen_entries_read on public.ap_kitchen_entries for select to authenticated using(public.ap_role_v2(business_id) is not null);

-- Private implementation; public endpoints below are invokers with explicit grants.
create schema if not exists ap_private;
revoke all on schema ap_private from public,anon;
grant usage on schema ap_private to authenticated;
alter function public.ap_snapshot_v2(uuid) rename to ap_snapshot_inventory_v2;
revoke all on function public.ap_snapshot_inventory_v2(uuid) from public,anon,authenticated;
create function ap_private.kitchen_snapshot(business uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or public.ap_role_v2(business) is null then raise exception 'No access to this business.'; end if;
 return public.ap_snapshot_inventory_v2(business)||jsonb_build_object(
 'recipes',coalesce((select jsonb_agg(to_jsonb(r)) from public.ap_recipes r where business_id=business),'[]'::jsonb),
 'kitchen_entries',coalesce((select jsonb_agg(to_jsonb(k)) from public.ap_kitchen_entries k where business_id=business),'[]'::jsonb));
end $$;
revoke all on function ap_private.kitchen_snapshot(uuid) from public,anon;
grant execute on function ap_private.kitchen_snapshot(uuid) to authenticated;
create function public.ap_snapshot_v2(business uuid) returns jsonb language sql security invoker set search_path='' as $$ select ap_private.kitchen_snapshot(business) $$;
revoke all on function public.ap_snapshot_v2(uuid) from public,anon;
grant execute on function public.ap_snapshot_v2(uuid) to authenticated;

create function ap_private.recipe_unit_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.unit is distinct from old.unit and exists(select 1 from public.ap_recipes r cross join lateral jsonb_array_elements(r.ingredients) l where r.business_id=old.business_id and l->>'product_id'=old.id::text) then
  raise exception 'Unit cannot change while a recipe uses this product. Create a separate product.';
 end if;
 return new;
end $$;
revoke all on function ap_private.recipe_unit_guard() from public,anon,authenticated;
create trigger ap_product_recipe_unit before update of unit on public.ap_products for each row execute function ap_private.recipe_unit_guard();

create function ap_private.kitchen_command(business uuid,request_id uuid,action text,payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 r text; old_request public.ap_requests; rec public.ap_recipes; entry public.ap_kitchen_entries; product public.ap_products;
 target uuid; item jsonb; items jsonb; stored jsonb:='[]'::jsonb; prior jsonb; result jsonb; ids uuid[]:=array[]::uuid[];
 n numeric; portion_count numeric; needed numeric; available numeric; unit_cost numeric; line_cost bigint; total bigint:=0;
 missing boolean:=false; label text; v_reason text; v_kind text; v_date date:=(now() at time zone 'America/New_York')::date;
 cost_source text; cost_date date;
begin
 r:=public.ap_role_v2(business);
 if auth.uid() is null or r is null or r='viewer' then raise exception 'Your account does not have write access.'; end if;
 if request_id is null or payload is null then raise exception 'Invalid request.'; end if;
 -- Same business lock as invoices/adjustments, so stock checks and deductions are atomic.
 perform 1 from public.ap_settings where business_id=business for update;
 select * into old_request from public.ap_requests where id=request_id;
 if found then
  if old_request.business_id=business and old_request.user_id=auth.uid() and old_request.action=action and old_request.payload=payload then return public.ap_snapshot_v2(business); end if;
  raise exception 'Request ID already used.';
 end if;
 if action not in ('recipe.save','kitchen.post','kitchen.reverse') then raise exception 'Unknown kitchen action.'; end if;
 if not exists(select 1 from public.ap_backups where business_id=business and created_at>=date_trunc('day',now())) then
  insert into public.ap_backups(business_id,created_by,label,data) values(business,auth.uid(),'Automatic daily snapshot',public.ap_snapshot_v2(business)-'backups');
  delete from public.ap_backups where business_id=business and id not in(select id from public.ap_backups where business_id=business order by created_at desc limit 30);
 end if;
 target:=coalesce(nullif(payload->>'id','')::uuid,request_id);
 if action='recipe.save' then
  select * into rec from public.ap_recipes where id=target;
  if rec.id is not null and rec.business_id<>business then raise exception 'Recipe not found.'; end if;
  if (payload ? 'id' and rec.id is null) or (rec.id is not null and rec.version is distinct from (payload->>'version')::integer) then raise exception 'Recipe changed. Refresh and reopen it.'; end if;
  items:=payload->'ingredients';
  if items is null or jsonb_typeof(items)<>'array' or jsonb_array_length(items) not between 1 and 100 then raise exception 'Add between 1 and 100 ingredients.'; end if;
  portion_count:=(payload->>'yield_portions')::numeric;
  if portion_count is null or portion_count<=0 or portion_count>100000 or portion_count<>round(portion_count,3) then raise exception 'Enter a valid yield with up to 3 decimals.'; end if;
  for item in select * from jsonb_array_elements(items) loop
   select * into product from public.ap_products where business_id=business and id=(item->>'product_id')::uuid;
   if product.id is null or not product.active or product.unit is distinct from item->>'unit' then raise exception 'Choose active ingredients with matching inventory units.'; end if;
   if product.id=any(ids) then raise exception 'Ingredient is repeated. Combine its quantities.'; end if;ids:=array_append(ids,product.id);
   n:=(item->>'quantity')::numeric;
   if n is null or n<=0 or n>1000000 or n<>round(n,3) then raise exception 'Ingredient quantities must be positive with up to 3 decimals.'; end if;
   stored:=stored||jsonb_build_array(jsonb_build_object('product_id',product.id,'quantity',n,'unit',product.unit));
  end loop;
  prior:=case when rec.id is null then null else to_jsonb(rec) end;
  insert into public.ap_recipes(id,business_id,name,yield_portions,selling_price_cents,target_food_percent,ingredients,notes,active)
   values(target,business,btrim(payload->>'name'),portion_count,(payload->>'selling_price_cents')::bigint,(payload->>'target_food_percent')::numeric,stored,coalesce(payload->>'notes',''),coalesce((payload->>'active')::boolean,true))
   on conflict(id) do update set name=excluded.name,yield_portions=excluded.yield_portions,selling_price_cents=excluded.selling_price_cents,target_food_percent=excluded.target_food_percent,ingredients=excluded.ingredients,notes=excluded.notes,active=excluded.active,version=ap_recipes.version+1;
  select to_jsonb(x) into result from public.ap_recipes x where id=target;
 elsif action='kitchen.post' then
  if (payload->>'reviewed')::boolean is distinct from true then raise exception 'Review the quantities before posting.'; end if;
  v_kind:=payload->>'kind';v_reason:=btrim(payload->>'reason');
  if v_reason is null or length(v_reason) not between 5 and 500 then raise exception 'A reason of 5 to 500 characters is required.'; end if;
  portion_count:=(payload->>'quantity')::numeric;
  if portion_count is null or portion_count<=0 or portion_count>100000 or portion_count<>round(portion_count,3) then raise exception 'Enter a positive quantity with up to 3 decimals.'; end if;
  if v_kind='production' then
   select * into rec from public.ap_recipes where business_id=business and id=(payload->>'recipe_id')::uuid and active;
   if rec.id is null or rec.version is distinct from (payload->>'recipe_version')::integer then raise exception 'Recipe changed or inactive. Refresh before posting.'; end if;
   label:=rec.name;items:=rec.ingredients;
  elsif v_kind='waste' then
   select * into product from public.ap_products where business_id=business and id=(payload->>'product_id')::uuid and active;
   if product.id is null then raise exception 'Choose an active product.'; end if;
   label:=product.name;
   items:=jsonb_build_array(jsonb_build_object('product_id',product.id,'quantity',portion_count,'unit',product.unit));
  else raise exception 'Choose preparation or waste.';
  end if;
  for item in select * from jsonb_array_elements(items) loop
   select * into product from public.ap_products where business_id=business and id=(item->>'product_id')::uuid and active;
   if product.id is null or product.unit is distinct from item->>'unit' then raise exception 'Ingredient no longer active or its unit changed.'; end if;
   -- Round up to inventory precision so a small preparation never consumes zero.
   needed:=case when v_kind='production' then ceil((item->>'quantity')::numeric*portion_count/rec.yield_portions*1000)/1000 else (item->>'quantity')::numeric end;
   if needed<=0 or needed>1000000000 then raise exception 'Ingredient quantity out of range.'; end if;
   select coalesce(sum(quantity),0) into available from public.ap_inventory_moves where business_id=business and product_id=product.id;
   if available<needed then raise exception 'Insufficient stock for %: available %, required % %.',product.name,available,needed,product.unit; end if;
   select sum(l.amount_cents)::numeric/sum(l.stock_quantity),i.number,i.issue_date into unit_cost,cost_source,cost_date
    from public.ap_invoice_lines l join public.ap_invoices i on i.business_id=l.business_id and i.id=l.invoice_id
    where l.business_id=business and l.product_id=product.id and l.stock_quantity>0 and i.status='Approved'
    group by i.id,i.number,i.issue_date order by i.issue_date desc,i.id desc limit 1;
   line_cost:=round(unit_cost*needed)::bigint;
   if line_cost is null then missing:=true; else total:=total+line_cost; end if;
   stored:=stored||jsonb_build_array(jsonb_build_object('product_id',product.id,'name',product.name,'quantity',needed,'unit',product.unit,'cost_cents',line_cost,'invoice_number',cost_source,'cost_date',cost_date));
  end loop;
  insert into public.ap_kitchen_entries(id,business_id,kind,recipe_id,recipe_version,label,quantity,unit,date,reason,lines,cost_cents,created_by)
   values(target,business,v_kind,rec.id,rec.version,label,portion_count,case when v_kind='production' then 'portions' else product.unit end,v_date,v_reason,stored,case when missing then null else total end,auth.uid());
  for item in select * from jsonb_array_elements(stored) loop
   insert into public.ap_inventory_moves(business_id,product_id,quantity,date,kind,reason,created_by,kitchen_entry_id)
    values(business,(item->>'product_id')::uuid,-(item->>'quantity')::numeric,v_date,v_kind,v_reason,auth.uid(),target);
  end loop;
  select to_jsonb(x) into result from public.ap_kitchen_entries x where id=target;
 elsif action='kitchen.reverse' then
  if r<>'admin' then raise exception 'Administrator required for corrections.'; end if;
  select * into entry from public.ap_kitchen_entries where business_id=business and id=target;
  if entry.id is null or entry.reversed_at is not null then raise exception 'Entry not found or already reversed.'; end if;
  v_reason:=btrim(payload->>'reason');
  if v_reason is null or length(v_reason) not between 5 and 500 then raise exception 'A correction reason of 5 to 500 characters is required.'; end if;
  prior:=to_jsonb(entry);
  insert into public.ap_inventory_moves(business_id,product_id,quantity,date,kind,reason,created_by,kitchen_entry_id)
   select business,product_id,-quantity,v_date,'kitchen_reversal',v_reason,auth.uid(),target from public.ap_inventory_moves where business_id=business and kitchen_entry_id=target and kind in ('production','waste');
  update public.ap_kitchen_entries set reversed_at=now(),reversed_by=auth.uid(),reversal_reason=v_reason where id=target;
  select to_jsonb(x) into result from public.ap_kitchen_entries x where id=target;
 end if;
 insert into public.ap_requests(id,business_id,user_id,action,payload) values(request_id,business,auth.uid(),action,payload);
 insert into public.ap_audit(id,business_id,type,entity_id,actor,before,after) values(request_id,business,action,target::text,coalesce(auth.jwt()->>'email',auth.uid()::text),prior,result);
 update public.ap_settings set revision=revision+1 where business_id=business;
 return public.ap_snapshot_v2(business);
end $$;
revoke all on function ap_private.kitchen_command(uuid,uuid,text,jsonb) from public,anon;
grant execute on function ap_private.kitchen_command(uuid,uuid,text,jsonb) to authenticated;
create function public.ap_kitchen_command(business uuid,request_id uuid,action text,payload jsonb) returns jsonb language sql security invoker set search_path='' as $$ select ap_private.kitchen_command(business,request_id,action,payload) $$;
revoke all on function public.ap_kitchen_command(uuid,uuid,text,jsonb) from public,anon;
grant execute on function public.ap_kitchen_command(uuid,uuid,text,jsonb) to authenticated;

-- Include recipes and immutable kitchen history in snapshot recovery.
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
 for row_id in select distinct item->>'id' from jsonb_each(snapshot) j cross join lateral jsonb_array_elements(case when jsonb_typeof(j.value)='array' then j.value else '[]'::jsonb end) item where j.key in ('suppliers','invoices','payments','audit','categories','credits','credit_allocations','quotes','orders','plans','products','invoice_lines','recipes','kitchen_entries','inventory_moves') and item ? 'id' loop
  serialized:=replace(serialized,'"'||row_id||'"','"'||gen_random_uuid()::text||'"');
 end loop;
 serialized:=replace(serialized,'"'||business::text||'"','"'||request_id::text||'"');snapshot:=serialized::jsonb;
 business_name:=left((snapshot->'settings'->>'business_name')||' · Recovered '||to_char(now(),'YYYY-MM-DD HH24:MI'),250);
 insert into public.ap_businesses(id,name) values(request_id,business_name);
 insert into public.ap_business_members values(request_id,auth.uid(),'admin',true);
 insert into public.ap_settings(id,business_id,business_name,address,phone,email,terms_days,revision) values(1,request_id,business_name,coalesce(snapshot->'settings'->>'address',''),coalesce(snapshot->'settings'->>'phone',''),coalesce(snapshot->'settings'->>'email',''),(snapshot->'settings'->>'terms_days')::int,coalesce((snapshot->>'revision')::int,0));
 foreach target_table in array array['suppliers','invoices','payments','categories','credits','credit_allocations','quotes','orders','plans','products','invoice_lines','recipes','kitchen_entries','inventory_moves','audit'] loop
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
