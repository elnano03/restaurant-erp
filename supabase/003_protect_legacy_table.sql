-- Run AFTER verifying the import and retiring the old application.
-- This preserves all old data but prevents the old public app from changing/reading it.
do $$ begin
  if to_regclass('public."Suppliers"') is not null then
    execute 'alter table public."Suppliers" enable row level security';
    execute 'revoke all on public."Suppliers" from anon, authenticated';
  end if;
end $$;
