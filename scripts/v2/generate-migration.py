from pathlib import Path
root=Path('.')
base=(root/'supabase/001_accounts_payable.sql').read_text()
head='''-- SINTECH 2: additive upgrade, preserving v1 data and a private rollback snapshot.
begin;
create schema if not exists sintech_private;
revoke all on schema sintech_private from public,anon,authenticated;
create table sintech_private.upgrade_backups(id uuid primary key default gen_random_uuid(), created_at timestamptz default now(), data jsonb not null);
insert into sintech_private.upgrade_backups(data) select jsonb_build_object('suppliers',(select jsonb_agg(s) from public.ap_suppliers s),'invoices',(select jsonb_agg(s) from public.ap_invoices s),'payments',(select jsonb_agg(s) from public.ap_payments s),'members',(select jsonb_agg(s) from public.ap_members s),'settings',(select jsonb_agg(s) from public.ap_settings s),'audit',(select jsonb_agg(s) from public.ap_audit s));
create table public.ap_businesses(id uuid primary key default gen_random_uuid(), name text not null check(length(btrim(name)) between 1 and 250), created_at timestamptz default now());
insert into public.ap_businesses(name) select business_name from public.ap_settings where id=1;
create table public.ap_business_members(business_id uuid references public.ap_businesses(id),user_id uuid references auth.users(id),role text not null check(role in ('admin','accountant','viewer')),active boolean not null default true,primary key(business_id,user_id));
insert into public.ap_business_members select b.id,m.user_id,m.role,m.active from public.ap_businesses b cross join public.ap_members m;
'''
for t in ['settings','suppliers','invoices','payments','audit','requests']:
 head+=f'alter table public.ap_{t} add column business_id uuid references public.ap_businesses(id);\nupdate public.ap_{t} set business_id=(select id from public.ap_businesses);\nalter table public.ap_{t} alter column business_id set not null;\ncreate index ap_{t}_business on public.ap_{t}(business_id);\n'
head+='''alter table public.ap_settings drop constraint ap_settings_pkey;
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
'''
head+='''create function public.ap_role_v2(business uuid) returns text language sql stable security definer set search_path='' as $$ select role from public.ap_business_members where business_id=business and user_id=auth.uid() and active $$;
revoke all on function public.ap_role_v2(uuid) from public,anon;
grant execute on function public.ap_role_v2(uuid) to authenticated;
create function public.ap_business_list() returns jsonb language sql stable security definer set search_path='' as $$ select coalesce(jsonb_agg(jsonb_build_object('id',b.id,'name',b.name,'role',m.role) order by b.created_at),'[]'::jsonb) from public.ap_businesses b join public.ap_business_members m on b.id=m.business_id where m.user_id=auth.uid() and m.active $$;
revoke all on function public.ap_business_list() from public,anon;
grant execute on function public.ap_business_list() to authenticated;
'''
for t in ['businesses','business_members','categories','credits','credit_allocations','quotes','orders','documents','plans','backups']:
 head+=f'alter table public.ap_{t} enable row level security;\nrevoke all on public.ap_{t} from anon,authenticated;\n'
for t in ['settings','suppliers','invoices','payments','audit']:
 head+=f'drop policy ap_{t}_read on public.ap_{t};\ncreate policy ap_{t}_read on public.ap_{t} for select to authenticated using(public.ap_role_v2(business_id) is not null);\n'
for t in ['categories','credits','credit_allocations','quotes','orders','documents','plans']:
 head+=f'grant select on public.ap_{t} to authenticated;\ncreate policy ap_{t}_read on public.ap_{t} for select to authenticated using(public.ap_role_v2(business_id) is not null);\ncreate index ap_{t}_business on public.ap_{t}(business_id);\n'
# Snapshot: all entity arrays are scoped, including audit and member identity.
snap="""create function public.ap_snapshot_v2(business uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if public.ap_role_v2(business) is null then raise exception 'No access to this business.'; end if;
 select jsonb_build_object('schema',2,'business_id',business,'revision',x.revision,'role',public.ap_role_v2(business),'settings',to_jsonb(x)-'id'-'revision'-'business_id','commands','[]'::jsonb,
"""
for t in ['suppliers','invoices','payments','audit','categories','credits','credit_allocations','quotes','orders','documents','plans']:
 snap+=f"'{t}',coalesce((select jsonb_agg(to_jsonb(s)) from public.ap_{t} s where s.business_id=business),'[]'::jsonb),\n"
