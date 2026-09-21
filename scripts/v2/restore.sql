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
