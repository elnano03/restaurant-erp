import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { randomUUID as uuid } from "node:crypto";
const root = new URL("../", import.meta.url);
test("kitchen recipes, costing, atomic consumption, permissions, reversal and backup recovery", async () => {
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
  const product = state.products[0];
  async function kitchen(action, payload, business = b, id = uuid()) {
    return (
      await db.query("select public.ap_kitchen_command($1,$2,$3,$4) s", [
        business,
        id,
        action,
        payload,
      ])
    ).rows[0].s;
  }
  const recipe = {
    name: "Rice side",
    yield_portions: 8,
    selling_price_cents: 500,
    target_food_percent: 30,
    ingredients: [{ product_id: product.id, quantity: 2, unit: "bag" }],
    notes: "Kitchen test",
    active: true,
  };
  state = await kitchen("recipe.save", recipe);
  const saved = state.recipes[0];
  await assert.rejects(
    () => kitchen("recipe.save", { ...saved, version: 0 }),
    /changed/,
  );
  await assert.rejects(
    () =>
      kitchen("recipe.save", {
        ...recipe,
        name: "Bad units",
        ingredients: [{ product_id: product.id, quantity: 1, unit: "lb" }],
      }),
    /matching/,
  );
  await assert.rejects(
    () =>
      kitchen("recipe.save", {
        ...recipe,
        name: "Duplicate ingredient",
        ingredients: [...recipe.ingredients, ...recipe.ingredients],
      }),
    /repeated/,
  );
  const post = {
    kind: "production",
    recipe_id: saved.id,
    recipe_version: 1,
    quantity: 4,
    reason: "Lunch preparation",
    reviewed: true,
  };
  const req = uuid();
  state = await kitchen("kitchen.post", post, b, req);
  assert.equal(state.kitchen_entries.length, 1);
  const entry = state.kitchen_entries[0];
  assert.equal(entry.lines[0].quantity, 1);
  assert.equal(entry.cost_cents, 104); // $25 / 24 inventory bags, not $12.50 billed case price
  assert.equal(
    state.inventory_moves.reduce((n, m) => n + Number(m.quantity), 0),
    23,
  );
  state = await kitchen("kitchen.post", post, b, req);
  assert.equal(state.kitchen_entries.length, 1, "retry does not double deduct");
  await assert.rejects(
    () => kitchen("kitchen.post", { ...post, quantity: 10000 }),
    /Insufficient/,
  );
  await assert.rejects(
    () => kitchen("kitchen.post", { ...post, recipe_version: 0 }),
    /changed/,
  );
  await assert.rejects(
    () => kitchen("kitchen.post", { ...post, reviewed: false }),
    /Review/,
  );
  await assert.rejects(
    () => kitchen("kitchen.post", post, uuid()),
    /write access/,
  );
  state = await kitchen("kitchen.post", {
    kind: "waste",
    product_id: product.id,
    quantity: 2,
    reason: "Spoiled packaging",
    reviewed: true,
  });
  assert.equal(
    state.inventory_moves.reduce((n, m) => n + Number(m.quantity), 0),
    21,
  );
  assert.equal(
    state.kitchen_entries.find((e) => e.kind === "waste").cost_cents,
    208,
  );
  state = await kitchen("recipe.save", {
    ...saved,
    ingredients: [{ ...recipe.ingredients[0], quantity: 4 }],
  });
  state = await kitchen("kitchen.reverse", {
    id: entry.id,
    reason: "Duplicate paper entry",
  });
  assert.equal(
    state.inventory_moves.reduce((n, m) => n + Number(m.quantity), 0),
    22,
    "reversal uses original quantity, not edited recipe",
  );
  await assert.rejects(
    () =>
      kitchen("kitchen.reverse", { id: entry.id, reason: "Second reversal" }),
    /already reversed/,
  );
  await assert.rejects(
    () =>
      db.query("insert into public.ap_recipes select * from public.ap_recipes"),
    /permission denied/,
  );
  await db.exec("reset role");
  await db.query(
    "insert into public.ap_business_members values($1,$2,'viewer',true)",
    [b, viewer],
  );
  await as(viewer);
  await assert.rejects(() => kitchen("recipe.save", recipe), /write access/);
  await db.exec("reset role");
  await db.query(
    "update public.ap_business_members set role='accountant' where business_id=$1 and user_id=$2",
    [b, viewer],
  );
  await as(viewer);
  await assert.rejects(
    () =>
      kitchen("kitchen.reverse", {
        id: entry.id,
        reason: "Attempt correction",
      }),
    /Administrator/,
  );
  await as(admin);
  // A second unpriced ingredient makes total cost unknown, not zero.
  state = await command("product.save", {
    name: "Seasoning",
    unit: "lb",
    sku: "",
    active: true,
  });
  const seasoning = state.products.find((p) => p.name === "Seasoning");
  state = await command("inventory.adjust", {
    product_id: seasoning.id,
    quantity: 1,
    date: "2026-01-02",
    reason: "Counted stock",
  });
  state = await kitchen("recipe.save", {
    name: "Seasoned rice",
    yield_portions: 3,
    selling_price_cents: 500,
    target_food_percent: 30,
    ingredients: [
      { product_id: product.id, quantity: 1, unit: "bag" },
      { product_id: seasoning.id, quantity: 0.001, unit: "lb" },
    ],
  });
  const r2 = state.recipes.find((r) => r.name === "Seasoned rice");
  state = await kitchen("kitchen.post", {
    kind: "production",
    recipe_id: r2.id,
    recipe_version: 1,
    quantity: 1,
    reason: "Dinner preparation",
    reviewed: true,
  });
  const e2 = state.kitchen_entries.find((e) => e.recipe_id === r2.id);
  assert.equal(e2.cost_cents, null);
  assert.equal(
    e2.lines[0].quantity,
    0.334,
    "rounds consumption up to stock precision",
  );
  assert.equal(e2.lines[1].quantity, 0.001);
  // Failed second ingredient cannot partially deduct the first.
  state = await kitchen("recipe.save", {
    ...r2,
    ingredients: [r2.ingredients[0], { ...r2.ingredients[1], quantity: 100 }],
  });
  const before = state.inventory_moves.length;
  await assert.rejects(
    () =>
      kitchen("kitchen.post", {
        kind: "production",
        recipe_id: r2.id,
        recipe_version: 2,
        quantity: 3,
        reason: "Impossible batch",
        reviewed: true,
      }),
    /Insufficient/,
  );
  state = (await db.query("select public.ap_snapshot_v2($1) s", [b])).rows[0].s;
  assert.equal(state.inventory_moves.length, before);
  state = await command("backup.create", { label: "Kitchen test backup" });
  const backup = state.backups.find((x) => x.label === "Manual snapshot");
  const recovered = uuid();
  await db.query("select public.ap_backup_restore($1,$2,$3)", [
    b,
    backup.id,
    recovered,
  ]);
  const recoveredState = (
    await db.query("select public.ap_snapshot_v2($1) s", [recovered])
  ).rows[0].s;
  assert.equal(recoveredState.recipes.length, state.recipes.length);
  assert.equal(
    recoveredState.kitchen_entries.length,
    state.kitchen_entries.length,
  );
  assert.equal(
    recoveredState.inventory_moves.length,
    state.inventory_moves.length,
  );
  assert.notEqual(
    recoveredState.recipes[0].ingredients[0].product_id,
    product.id,
  );
  assert.ok(
    recoveredState.products.some(
      (p) => p.id === recoveredState.recipes[0].ingredients[0].product_id,
    ),
  );
  await db.exec("reset role");
  const outsider = uuid();
  await db.query("insert into auth.users values($1,$2,now())", [
    outsider,
    "outsider@test.com",
  ]);
  await as(outsider);
  assert.equal(
    (await db.query("select * from public.ap_recipes")).rows.length,
    0,
  );
  assert.equal(
    (await db.query("select * from public.ap_kitchen_entries")).rows.length,
    0,
  );
  await assert.rejects(
    () => db.query("select public.ap_snapshot_v2($1)", [b]),
    /No access/,
  );
  await db.close();
});