snap+="""'members',case when public.ap_role_v2(business)='admin' then coalesce((select jsonb_agg(jsonb_build_object('user_id',m.user_id,'email',u.email,'role',m.role,'active',m.active)) from public.ap_business_members m join auth.users u on u.id=m.user_id where m.business_id=business),'[]'::jsonb) else '[]'::jsonb end,
'backups',case when public.ap_role_v2(business)='admin' then coalesce((select jsonb_agg(jsonb_build_object('id',z.id,'created_at',z.created_at,'label',z.label)) from (select * from public.ap_backups where business_id=business order by created_at desc limit 30) z),'[]'::jsonb) else '[]'::jsonb end)
 into result from public.ap_settings x where business_id=business;
 return result;
end $$;
revoke all on function public.ap_snapshot_v2(uuid) from public,anon;
grant execute on function public.ap_snapshot_v2(uuid) to authenticated;
"""
cmd=base[base.index('create function public.ap_command'):base.index('revoke all on function public.ap_command')]
cmd=cmd.replace('public.ap_command(request_id','public.ap_command_v2(business uuid, request_id').replace('public.ap_role()','public.ap_role_v2(business)').replace('public.ap_snapshot()','public.ap_snapshot_v2(business)')
# Every existing entity lookup and update has a tenant condition. Never rely on client filtering.
cmd=cmd.replace('where id=', 'where business_id=business and id=')
cmd=cmd.replace('where invoice_id=', 'where business_id=business and invoice_id=')
cmd=cmd.replace('where user_id=', 'where business_id=business and user_id=')
# inserts carry business_id explicitly
for t in ['suppliers','invoices','payments','audit','requests']:
 cmd=cmd.replace(f'insert into public.ap_{t}(id,',f'insert into public.ap_{t}(business_id,id,')
cmd=cmd.replace('values(target,','values(business,target,').replace('values(request_id,','values(business,request_id,')
# Prevent arbitrary cross-business primary-key upserts.
cmd=cmd.replace("actor_name:=", "if exists(select 1 from public.ap_requests where id=request_id and business_id<>business) then raise exception 'Request ID already used.'; end if;\n  actor_name:=")
# credits count toward settled amounts and cannot void invoice with allocated credits.
cmd=cmd.replace("total:=i.subtotal_cents", "paid:=paid+coalesce((select sum(amount_cents) from public.ap_credit_allocations where business_id=business and invoice_id=i.id and reversed_at is null),0);\n    total:=i.subtotal_cents")
cmd=cmd.replace("if i.status='Void' or exists", "if exists(select 1 from public.ap_credit_allocations where business_id=business and invoice_id=target and reversed_at is null) then raise exception 'Reverse allocated credits first.'; end if;\n      if i.status='Void' or exists")
# request backup before each first write of a UTC day. Retain latest 30; internal, cannot modify records through backup.
cmd=cmd.replace("actor_name:=", "if not exists(select 1 from public.ap_backups where business_id=business and created_at >= date_trunc('day',now())) then insert into public.ap_backups(business_id,created_by,label,data) values(business,auth.uid(),'Automatic daily snapshot',public.ap_snapshot_v2(business)-'backups'); delete from public.ap_backups where business_id=business and id not in (select id from public.ap_backups where business_id=business order by created_at desc limit 30); end if;\n  actor_name:=")
cmd=cmd.replace("actor_name text;", "actor_name text; item jsonb; cr public.ap_credits; alloc public.ap_credit_allocations; ord public.ap_orders; who uuid; quantity numeric; sum_total bigint:=0; batch_supplier uuid; child uuid; old_name text;")
# Category validation preserves retired category on unchanged supplier edit.
cmd=cmd.replace("n:=btrim(coalesce(payload->>'business_name',''));", "n:=btrim(coalesce(payload->>'business_name',''));",1)
cmd=cmd.replace("insert into public.ap_suppliers(business_id", "if not exists(select 1 from public.ap_categories where business_id=business and name=payload->>'category' and active) and (sp.id is null or sp.category is distinct from payload->>'category') then raise exception 'Choose an active category.'; end if;\n    insert into public.ap_suppliers(business_id",1)
guard=" or ".join(f"exists(select 1 from public.ap_{t} where id=target and business_id<>business)" for t in ['suppliers','invoices','payments','categories','credits','credit_allocations','quotes','orders','documents','plans'])
cmd=cmd.replace("  if action='supplier.save' then","  if "+guard+" then raise exception 'ID belongs to another business.'; end if;\n  if action='supplier.save' then")
(root/'scripts/v2/command-base.sql').write_text(cmd)
(root/'scripts/v2/schema.sql').write_text(head+snap)
