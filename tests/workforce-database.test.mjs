import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { randomUUID as uuid } from "node:crypto";
const root = new URL("../", import.meta.url);
test("Workforce and sales permissions, time controls, payroll locks and atomic import", async () => {
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
  await db.exec(
    await readFile(
      new URL(
        "supabase/migrations/20260925132159_workforce_sales_operations.sql",
        root,
      ),
      "utf8",
    ),
  );
  const b = (await db.query("select id from public.ap_businesses")).rows[0].id;
  async function as(user) {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      user,
    ]);
    await db.exec("set role authenticated");
  }
  const cmd = async (action, payload, id = uuid(), business = b) =>
    (
      await db.query("select public.ap_team_command($1,$2,$3,$4) s", [
        business,
        id,
        action,
        payload,
      ])
    ).rows[0].s;
  const save = (kind, data, extra = {}) =>
    cmd("team.save", { kind, data, ...extra });
  const snap = async () =>
    (await db.query("select public.ap_team_snapshot($1) s", [b])).rows[0].s;
  await db.query(
    "insert into public.ap_business_members values($1,$2,'viewer',true)",
    [b, viewer],
  );
  await as(admin);
  const employee = {
    code: "100",
    name: "Test Employee",
    rate_cents: 1800,
    status: "Active",
  };
  let s = await save("employee", employee);
  const e = s.team_records.find((x) => x.kind === "employee");
  await assert.rejects(save("employee", employee), /unique|duplicate/i);
  const t = {
    employee_id: e.id,
    start: "2026-01-10T22:00:00-05:00",
    end: "2026-01-11T06:00:00-05:00",
    break_minutes: 30,
    status: "Approved",
  };
  s = await save("time", t);
  const time = s.team_records.find((x) => x.kind === "time");
  assert.equal(time.data.minutes, 450);
  assert.equal(time.data.rate_cents, 1800);
  await assert.rejects(save("time", t), /overlapping/);
  await assert.rejects(
    save("time", { ...t, start: "2026-01-10T22:00:00" }),
    /timezone/,
  );
  await assert.rejects(
    save("time", {
      ...t,
      start: "2099-01-10T22:00:00Z",
      end: "2099-01-11T06:00:00Z",
    }),
    /future/,
  );
  await save(
    "employee",
    { ...employee, rate_cents: 2200 },
    { id: e.id, version: e.version, reason: "Annual rate change" },
  );
  s = await save(
    "time",
    { ...t, break_minutes: 45 },
    {
      id: time.id,
      version: time.version,
      reason: "Confirmed break correction",
    },
  );
  const corrected = s.team_records.find((x) => x.id === time.id);
  assert.equal(corrected.data.rate_cents, 1800);
  assert.equal(corrected.data.minutes, 435);
  await assert.rejects(
    save("time", t, {
      id: time.id,
      version: time.version,
      reason: "Stale correction",
    }),
    /changed/,
  );
  s = await save("payrun", { from: "2026-01-10", to: "2026-01-11" });
  const pay = s.team_records.find((x) => x.kind === "payrun");
  assert.equal(pay.data.base_pay_cents, 13050);
  await assert.rejects(
    save("time", t, {
      id: time.id,
      version: corrected.version,
      reason: "Change locked punch",
    }),
    /locked/,
  );
  await assert.rejects(
    save("payrun", { from: "2026-01-10", to: "2026-01-11" }),
    /already/,
  );
  await save("leave", {
    employee_id: e.id,
    from: "2026-02-01",
    to: "2026-02-02",
    status: "Approved",
  });
  await assert.rejects(
    save("shift", {
      ...t,
      start: "2026-02-01T10:00:00-05:00",
      end: "2026-02-01T18:00:00-05:00",
      status: "Scheduled",
    }),
    /time off/,
  );
  const sale = {
    date: "2026-01-10",
    source: "POS",
    reference: "close-1",
    gross_cents: 10000,
    discounts_cents: 500,
    refunds_cents: 500,
    tax_cents: 540,
    tips_cents: 1000,
    cash_cents: 5540,
    card_cents: 5000,
    other_cents: 0,
    opening_cents: 10000,
    paid_out_cents: 1000,
    counted_cents: 14540,
    status: "Closed",
  };
  const req = uuid();
  s = await cmd("team.save", { kind: "sale", data: sale }, req);
  assert.equal(s.team_records.find((x) => x.id === req).data.net_cents, 9000);
  assert.equal(
    (
      await cmd("team.save", { kind: "sale", data: sale }, req)
    ).team_records.filter((x) => x.id === req).length,
    1,
  );
  await assert.rejects(
    save("sale", { ...sale, reference: "bad", card_cents: 0 }),
    /reconcile/,
  );
  await assert.rejects(
    save("sale", sale, { id: req, version: 1, reason: "Try changing close" }),
    /immutable/,
  );
  await cmd("team.reopen", {
    id: req,
    version: 1,
    reason: "Recount requested",
  });
  await assert.rejects(save("sale", sale), /unique|duplicate/i);
  const before = (await snap()).team_records.length;
  await assert.rejects(
    cmd("team.batch", {
      rows: [
        { kind: "sale", data: { ...sale, reference: "batch-1" } },
        { kind: "sale", data: sale },
      ],
    }),
    /unique|duplicate/i,
  );
  assert.equal((await snap()).team_records.length, before);
  await cmd("team.void_review", {
    id: pay.id,
    version: pay.version,
    reason: "Correct approved time worksheet",
  });
  await save("time", t, {
    id: time.id,
    version: corrected.version,
    reason: "Corrected after void review",
  });
  s = await save("payrun", { from: "2026-01-10", to: "2026-01-11" });
  assert.equal(
    s.team_records.filter(
      (x) => x.kind === "payrun" && x.data.status === "Reviewed",
    ).length,
    1,
  );
  await as(viewer);
  s = await snap();
  assert.equal(s.hr_enabled, false);
  assert.ok(s.team_records.every((x) => ["sale", "task"].includes(x.kind)));
  assert.ok(s.team_audit.every((x) => ["sale", "task"].includes(x.kind)));
  await assert.rejects(save("employee", { ...employee, code: "200" }), /role/);
  await assert.rejects(save("sale", { ...sale, reference: "viewer" }), /role/);
  await assert.rejects(
    db.query("select * from ap_private.team_records"),
    /permission denied/,
  );
  await as(admin);
  await cmd("team.access", { user_id: viewer, enabled: true });
  await as(viewer);
  assert.equal((await snap()).hr_enabled, true);
  await save("employee", { ...employee, code: "200" });
  await assert.rejects(
    cmd("team.access", { user_id: viewer, enabled: true }),
    /administrators/,
  );
  await as(admin);
  await cmd("team.access", { user_id: viewer, enabled: false });
  await as(viewer);
  assert.equal((await snap()).hr_enabled, false);
  await assert.rejects(
    cmd("team.save", { kind: "task", data: {} }, uuid(), uuid()),
    /No access/,
  );
  await db.exec("reset role; set role anon");
  await assert.rejects(
    db.query("select public.ap_team_snapshot($1)", [b]),
    /permission denied/,
  );
  await db.close();
});
