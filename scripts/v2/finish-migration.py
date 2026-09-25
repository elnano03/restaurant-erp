from pathlib import Path
p=Path('scripts/v2'); cmd=(p/'command-base.sql').read_text()
cmd=cmd.replace("  else raise exception 'Unknown operation.';",(p/'commands-extra.sql').read_text()+"  else raise exception 'Unknown operation.';")
cmd=cmd.replace("update public.ap_settings set business_name=left(n,250)","update public.ap_businesses set name=left(n,250) where id=business;\n    update public.ap_settings set business_name=left(n,250)")
tail='''
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
commit;
'''
Path('supabase/migrations/20260921201114_business_operations_v2.sql').write_text((p/'schema.sql').read_text()+cmd+tail.replace('commit;', (p/'restore.sql').read_text()+'\ncommit;'))
