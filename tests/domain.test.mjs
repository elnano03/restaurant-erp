import test from "node:test";
import assert from "node:assert/strict";
import {
  emptyState,
  applyCommand,
  invoiceTotal,
  invoicePaid,
  balance,
  invoiceStatus,
  aging,
  cents,
  uid,
  validateBackup,
  normalizeStatus,
} from "../src/core/domain.js";
import { csvText } from "../src/core/export.js";
const now = "2026-09-21T16:00:00Z";
const supplier = {
  business_name: "Test Vendor",
  status: "Active",
  terms_days: 30,
  email: "test@example.com",
};
const bill = {
  number: "INV-1",
  issue_date: "2026-09-01",
  due_date: "2026-09-20",
  subtotal_cents: 10000,
  tax_cents: 600,
  shipping_cents: 500,
  discount_cents: 100,
  category: "Food & Beverages",
};
function setup() {
  let s = emptyState();
  const sid = uid(),
    iid = uid();
  s = applyCommand(
    s,
    { id: sid, type: "supplier.save", payload: supplier },
    "Owner",
    "admin",
    now,
  );
  s = applyCommand(
    s,
    { id: iid, type: "invoice.save", payload: { ...bill, supplier_id: sid } },
    "Owner",
    "admin",
    now,
  );
  return { s, sid, iid };
}
function run(s, type, payload, role = "admin", id = uid()) {
  return applyCommand(s, { id, type, payload }, "Tester", role, now);
}
test("money parsing is exact and rejects malformed amounts", () => {
  assert.equal(cents("123.45"), 12345);
  assert.equal(cents("0.1") + cents("0.2"), 30);
  for (const x of ["-1", "1.001", "NaN", "Infinity", "1e4", ""])
    assert.throws(() => cents(x));
});
test("draft -> approved -> partial -> paid -> reversed; arithmetic and audit", () => {
  let { s, iid } = setup();
  assert.equal(invoiceTotal(s.invoices[0]), 11000);
  assert.equal(invoiceStatus(s, s.invoices[0], "2026-09-21"), "Draft");
  s = run(s, "invoice.approve", { id: iid, version: 1 });
  s = run(s, "payment.record", {
    invoice_id: iid,
    amount_cents: 3000,
    date: "2026-09-21",
    method: "ACH",
  });
  assert.equal(balance(s, s.invoices[0]), 8000);
  assert.equal(invoiceStatus(s, s.invoices[0], "2026-09-19"), "Partial");
  s = run(s, "payment.record", {
    invoice_id: iid,
    amount_cents: 8000,
    date: "2026-09-21",
    method: "Check",
  });
  assert.equal(invoiceStatus(s, s.invoices[0]), "Paid");
  s = run(s, "payment.reverse", {
    id: s.payments[0].id,
    reason: "Duplicate bank entry",
  });
  assert.equal(balance(s, s.invoices[0]), 3000);
  assert.equal(invoicePaid(s, iid), 8000);
  assert.equal(s.audit.length, 6);
  assert.equal(s.audit[0].before.reversed_at, null);
  assert.ok(s.audit[0].after.reversed_at);
});
test("reject duplicate invoices, stale edits, payments on drafts and overpayments", () => {
  let { s, sid, iid } = setup();
  assert.throws(
    () =>
      run(s, "invoice.save", { ...bill, supplier_id: sid, number: "inv-1" }),
    /already exists/,
  );
  assert.throws(
    () => run(s, "invoice.save", { ...s.invoices[0], version: 0 }),
    /unchanged drafts/,
  );
  const p = {
    invoice_id: iid,
    amount_cents: 11001,
    date: "2026-09-21",
    method: "ACH",
  };
  assert.throws(() => run(s, "payment.record", p), /approved/);
  s = run(s, "invoice.approve", { id: iid, version: 1 });
  assert.throws(() => run(s, "payment.record", p), /exceed/);
  assert.throws(
    () => run(s, "invoice.save", { ...s.invoices[0] }),
    /unchanged drafts/,
  );
});
test("void and reversal preserve records and enforce roles", () => {
  let { s, iid } = setup();
  s = run(s, "invoice.approve", { id: iid, version: 1 });
  assert.throws(
    () =>
      run(
        s,
        "invoice.void",
        { id: iid, version: 2, reason: "Wrong invoice" },
        "accountant",
      ),
    /administrator/,
  );
  s = run(s, "payment.record", {
    invoice_id: iid,
    amount_cents: 1000,
    date: "2026-09-21",
    method: "Cash",
  });
  assert.throws(
    () =>
      run(s, "invoice.void", { id: iid, version: 2, reason: "Wrong invoice" }),
    /Reverse/,
  );
  s = run(s, "payment.reverse", {
    id: s.payments[0].id,
    reason: "Entered wrong invoice",
  });
  s = run(s, "invoice.void", {
    id: iid,
    version: 2,
    reason: "Entered wrong invoice",
  });
  assert.equal(s.invoices.length, 1);
  assert.equal(s.payments.length, 1);
  assert.equal(balance(s, s.invoices[0]), 0);
  assert.throws(() => run(s, "supplier.save", supplier, "viewer"), /read-only/);
});
test("duplicate request ID is idempotent and original state is immutable", () => {
  const { s } = setup(),
    id = uid(),
    p = { ...supplier, business_name: "Another" };
  const first = run(s, "supplier.save", p, "admin", id),
    second = run(first, "supplier.save", p, "admin", id);
  assert.equal(s.suppliers.length, 1);
  assert.equal(second.suppliers.length, 2);
  assert.equal(first, second);
});
test("aging boundaries and drafts excluded", () => {
  const { s } = setup();
  s.invoices = [];
  for (const [days, n] of [
    [0, 100],
    [1, 200],
    [30, 300],
    [31, 400],
    [60, 500],
    [61, 600],
    [90, 700],
    [91, 800],
  ]) {
    const d = new Date("2026-09-21T12:00:00Z");
    d.setUTCDate(d.getUTCDate() - days);
    s.invoices.push({
      ...bill,
      id: uid(),
      status: "Approved",
      subtotal_cents: n,
      tax_cents: 0,
      shipping_cents: 0,
      discount_cents: 0,
      due_date: d.toISOString().slice(0, 10),
    });
  }
  s.invoices.push({ ...bill, id: uid(), status: "Draft" });
  assert.deepEqual(
    aging(s, "2026-09-21").map((b) => b.value),
    [100, 500, 900, 1300, 800],
  );
});
test("backup validation rejects dangling references and overpayments", () => {
  let { s, iid } = setup();
  assert.equal(validateBackup(s), s);
  const bad = structuredClone(s);
  bad.invoices[0].supplier_id = "missing";
  assert.throws(() => validateBackup(bad));
  s = run(s, "invoice.approve", { id: iid, version: 1 });
  s.payments.push({
    id: uid(),
    invoice_id: iid,
    amount_cents: 999999,
    date: "2026-09-21",
    method: "ACH",
  });
  assert.throws(() => validateBackup(s), /overpaid/);
});
test("date validation, blocked suppliers, and CSV injection", () => {
  let { s, sid, iid } = setup();
  assert.throws(
    () =>
      run(s, "invoice.save", {
        ...bill,
        number: "2",
        supplier_id: sid,
        due_date: "2026-02-30",
      }),
    /Due date/,
  );
  s = run(s, "invoice.approve", { id: iid, version: 1 });
  s = run(s, "supplier.save", { ...s.suppliers[0], status: "Blocked" });
  assert.throws(
    () =>
      run(s, "payment.record", {
        invoice_id: iid,
        amount_cents: 1,
        date: "2026-09-21",
        method: "Cash",
      }),
    /blocked/,
  );
  assert.ok(csvText([['=HYPERLINK("x")']]).includes("'=HYPERLINK"));
  assert.equal(normalizeStatus("Activo"), "Active");
});
