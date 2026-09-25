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
    update public.ap_settings set business_name=left(n,250),address=left(coalesce(payload->>'address',''),1000),phone=left(coalesce(payload->>'phone',''),60),email=left(coalesce(payload->>'email',''),250),terms_days=(payload->>'terms_days')::integer where business_id=business and id=1;
    select to_jsonb(x) into next_value from public.ap_settings x where business_id=business and id=1;
  else raise exception 'Unknown operation.';
  end if;
  insert into public.ap_audit(business_id,id,type,entity_id,actor,before,after) values(business,request_id,action,target::text,actor_name,prev,next_value);
  insert into public.ap_requests(business_id,id,user_id,action,payload) values(business,request_id,auth.uid(),action,payload);
  update public.ap_settings set revision=revision+1 where business_id=business and id=1;
  return public.ap_snapshot_v2(business);
exception when unique_violation then raise exception 'A supplier name or invoice number already exists. Refresh and check the existing records.';
end $$;
