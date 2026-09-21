import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { randomUUID as uuid } from "node:crypto";
const root = new URL("../", import.meta.url);
test("invoice import posts AP and inventory atomically, protects tenants, reverses stock and restores backups", async () => {
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
  await db.exec(
    await readFile(
      new URL(
        "supabase/migrations/20260921220532_invoice_inventory_import.sql",
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
  const path = b + "/file/invoice.pdf";
  await db.exec("reset role");
  await db.query(
    "insert into storage.objects values($1,$2,'sintech-documents')",
    [uuid(), path],
  );
  await as(admin);
  const payload = {
    reviewed: true,
    new_supplier: {
      business_name: "New vendor",
      category: "Food & Beverages",
      terms_days: 30,
    },
    file_hash: "a".repeat(64),
    path,
    file_name: "invoice.pdf",
    mime: "application/pdf",
    size: 1000,
    number: "N100",
    issue_date: "2026-01-01",
    due_date: "2026-01-31",
    subtotal_cents: 2500,
    tax_cents: 150,
    shipping_cents: 0,
    discount_cents: 0,
    total_cents: 2650,
    received: true,
    received_date: "2026-01-02",
    lines: [
      {
        description: "Rice",
        quantity: 2,
        unit: "case",
        unit_price: 12.5,
        amount_cents: 2500,
        track_stock: true,
        product_name: "Rice",
        stock_quantity: 24,
        stock_unit: "bag",
      },
    ],
  };
  await assert.rejects(
    () => command("invoice.import", { ...payload, total_cents: 2000 }),
    /reconcile/,
  );
  assert.equal(
    (await db.query("select public.ap_snapshot_v2($1) s", [b])).rows[0].s
      .suppliers.length,
    0,
    "failed import must roll back supplier too",
  );
  await assert.rejects(()=>command('invoice.import',{...payload,lines:[{...payload.lines[0],stock_quantity:0}]}),/Stock quantity/);
  const empty=(await db.query('select public.ap_snapshot_v2($1) s',[b])).rows[0].s;
  assert.equal(empty.invoices.length,0);assert.equal(empty.suppliers.length,0);assert.equal(empty.products.length,0);
  const req = uuid();
  let state = await command("invoice.import", payload, b, req);
  assert.equal(state.suppliers.length, 1);
  assert.equal(state.invoices.length, 1);
  assert.equal(state.invoices[0].status, "Approved");
  assert.equal(state.products.length, 1);
  assert.equal(Number(state.inventory_moves[0].quantity), 24);
  assert.equal(state.documents[0].entity_id, state.invoices[0].id);
  assert.equal(state.invoice_lines[0].amount_cents, 2500);
  const invoice = state.invoices[0],
    product = state.products[0];
  state = await command("invoice.import", payload, b, req);
  assert.equal(state.inventory_moves.length, 1);
  await assert.rejects(
    () => command("invoice.import", payload),
    /already imported/,
  );
  await assert.rejects(
    () => command("inventory.receive", { id: invoice.id, date: "2026-01-02" }),
    /already received/,
  );
  await assert.rejects(
    () => command("product.save", { ...product, unit: "lb" }),
    /Unit cannot change/,
  );
  await command("inventory.adjust", {
    product_id: product.id,
    quantity: -1,
    date: "2026-01-03",
    reason: "Used in kitchen",
  });
  await assert.rejects(
    () =>
      command("invoice.void", {
        id: invoice.id,
        version: invoice.version,
        reason: "Wrong invoice",
      }),
    /already been used/,
  );
  await command("inventory.adjust", {
    product_id: product.id,
    quantity: 1,
    date: "2026-01-03",
    reason: "Correction of usage",
  });
  state = await command("backup.create", {});
  const backup = state.backups.find((x) => x.label === "Manual snapshot");
  const recovered = uuid();
  await db.query("select public.ap_backup_restore($1,$2,$3)", [
    b,
    backup.id,
    recovered,
  ]);
  const restored = (
    await db.query("select public.ap_snapshot_v2($1) s", [recovered])
  ).rows[0].s;
  assert.equal(restored.invoice_lines.length, 1);
  assert.equal(restored.products.length, 1);
  assert.equal(
    restored.inventory_moves.reduce((n, m) => n + Number(m.quantity), 0),
    24,
  );
  assert.notEqual(restored.products[0].id, product.id);
  state = await command("invoice.void", {
    id: invoice.id,
    version: invoice.version,
    reason: "Wrong invoice",
  });
  assert.equal(
    state.inventory_moves.reduce((n, m) => n + Number(m.quantity), 0),
    0,
  );
  assert.equal(state.invoices[0].status, "Void");
  await assert.rejects(
    () =>
      command("inventory.adjust", {
        product_id: product.id,
        quantity: -1,
        date: "2026-01-03",
        reason: "Invalid usage",
      }),
    /negative/,
  );
  await assert.rejects(
    () =>
      command(
        "inventory.adjust",
        {
          product_id: product.id,
          quantity: 1,
          date: "2026-01-03",
          reason: "Cross tenant",
        },
        recovered,
      ),
    /active product/,
  );
  await command("member.save", {
    email: "viewer@test.com",
    role: "viewer",
    active: true,
  });
  await as(viewer);
  await assert.rejects(
    () => command("invoice.import", payload),
    /write access/,
  );
  await assert.rejects(
    () =>
      db.query("select public.ap_command_base_v2($1,$2,$3,$4)", [
        b,
        uuid(),
        "supplier.save",
        {},
      ]),
    /permission/,
  );
  assert.equal(
    (await db.query("select * from public.ap_products")).rows.length,
    1,
  );
  await db.close();
});
