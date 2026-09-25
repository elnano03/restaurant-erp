begin;
-- Private operational storage: no direct client writes, no HR payloads in general AP audit/backups.
create table ap_private.team_records(id uuid primary key,business_id uuid not null references public.ap_businesses(id),kind text not null check(kind in ('employee','shift','time','leave','payrun','certificate','sale','task')),data jsonb not null check(jsonb_typeof(data)='object'),version integer not null default 1,created_by uuid not null references auth.users(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create index team_records_business_kind on ap_private.team_records(business_id,kind);
create unique index team_employee_code on ap_private.team_records(business_id,lower(data->>'code')) where kind='employee';
create unique index team_sales_reference on ap_private.team_records(business_id,lower(data->>'source'),lower(data->>'reference')) where kind='sale';
create table ap_private.team_requests(id uuid primary key,business_id uuid not null references public.ap_businesses(id),actor uuid not null references auth.users(id),action text not null,payload jsonb not null,created_at timestamptz not null default now());
create table ap_private.team_audit(id uuid primary key default gen_random_uuid(),business_id uuid not null references public.ap_businesses(id),record_id uuid not null,kind text not null,actor uuid not null references auth.users(id),reason text not null,before jsonb,after jsonb,created_at timestamptz not null default now());
create index team_audit_business on ap_private.team_audit(business_id,created_at);
create table ap_private.team_access(business_id uuid not null references public.ap_businesses(id),user_id uuid not null references auth.users(id),primary key(business_id,user_id));
alter table ap_private.team_records enable row level security;
alter table ap_private.team_requests enable row level security;
alter table ap_private.team_audit enable row level security;
alter table ap_private.team_access enable row level security;
revoke all on ap_private.team_records,ap_private.team_requests,ap_private.team_audit,ap_private.team_access from public,anon,authenticated;

create function ap_private.team_snapshot(business uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare hr boolean; r text;
begin
 r:=public.ap_role_v2(business); if auth.uid() is null or r is null then raise exception 'No access to this business.'; end if;
 hr:=r='admin' or exists(select 1 from ap_private.team_access where business_id=business and user_id=auth.uid());
 return jsonb_build_object('hr_enabled',hr,
 'team_records',coalesce((select jsonb_agg(to_jsonb(t) order by t.created_at desc) from ap_private.team_records t where business_id=business and (hr or kind in ('sale','task'))),'[]'::jsonb),
 'team_audit',coalesce((select jsonb_agg(to_jsonb(t)) from (select * from ap_private.team_audit where business_id=business and (hr or kind in ('sale','task')) order by created_at desc limit 200) t),'[]'::jsonb),
 'hr_access',case when r='admin' then coalesce((select jsonb_agg(user_id) from ap_private.team_access where business_id=business),'[]'::jsonb) else '[]'::jsonb end);
end $$;
revoke all on function ap_private.team_snapshot(uuid) from public,anon;
grant execute on function ap_private.team_snapshot(uuid) to authenticated;
create function public.ap_team_snapshot(business uuid) returns jsonb language sql security invoker set search_path='' as $$ select ap_private.team_snapshot(business) $$;
revoke all on function public.ap_team_snapshot(uuid) from public,anon;
grant execute on function public.ap_team_snapshot(uuid) to authenticated;

create function ap_private.team_command(business uuid,request_id uuid,action text,payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare r text; hr boolean; k text; d jsonb; target uuid; old ap_private.team_records; req ap_private.team_requests; emp ap_private.team_records; entry ap_private.team_records;
 reason text; start_at timestamptz; end_at timestamptz; from_day date; to_day date; mins numeric; field text; v numeric; total bigint; expected bigint; rows jsonb; item jsonb; child uuid; result jsonb; eid uuid;
begin
 r:=public.ap_role_v2(business); if auth.uid() is null or r is null then raise exception 'No access to this business.'; end if;
 hr:=r='admin' or exists(select 1 from ap_private.team_access where business_id=business and user_id=auth.uid());
 if request_id is null or jsonb_typeof(payload) is distinct from 'object' then raise exception 'Invalid request.'; end if;
 perform 1 from public.ap_settings where business_id=business for update;
 select * into req from ap_private.team_requests where id=request_id;
 if found then
  if req.business_id=business and req.actor=auth.uid() and req.action=action and req.payload=payload then return ap_private.team_snapshot(business); end if;
  raise exception 'Request ID already used.';
 end if;
 reason:=btrim(coalesce(payload->>'reason',''));
 if action='team.access' then
  if r<>'admin' then raise exception 'Only administrators manage HR access.'; end if;
  eid:=(payload->>'user_id')::uuid;
  if not exists(select 1 from public.ap_business_members where business_id=business and user_id=eid and active) then raise exception 'Choose an active business member.'; end if;
  if (payload->>'enabled')::boolean then insert into ap_private.team_access values(business,eid) on conflict do nothing; else delete from ap_private.team_access where business_id=business and user_id=eid; end if;
  insert into ap_private.team_audit(business_id,record_id,kind,actor,reason,after) values(business,eid,'employee',auth.uid(),'HR access changed',payload);
 elsif action='team.batch' then
  if jsonb_typeof(payload->'rows') is distinct from 'array' or jsonb_array_length(payload->'rows') not between 1 and 200 then raise exception 'Import 1 to 200 rows.'; end if;
  for item in select * from jsonb_array_elements(payload->'rows') loop
   if item->>'kind' not in ('time','sale') then raise exception 'Only attendance and sales can be imported.'; end if;
   child:=gen_random_uuid();perform ap_private.team_command(business,child,'team.save',item||jsonb_build_object('reason','CSV import'));
  end loop;
 elsif action='team.save' then
  k:=payload->>'kind';d:=payload->'data';target:=coalesce(nullif(payload->>'id','')::uuid,request_id);
  if k is null or k not in ('employee','shift','time','leave','payrun','certificate','sale','task') or jsonb_typeof(d) is distinct from 'object' then raise exception 'Invalid record type.'; end if;
  if (k in ('sale','task') and r not in ('admin','accountant')) or (k not in ('sale','task') and not hr) then raise exception 'Your role cannot change these records.'; end if;
  if octet_length(d::text)>100000 then raise exception 'Record is too large.'; end if;
  select * into old from ap_private.team_records where id=target;
  if found then
   if old.business_id<>business or old.kind<>k then raise exception 'Record unavailable.'; end if;
   if old.version is distinct from (payload->>'version')::int then raise exception 'Record changed. Refresh before editing.'; end if;
   if length(reason) not between 5 and 500 then raise exception 'Enter a reason for this correction (5–500 characters).'; end if;
   if k='payrun' then raise exception 'Approved payroll reviews are immutable. Export an adjustment separately.'; end if;
   if k='sale' and old.data->>'status'='Closed' then raise exception 'Closed sales are immutable. Reopen with a reason first.'; end if;
   if k='time' and exists(select 1 from ap_private.team_records p where p.business_id=business and p.kind='payrun' and p.data->>'status'<>'Voided' and p.data->'entry_ids' @> jsonb_build_array(target::text)) then raise exception 'This attendance entry is locked by a payroll review.'; end if;
  end if;
  if k='employee' then
   if length(btrim(coalesce(d->>'name',''))) not between 2 and 150 or length(btrim(coalesce(d->>'code',''))) not between 1 and 50 then raise exception 'Employee name and unique clock code are required.'; end if;
   v:=(d->>'rate_cents')::numeric;
   if v is null or v<0 or v>10000000 or v<>trunc(v) or d->>'status' is null or d->>'status' not in ('Active','Inactive') then raise exception 'Review hourly rate and employee status.'; end if;
   d:=d||jsonb_build_object('name',btrim(d->>'name'),'code',btrim(d->>'code'));
  elsif k in ('shift','time','leave','certificate') then
   eid:=(d->>'employee_id')::uuid;
   select * into emp from ap_private.team_records where id=eid and business_id=business and kind='employee';
   if emp.id is null then raise exception 'Employee does not belong to this business.'; end if;
   if old.id is null and emp.data->>'status'<>'Active' then raise exception 'Employee is inactive.'; end if;
   if k in ('shift','time') then
    if coalesce(d->>'start','') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$' or (nullif(d->>'end','') is not null and d->>'end' !~ '(Z|[+-][0-9]{2}:[0-9]{2})$') then raise exception 'Punch times require an explicit timezone.'; end if;
    start_at:=(d->>'start')::timestamptz;end_at:=nullif(d->>'end','')::timestamptz;v:=(d->>'break_minutes')::numeric;
    if start_at is null or not isfinite(start_at) or v is null or v<0 or v>1440 or v<>trunc(v) or (end_at is not null and (not isfinite(end_at) or end_at<=start_at or end_at-start_at>interval '24 hours' or v>=extract(epoch from end_at-start_at)/60)) then raise exception 'Review start, end and unpaid break. Maximum entry length is 24 hours.'; end if;
    if k='shift' and (end_at is null or d->>'status' is null or d->>'status' not in ('Scheduled','Cancelled')) then raise exception 'A shift needs an end time and status.'; end if;
    if k='time' and (start_at>now() or end_at>now() or d->>'status' is null or d->>'status' not in ('Draft','Approved','Void') or (d->>'status'='Approved' and end_at is null)) then raise exception 'Approve only complete attendance; future punches are not allowed.'; end if;
    if coalesce(d->>'status','') not in ('Void','Cancelled') and exists(select 1 from ap_private.team_records t where t.business_id=business and t.kind=k and t.id<>target and t.data->>'employee_id'=eid::text and t.data->>'status' not in ('Void','Cancelled') and tstzrange((t.data->>'start')::timestamptz,nullif(t.data->>'end','')::timestamptz,'[)') && tstzrange(start_at,end_at,'[)')) then raise exception 'This employee already has an overlapping shift or attendance entry.'; end if;
    if k='shift' and d->>'status'='Scheduled' and exists(select 1 from ap_private.team_records t where t.business_id=business and t.kind='leave' and t.data->>'employee_id'=eid::text and t.data->>'status'='Approved' and daterange((t.data->>'from')::date,(t.data->>'to')::date,'[]') && daterange((start_at at time zone 'America/New_York')::date,((end_at-interval '1 microsecond') at time zone 'America/New_York')::date,'[]')) then raise exception 'This employee has approved time off.'; end if;
    d:=d||jsonb_build_object('start',start_at,'end',end_at);
    if k='time' then d:=d||jsonb_build_object('rate_cents',case when old.id is not null and old.data->>'employee_id'=eid::text then (old.data->>'rate_cents')::bigint else (emp.data->>'rate_cents')::bigint end,'minutes',case when end_at is not null then round(extract(epoch from end_at-start_at)/60-v,2) else null end);end if;
   elsif k='leave' then
    from_day:=(d->>'from')::date;to_day:=(d->>'to')::date;
    if from_day is null or to_day is null or not isfinite(from_day) or not isfinite(to_day) or to_day<from_day or to_day-from_day>366 or d->>'status' is null or d->>'status' not in ('Requested','Approved','Declined','Cancelled') then raise exception 'Review time-off dates and status.'; end if;
    if d->>'status'='Approved' and (exists(select 1 from ap_private.team_records t where t.business_id=business and t.kind='leave' and t.id<>target and t.data->>'employee_id'=eid::text and t.data->>'status'='Approved' and daterange((t.data->>'from')::date,(t.data->>'to')::date,'[]') && daterange(from_day,to_day,'[]')) or exists(select 1 from ap_private.team_records t where t.business_id=business and t.kind='shift' and t.data->>'employee_id'=eid::text and t.data->>'status'='Scheduled' and daterange(((t.data->>'start')::timestamptz at time zone 'America/New_York')::date,(((t.data->>'end')::timestamptz-interval '1 microsecond') at time zone 'America/New_York')::date,'[]') && daterange(from_day,to_day,'[]'))) then raise exception 'Time off conflicts with approved leave or a scheduled shift. Resolve the schedule first.';end if;
   else
    if length(btrim(coalesce(d->>'title','')))<2 or nullif(d->>'expires','')::date is null then raise exception 'Document title and expiration date are required.';end if;
   end if;
  elsif k='payrun' then
   from_day:=(d->>'from')::date;to_day:=(d->>'to')::date;
   if from_day is null or to_day is null or not isfinite(from_day) or not isfinite(to_day) or to_day<from_day or to_day-from_day>31 or to_day> (now() at time zone 'America/New_York')::date then raise exception 'Choose a past payroll review period of up to 32 days.'; end if;
   if exists(select 1 from ap_private.team_records t where business_id=business and kind='time' and (t.data->>'start')::timestamptz at time zone 'America/New_York' >= from_day::timestamp and (t.data->>'start')::timestamptz at time zone 'America/New_York' < (to_day+1)::timestamp and t.data->>'status'='Draft') then raise exception 'Resolve or void draft attendance in this period first.'; end if;
   rows:='[]'::jsonb;result:='[]'::jsonb;total:=0;
   for entry in select * from ap_private.team_records t where business_id=business and kind='time' and data->>'status'='Approved' and ((data->>'start')::timestamptz at time zone 'America/New_York')::date between from_day and to_day order by data->>'start' loop
    if exists(select 1 from ap_private.team_records p where business_id=business and kind='payrun' and data->>'status'<>'Voided' and data->'entry_ids' @> jsonb_build_array(entry.id::text)) then raise exception 'Some attendance is already in a payroll review. Select a nonoverlapping period.';end if;
    mins:=(entry.data->>'minutes')::numeric;v:=round(mins*(entry.data->>'rate_cents')::numeric/60);total:=total+v;
    select * into emp from ap_private.team_records where id=(entry.data->>'employee_id')::uuid;
    rows:=rows||jsonb_build_array(entry.data||jsonb_build_object('id',entry.id,'employee_name',emp.data->>'name','employee_code',emp.data->>'code','base_pay_cents',v));result:=result||jsonb_build_array(entry.id::text);
   end loop;
   if jsonb_array_length(rows)=0 then raise exception 'No approved attendance in this period.';end if;
   d:=jsonb_build_object('from',from_day,'to',to_day,'lines',rows,'entry_ids',result,'base_pay_cents',total,'status','Reviewed','notes',d->>'notes','reviewed_by',auth.uid(),'reviewed_at',now());
  elsif k='sale' then
   from_day:=(d->>'date')::date;
   if from_day is null or not isfinite(from_day) or from_day>(now() at time zone 'America/New_York')::date or length(btrim(coalesce(d->>'source','')))<2 or length(btrim(coalesce(d->>'reference','')))<1 or d->>'status' is null or d->>'status' not in ('Draft','Closed') then raise exception 'Review sales date, source, reference and status.'; end if;
   foreach field in array array['gross','discounts','refunds','tax','tips','cash','card','other','opening','paid_out','counted'] loop
    v:=(d->>(field||'_cents'))::numeric;if v is null or v<0 or v>100000000000 or v<>trunc(v) then raise exception 'Sales amounts must be nonnegative whole cents.';end if;
   end loop;
   total:=(d->>'gross_cents')::bigint-(d->>'discounts_cents')::bigint-(d->>'refunds_cents')::bigint;
   if total<0 then raise exception 'Discounts and refunds exceed gross sales. Review source totals.';end if;
   expected:=(d->>'opening_cents')::bigint+(d->>'cash_cents')::bigint-(d->>'paid_out_cents')::bigint;
   if expected<0 then raise exception 'Cash paid out exceeds available cash.';end if;
   if d->>'status'='Closed' and total+(d->>'tax_cents')::bigint+(d->>'tips_cents')::bigint<>(d->>'cash_cents')::bigint+(d->>'card_cents')::bigint+(d->>'other_cents')::bigint then raise exception 'Tenders must reconcile to net sales plus tax and tips before closing.';end if;
   if d->>'status'='Closed' and expected<>(d->>'counted_cents')::bigint and length(btrim(coalesce(d->>'notes','')))<5 then raise exception 'Explain the cash variance before closing.';end if;
   d:=d||jsonb_build_object('net_cents',total,'expected_cash_cents',expected,'variance_cents',(d->>'counted_cents')::bigint-expected,'source',btrim(d->>'source'),'reference',btrim(d->>'reference'));
  elsif k='task' then
   if length(btrim(coalesce(d->>'title','')))<2 or nullif(d->>'due','')::date is null or d->>'status' is null or d->>'status' not in ('Open','In progress','Done','Cancelled') then raise exception 'Task title, due date and status are required.';end if;
   d:=d||jsonb_build_object('completed_by',case when d->>'status'='Done' then auth.uid() else null end,'completed_at',case when d->>'status'='Done' then now() else null end);
  end if;
  insert into ap_private.team_records(id,business_id,kind,data,created_by) values(target,business,k,d,auth.uid()) on conflict(id) do update set data=excluded.data,version=ap_private.team_records.version+1,updated_at=now();
  insert into ap_private.team_audit(business_id,record_id,kind,actor,reason,before,after) values(business,target,k,auth.uid(),coalesce(nullif(reason,''),'Created'),old.data,d);
 elsif action='team.void_review' then
  if r<>'admin' then raise exception 'Only administrators can void a payroll review.';end if;
  target:=(payload->>'id')::uuid;select * into old from ap_private.team_records where id=target and business_id=business and kind='payrun';
  if old.id is null or old.version is distinct from (payload->>'version')::int or old.data->>'status'<>'Reviewed' or length(reason) not between 5 and 500 then raise exception 'Refresh this review and provide a correction reason.';end if;
  d:=old.data||jsonb_build_object('status','Voided','void_reason',reason,'voided_at',now(),'voided_by',auth.uid());
  update ap_private.team_records set data=d,version=version+1,updated_at=now() where id=target;
  insert into ap_private.team_audit(business_id,record_id,kind,actor,reason,before,after) values(business,target,'payrun',auth.uid(),reason,old.data,d);
 elsif action='team.reopen' then
  if r<>'admin' then raise exception 'Only administrators can reopen a sales close.';end if;
  target:=(payload->>'id')::uuid;select * into old from ap_private.team_records where id=target and business_id=business and kind='sale';
  if old.id is null or old.version is distinct from (payload->>'version')::int or old.data->>'status'<>'Closed' or length(reason) not between 5 and 500 then raise exception 'Refresh this closed record and provide a correction reason.';end if;
  update ap_private.team_records set data=data||'{"status":"Draft"}'::jsonb,version=version+1,updated_at=now() where id=target;
  insert into ap_private.team_audit(business_id,record_id,kind,actor,reason,before,after) values(business,target,'sale',auth.uid(),reason,old.data,old.data||'{"status":"Draft"}'::jsonb);
 else raise exception 'Unknown workforce operation.';
 end if;
 insert into ap_private.team_requests values(request_id,business,auth.uid(),action,payload,now());
 return ap_private.team_snapshot(business);
end $$;
revoke all on function ap_private.team_command(uuid,uuid,text,jsonb) from public,anon;
grant execute on function ap_private.team_command(uuid,uuid,text,jsonb) to authenticated;
create function public.ap_team_command(business uuid,request_id uuid,action text,payload jsonb) returns jsonb language sql security invoker set search_path='' as $$ select ap_private.team_command(business,request_id,action,payload) $$;
revoke all on function public.ap_team_command(uuid,uuid,text,jsonb) from public,anon;
grant execute on function public.ap_team_command(uuid,uuid,text,jsonb) to authenticated;
commit;
