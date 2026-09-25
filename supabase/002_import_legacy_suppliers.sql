-- OPTIONAL: copy the existing Suppliers table without modifying it.
-- Back up your project first. Review opening balances before approving them.
-- Legacy balances become DRAFT opening invoices, avoiding automatic double counting.
begin;
do $$
declare s record; j jsonb; new_id uuid; debt numeric; mapped text;
begin
  if to_regclass('public."Suppliers"') is null then raise notice 'No legacy Suppliers table found. Nothing imported.'; return; end if;
  for s in execute 'select to_jsonb(t) as data from public."Suppliers" t' loop
    j:=s.data;
    if exists(select 1 from public.ap_suppliers where legacy_id=j->>'id') then continue; end if;
    if coalesce(btrim(j->>'business_name'),'')='' then raise exception 'Legacy supplier % has no business_name. No changes were saved.',j->>'id'; end if;
    if j->>'id' is null then raise exception 'Legacy supplier is missing an ID.'; end if;
    debt:=coalesce(nullif(j->>'balance',''),'0')::numeric;
    if debt<0 then raise exception 'Supplier % has a credit balance. Review it before importing; no changes were saved.',j->>'business_name'; end if;
    new_id:=gen_random_uuid();
    mapped:=case lower(coalesce(j->>'status','active')) when 'active' then 'Active' when 'activo' then 'Active' when 'blocked' then 'Blocked' when 'bloqueado' then 'Blocked' else 'Inactive' end;
    insert into public.ap_suppliers(id,business_name,phone,email,category,status,terms_days,notes,legacy_id)
      values(new_id,btrim(j->>'business_name'),coalesce(j->>'phone',''),coalesce(j->>'email',''),coalesce(j->>'category','Other'),mapped,30,'Imported from the original Suppliers table',j->>'id');
    if debt>0 then
      insert into public.ap_invoices(id,supplier_id,number,issue_date,due_date,category,description,subtotal_cents,tax_cents,shipping_cents,discount_cents,status)
        values(gen_random_uuid(),new_id,'OPENING-'||(j->>'id'),current_date,current_date,'Opening balance','Review this opening balance against your supplier statement. Do not also enter its original invoices unless this opening balance is voided.',round(debt*100)::bigint,0,0,0,'Draft');
    end if;
    insert into public.ap_audit(id,type,entity_id,actor,after) values(gen_random_uuid(),'supplier.import',new_id::text,'Database administrator',jsonb_build_object('business_name',j->>'business_name','legacy_id',j->>'id','opening_balance',debt));
  end loop;
  update public.ap_settings set revision=revision+1 where id=1;
end $$;
commit;
