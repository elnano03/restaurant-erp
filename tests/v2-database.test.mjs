import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { randomUUID as uuid } from "node:crypto";
const root = new URL("../", import.meta.url);
test("v2 tenant isolation, credits, batch atomicity, categories, purchasing and backups", async () => {
  const db = new PGlite();
  await db.exec(
    `create role anon; create role authenticated; create schema auth; create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz); create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; create function auth.jwt() returns jsonb language sql as $$ select '{}'::jsonb $$; create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]); create table storage.objects(id uuid,name text,bucket_id text); alter table storage.objects enable row level security; create function storage.foldername(text) returns text[] language sql as $$ select string_to_array($1,'/') $$; create table public."Suppliers"(id uuid);`,
  );
  await db.exec(
    await readFile(new URL("supabase/001_accounts_payable.sql", root), "utf8"),
  );
  const admin = uuid(),
    viewer = uuid();
  await db.query("insert into auth.users values($1,$2,now()),($3,$4,now())", [
    admin,
    "admin@test.com",
    viewer,
    "viewer@test.com",
  ]);
  await db.query("insert into public.ap_members values($1,'admin',true)", [
    admin,
  ]);
  await db.exec(
    await readFile(
      new URL(
        "supabase/migrations/20260921201114_business_operations_v2.sql",
        root,
      ),
      "utf8",
    ),
  );
  const b = (await db.query("select id from public.ap_businesses")).rows[0].id;
  async function as(user) {
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      user,
    ]);
    await db.exec("set role authenticated");
  }
  await as(admin);
  async function command(action, payload, business = b, id = uuid()) {
    return (
      await db.query("select public.ap_command_v2($1,$2,$3,$4) s", [
        business,
        id,
        action,
        payload,
      ])
    ).rows[0].s;
  }
  let state = await command("supplier.save", {
    business_name: "Vendor",
    status: "Active",
    category: "Food & Beverages",
    terms_days: 30,
  });
  const supplier = state.suppliers[0].id;
  state = await command("invoice.save", {
    supplier_id: supplier,
    number: "A",
    issue_date: "2026-01-01",
    due_date: "2026-01-31",
    subtotal_cents: 10000,
    tax_cents: 0,
    shipping_cents: 0,
    discount_cents: 0,
  });
  const inv = state.invoices[0].id;
  await command("invoice.approve", { id: inv, version: 1 });
  state = await command("credit.create", {
    supplier_id: supplier,
    number: "CR1",
    date: "2026-01-02",
    amount_cents: 3000,
    reason: "Damaged products",
  });
  const cr = state.credits[0].id;
  await command("credit.apply", {
    credit_id: cr,
    invoice_id: inv,
    date: "2026-01-03",
    amount_cents: 3000,
  });
  await assert.rejects(() =>
    command("payment.record", {
      invoice_id: inv,
      amount_cents: 8000,
      date: "2026-01-04",
      method: "ACH",
    }),
  );
  const batch = uuid();
  state = await command(
    "payment.batch",
    {
      items: [{ invoice_id: inv, amount_cents: 7000 }],
      date: "2026-01-04",
      method: "ACH",
    },
    b,
    batch,
  );
  assert.equal(state.payments.length, 1);
  assert.equal(state.payments[0].batch_id, batch);
  state = await command(
    "payment.batch",
    {
      items: [{ invoice_id: inv, amount_cents: 7000 }],
      date: "2026-01-04",
      method: "ACH",
    },
    b,
    batch,
  );
  assert.equal(state.payments.length, 1);
  await assert.rejects(() =>
    command("invoice.void", {
      id: inv,
      version: 2,
      reason: "Cancelled invoice",
    }),
  );
  state = await command("category.save", { name: "Meats", active: true });
  assert(state.categories.some((c) => c.name === "Meats"));
  state = await command("order.save", {
    supplier_id: supplier,
    number: "PO1",
    date: "2026-01-04",
    lines: [{ product: "Beef", unit: "lb", quantity: 2.5, unit_cents: 129 }],
    notes: "",
  });
  const order = state.orders[0];
  assert.equal(order.total_cents, 323);
  await command("order.status", {
    id: order.id,
    version: 1,
    status: "Ordered",
  });
  await command("order.status", {
    id: order.id,
    version: 2,
    status: "Received",
  });
  state = await command("order.invoice", {
    id: order.id,
    number: "POINV",
    issue_date: "2026-01-04",
    due_date: "2026-02-01",
  });
  assert.equal(state.invoices.length, 2);
  await assert.rejects(() =>
    command("order.invoice", {
      id: order.id,
      number: "DUP",
      issue_date: "2026-01-04",
      due_date: "2026-02-01",
    }),
  );
  const poInvoice = state.invoices.find((x) => x.number === "POINV");
  state = await command("invoice.approve", { id: poInvoice.id, version: 1 });
  await assert.rejects(() =>
    command("payment.batch", {
      items: [
        { invoice_id: poInvoice.id, amount_cents: 100 },
        { invoice_id: inv, amount_cents: 1 },
      ],
      date: "2026-01-05",
      method: "ACH",
    }),
  );
  state = (await db.query("select public.ap_snapshot_v2($1) s", [b])).rows[0].s;
  assert.equal(
    state.payments.length,
    1,
    "a later invalid allocation must roll back earlier batch entries",
  );
  const cat = state.categories.find((x) => x.name === "Meats");
  state = await command("supplier.save", {
    ...state.suppliers[0],
    category: "Meats",
  });
  state = await command("category.save", { ...cat, name: "Fresh meats" });
  assert.equal(state.suppliers[0].category, "Fresh meats");
  state = await command("category.save", {
    ...state.categories.find((x) => x.id === cat.id),
    active: false,
  });
  await assert.rejects(() =>
    command("supplier.save", {
      business_name: "Invalid category",
      status: "Active",
      category: "Fresh meats",
      terms_days: 30,
    }),
  );
  await assert.rejects(() =>
    command("plan.save", {
      name: "Bad plan",
      date: "2026-01-05",
      budget_cents: 100,
      items: [{ invoice_id: poInvoice.id }],
    }),
  );
  const second = uuid();
  await command("business.create", { name: "Second" }, b, second);
  state = await command(
    "supplier.save",
    {
      business_name: "Vendor",
      status: "Active",
      category: "Food & Beverages",
      terms_days: 30,
    },
    second,
  );
  assert.equal(state.suppliers.length, 1);
  assert.equal(state.invoices.length, 0);
  await assert.rejects(() =>
    command(
      "supplier.save",
      {
        business_name: "HACK",
        status: "Active",
        category: "Food & Beverages",
        terms_days: 30,
      },
      second,
      supplier,
    ),
  );
  await assert.rejects(() =>
    command(
      "invoice.save",
      {
        supplier_id: supplier,
        number: "BAD",
        issue_date: "2026-01-01",
        due_date: "2026-01-31",
        subtotal_cents: 100,
        tax_cents: 0,
        shipping_cents: 0,
        discount_cents: 0,
      },
      second,
    ),
  );
  await command("member.save", {
    email: "viewer@test.com",
    role: "viewer",
    active: true,
  });
  state = await command("backup.create", {});
  const latest = state.backups.find((x) => x.label === "Manual snapshot");
  const recovered = uuid();
  await db.query("select public.ap_backup_restore($1,$2,$3)", [
    b,
    latest.id,
    recovered,
  ]);
  const restored = (
    await db.query("select public.ap_snapshot_v2($1) s", [recovered])
  ).rows[0].s;
  assert.equal(restored.suppliers.length, 1);
  assert.equal(restored.invoices.length, 2);
  assert.equal(restored.payments[0].amount_cents, 7000);
  assert.equal(restored.credit_allocations[0].amount_cents, 3000);
  assert.notEqual(restored.invoices[0].id, inv);
  assert.equal(restored.documents.length, 0);
  await db.query("select public.ap_backup_restore($1,$2,$3)", [
    b,
    latest.id,
    recovered,
  ]);
  await as(viewer);
  await assert.rejects(() => command("category.save", { name: "BAD" }));
  await assert.rejects(() =>
    db.query("select public.ap_snapshot_v2($1)", [second]),
  );
  assert.equal(
    (await db.query("select * from public.ap_suppliers")).rows.length,
    1,
  );
  await assert.rejects(() => db.query("select public.ap_snapshot()"));
  await db.close();
});
