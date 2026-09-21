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
