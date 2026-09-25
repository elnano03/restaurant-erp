import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
const admin = "00000000-0000-4000-8000-000000000001",
  accountant = "00000000-0000-4000-8000-000000000002",
  viewer = "00000000-0000-4000-8000-000000000003",
  outsider = "00000000-0000-4000-8000-000000000004";
test("real PostgreSQL migration, financial commands, role enforcement, RLS and legacy import", async (t) => {
  const db = new PGlite();
  await db.exec(
    `create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;create function auth.jwt() returns jsonb language sql as $$ select jsonb_build_object('email','test@example.com') $$;grant usage on schema public,auth to authenticated,anon;grant execute on all functions in schema auth to authenticated,anon;insert into auth.users values('${admin}'),('${accountant}'),('${viewer}'),('${outsider}');`,
  );
  await db.exec(
    await readFile(
      new URL("../supabase/001_accounts_payable.sql", import.meta.url),
      "utf8",
    ),
  );
  await db.exec(
    `insert into public.ap_members(user_id,role) values('${admin}','admin'),('${accountant}','accountant'),('${viewer}','viewer');`,
  );
  async function actor(id) {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
    await db.exec("set role authenticated");
  }
  async function cmd(action, payload, id = crypto.randomUUID()) {
    return (
      await db.query("select public.ap_command($1,$2,$3) as s", [
        id,
        action,
        JSON.stringify(payload),
      ])
    ).rows[0].s;
  }
  await actor(admin);
  const sid = crypto.randomUUID(),
    iid = crypto.randomUUID();
  await t.test(
    "creates suppliers and invoices; approves invoice; rejects duplicates and stale writes",
    async () => {
      await cmd(
        "supplier.save",
        { business_name: "Vendor", status: "Active", terms_days: 30 },
        sid,
      );
      await assert.rejects(
        cmd("supplier.save", {
          business_name: "vendor",
          status: "Active",
          terms_days: 30,
        }),
        /already exists/,
      );
      const bill = {
        supplier_id: sid,
        number: "INV-1",
        issue_date: "2020-01-01",
        due_date: "2020-01-31",
        subtotal_cents: 10000,
        tax_cents: 600,
        shipping_cents: 0,
        discount_cents: 100,
      };
      await cmd("invoice.save", bill, iid);
      await assert.rejects(cmd("invoice.save", bill), /already exists/);
      await assert.rejects(
        cmd("invoice.approve", { id: iid, version: 0 }),
        /changed/,
      );
      const s = await cmd("invoice.approve", { id: iid, version: 1 });
      assert.equal(s.invoices[0].status, "Approved");
    },
  );
  const paymentId = crypto.randomUUID(),
    payment = {
      invoice_id: iid,
      amount_cents: 3000,
      date: "2020-02-01",
      method: "ACH",
    };
  await t.test(
    "payments are atomic, idempotent and cannot overpay",
    async () => {
      await cmd("payment.record", payment, paymentId);
      let s = await cmd("payment.record", payment, paymentId);
      assert.equal(s.payments.length, 1);
      await assert.rejects(
        cmd("payment.record", { ...payment, amount_cents: 8000 }),
        /exceeds/,
      );
      await assert.rejects(
        cmd("invoice.void", { id: iid, version: 2, reason: "Wrong invoice" }),
        /Reverse payments/,
      );
      await assert.rejects(
        cmd("payment.record", { ...payment, amount_cents: 10 }, paymentId),
        /already used/,
      );
    },
  );
  await t.test(
    "viewer cannot mutate; accountant cannot reverse; direct table writes denied",
    async () => {
      await actor(viewer);
      await assert.rejects(
        cmd("supplier.save", {
          business_name: "No",
          status: "Active",
          terms_days: 0,
        }),
        /write access/,
      );
      await assert.rejects(
        db.exec("update public.ap_suppliers set business_name='Tampered'"),
        /permission denied/,
      );
      await assert.rejects(
        db.exec("delete from public.ap_audit"),
        /permission denied/,
      );
      await actor(accountant);
      await assert.rejects(
        cmd("payment.reverse", { id: paymentId, reason: "Wrong payment" }),
        /administrators/,
      );
      await actor(outsider);
      assert.equal(
        (await db.query("select * from public.ap_invoices")).rows.length,
        0,
      );
      await assert.rejects(
        db.exec("select public.ap_snapshot()"),
        /not been authorized/,
      );
      await db.exec("reset role;set role anon");
      await assert.rejects(
        db.exec("select public.ap_snapshot()"),
        /permission denied/,
      );
      await actor(admin);
    },
  );
  await t.test(
    "admin reversal and void preserve audit trail and original payment",
    async () => {
      let s = await cmd("payment.reverse", {
        id: paymentId,
        reason: "Duplicate transaction",
      });
      assert.ok(s.payments[0].reversed_at);
      s = await cmd("invoice.void", {
        id: iid,
        version: 2,
        reason: "Wrong invoice",
      });
      assert.equal(s.invoices[0].status, "Void");
      assert.equal(s.payments.length, 1);
      assert.ok(s.audit.find((a) => a.type === "payment.reverse").before);
    },
  );
  await t.test(
    "legacy import is repeatable and opening balances remain drafts",
    async () => {
      await db.exec(
        `reset role;create table public."Suppliers"(id integer,business_name text,phone text,email text,category text,status text,balance numeric);insert into public."Suppliers" values(1,'Legacy Vendor','','','Food','Activo',125.25);`,
      );
      const sql = await readFile(
        new URL("../supabase/002_import_legacy_suppliers.sql", import.meta.url),
        "utf8",
      );
      await db.exec(sql);
      await db.exec(sql);
      assert.equal(
        (
          await db.query(
            "select count(*)::int as n from public.ap_suppliers where legacy_id='1'",
          )
        ).rows[0].n,
        1,
      );
      const invoice = (
        await db.query(
          "select * from public.ap_invoices where number='OPENING-1'",
        )
      ).rows[0];
      assert.equal(invoice.status, "Draft");
      assert.equal(Number(invoice.subtotal_cents), 12525);
      await db.exec(
        await readFile(
          new URL("../supabase/003_protect_legacy_table.sql", import.meta.url),
          "utf8",
        ),
      );
      await actor(admin);
      await assert.rejects(
        db.exec('select * from public."Suppliers"'),
        /permission denied/,
      );
    },
  );
  await db.close();
});
