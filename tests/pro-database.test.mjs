import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { randomUUID as uuid } from "node:crypto";
const root = new URL("../", import.meta.url);
test("PRO purchasing-to-receipt flow, holds, counts, idempotency and recovery", async () => {
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
  await db.exec(
    await readFile(
      new URL(
        "supabase/migrations/20260924224147_recipes_kitchen_usage.sql",
        root,
      ),
      "utf8",
    ),
  );
  await db.exec(
    await readFile(
      new URL(
        "supabase/migrations/20260924230354_operations_pro_controls.sql",
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

  let state = await command("invoice.import", payload);
  let inv = state.invoices[0],
    product = state.products[0];
  const stock = (s, id) =>
    s.inventory_moves
      .filter((m) => m.product_id === id)
      .reduce((n, m) => n + Number(m.quantity), 0);
  const pay = {
    invoice_id: inv.id,
    amount_cents: 100,
    date: "2026-01-03",
    method: "Cash",
    reference: "",
    notes: "",
  };
  state = await command("invoice.hold", {
    id: inv.id,
    version: inv.version,
    hold: true,
    reason: "Waiting for correction",
  });
  inv = state.invoices[0];
  assert.equal(inv.payment_hold, true);
  await assert.rejects(() => command("payment.record", pay), /payment hold/);
  await assert.rejects(
    () =>
      command("payment.batch", {
        items: [{ invoice_id: inv.id, amount_cents: 100 }],
        date: pay.date,
        method: "Cash",
      }),
    /payment hold/,
  );
  await assert.rejects(
    () =>
      command("plan.save", {
        name: "Plan",
        date: "2026-01-03",
        budget_cents: 1000,
        items: [{ invoice_id: inv.id, amount_cents: 100 }],
      }),
    /on hold/,
  );
  state = await command("invoice.hold", {
    id: inv.id,
    version: inv.version,
    hold: false,
    reason: "Correction reviewed",
  });
  state = await command("payment.record", pay);
  assert.equal(state.payments.length, 1);
  await assert.rejects(
    () =>
      command("plan.save", {
        name: "Plan",
        date: "2026-01-03",
        budget_cents: 50,
        items: [{ invoice_id: inv.id, amount_cents: 100 }],
      }),
    /budget/,
  );
  await assert.rejects(
    () =>
      command("plan.save", {
        name: "Too much",
        date: "2026-01-03",
        budget_cents: 100000,
        items: [{ invoice_id: inv.id, amount_cents: 99999 }],
      }),
    /balance/,
  );
  state = await command("stock.policy", {
    id: product.id,
    version: product.version,
    reorder_point: 5,
    target_stock: 30,
  });
  product = state.products[0];
  assert.equal(product.reorder_point, 5);
  await assert.rejects(
    () =>
      command("stock.policy", {
        id: product.id,
        version: product.version,
        reorder_point: 6,
        target_stock: 3,
      }),
    /Target/,
  );
  const count = {
    reason: "Weekly physical count",
    reviewed: true,
    lines: [{ product_id: product.id, unit: "bag", expected: 24, counted: 20 }],
  };
  const request = uuid();
  state = await command("stock.count", count, b, request);
  assert.equal(stock(state, product.id), 20);
  assert.equal(state.stock_counts.length, 1);
  state = await command("stock.count", count, b, request);
  assert.equal(stock(state, product.id), 20);
  assert.equal(state.stock_counts.length, 1);
  await assert.rejects(() => command("stock.count", count), /Stock changed/);
  state = await command("stock.count", {
    ...count,
    lines: [{ ...count.lines[0], expected: 20, counted: 20 }],
  });
  assert.equal(state.stock_counts.length, 2, "zero variance is recorded");
  const supplier = state.suppliers[0].id;
  const order = {
    supplier_id: supplier,
    number: "PO-MAP",
    date: "2026-01-04",
    notes: "Test",
    lines: [
      {
        product: "Rice",
        brand: "",
        unit: "case",
        quantity: 2,
        unit_cents: 1250,
        product_id: product.id,
        stock_quantity: 24,
        stock_unit: "bag",
      },
    ],
  };
  state = await command("order.save", order);
  let po = state.orders.find((o) => o.number === order.number);
  await assert.rejects(() => command("order.save", order), /Duplicate/);
  await assert.rejects(
    () =>
      command("order.save", {
        ...order,
        number: "BADUNIT",
        lines: [{ ...order.lines[0], stock_unit: "lb" }],
      }),
    /mapped/,
  );
  await assert.rejects(
    () =>
      command("order.batch", {
        orders: [
          { ...order, number: "BATCH1" },
          { ...order, number: "BATCH2", supplier_id: uuid() },
        ],
      }),
    /active supplier/,
  );
  state = (await db.query("select public.ap_snapshot_v2($1) s", [b])).rows[0].s;
  assert.ok(
    !state.orders.some((o) => o.number === "BATCH1"),
    "batch rolls back all orders",
  );
  state = await command("order.status", {
    id: po.id,
    version: po.version,
    status: "Ordered",
  });
  po = state.orders.find((o) => o.id === po.id);
  state = await command("order.status", {
    id: po.id,
    version: po.version,
    status: "Received",
  });
  po = state.orders.find((o) => o.id === po.id);
  assert.equal(
    stock(state, product.id),
    20,
    "delivery confirmation does not double-receive stock",
  );
  state = await command("order.invoice", {
    id: po.id,
    number: "POINV1",
    issue_date: "2026-01-04",
    due_date: "2026-02-04",
    tax_cents: 0,
    shipping_cents: 0,
  });
  po = state.orders.find((o) => o.id === po.id);
  let bill = state.invoices.find((i) => i.id === po.invoice_id);
  const billLines = state.invoice_lines.filter((l) => l.invoice_id === bill.id);
  assert.equal(billLines.length, 1);
  assert.equal(billLines[0].stock_quantity, 24);
  assert.equal(billLines[0].product_id, product.id);
  await assert.rejects(
    () => command("invoice.save", { ...bill, subtotal_cents: 999 }),
    /Subtotal/,
  );
  state = await command("invoice.approve", {
    id: bill.id,
    version: bill.version,
  });
  state = await command("inventory.receive", {
    id: bill.id,
    date: "2026-01-04",
  });
  assert.equal(stock(state, product.id), 44);
  await assert.rejects(
    () => command("inventory.receive", { id: bill.id, date: "2026-01-04" }),
    /already received/,
  );
  await assert.rejects(
    () =>
      command("invoice.save", {
        supplier_id: supplier,
        number: "P O I N V 1",
        issue_date: "2026-01-04",
        due_date: "2026-02-04",
        subtotal_cents: 2500,
        tax_cents: 0,
        shipping_cents: 0,
        discount_cents: 0,
      }),
    /Duplicate/,
  );
  state = await command("order.save", { ...order, number: "LINK1" });
  let link = state.orders.find((o) => o.number === "LINK1");
  state = await command("order.status", {
    id: link.id,
    version: link.version,
    status: "Ordered",
  });
  link = state.orders.find((o) => o.id === link.id);
  state = await command("order.status", {
    id: link.id,
    version: link.version,
    status: "Received",
  });
  link = state.orders.find((o) => o.id === link.id);
  state = await command("order.link", {
    id: link.id,
    version: link.version,
    invoice_id: inv.id,
    reason: "Original invoice matched",
  });
  assert.equal(
    state.invoices.length,
    2,
    "linking does not create another payable",
  );
  assert.equal(
    stock(state, product.id),
    44,
    "linking does not create another stock receipt",
  );
  await assert.rejects(
    () =>
      command("order.link", {
        id: link.id,
        version: link.version + 1,
        invoice_id: bill.id,
        reason: "Duplicate invoice match",
      }),
    /already has/,
  );
  // Count failure on a later product rolls back earlier deltas.
  await assert.rejects(
    () =>
      command("stock.count", {
        ...count,
        lines: [
          { ...count.lines[0], expected: 44, counted: 40 },
          { product_id: uuid(), unit: "bag", expected: 0, counted: 1 },
        ],
      }),
    /Products/,
  );
  state = (await db.query("select public.ap_snapshot_v2($1) s", [b])).rows[0].s;
  assert.equal(stock(state, product.id), 44);
  await assert.rejects(
    () => command("stock.count", count, uuid()),
    /write access/,
  );
  await db.exec("reset role");
  await db.query(
    "insert into public.ap_business_members values($1,$2,'accountant',true)",
    [b, viewer],
  );
  await as(viewer);
  await assert.rejects(() => command("stock.count", count), /Administrator/);
  await assert.rejects(
    () =>
      db.query(
        "insert into public.ap_stock_counts select * from public.ap_stock_counts",
      ),
    /permission denied/,
  );
  await as(admin);
  state = await command("backup.create", {});
  const backup = state.backups.find((x) => x.label === "Manual snapshot");
  const restored = uuid();
  await db.query("select public.ap_backup_restore($1,$2,$3)", [
    b,
    backup.id,
    restored,
  ]);
  const recovered = (
    await db.query("select public.ap_snapshot_v2($1) s", [restored])
  ).rows[0].s;
  assert.equal(recovered.stock_counts.length, 2);
  assert.equal(recovered.products[0].reorder_point, 5);
  assert.ok(
    recovered.products.some(
      (p) => p.id === recovered.stock_counts[0].lines[0].product_id,
    ),
  );
  assert.equal(recovered.orders.length, state.orders.length);
  await db.close();
});
