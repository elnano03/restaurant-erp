import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
await mkdir("test-results", { recursive: true });
await build({
  entryPoints: ["src/core/operations.js"],
  outfile: "test-results/operations.mjs",
  bundle: true,
  format: "esm",
  platform: "node",
});
const { historicalRows, compareQuotes } =
  await import("../test-results/operations.mjs");
test("historical cutoff respects approvals, reversals, credits and New York dates", () => {
  const i = {
    id: "i",
    supplier_id: "s",
    number: "1",
    issue_date: "2026-01-01",
    due_date: "2026-01-02",
    status: "Void",
    subtotal_cents: 10000,
    tax_cents: 0,
    shipping_cents: 0,
    discount_cents: 0,
    approved_at: "2026-01-02T18:00:00Z",
    voided_at: "2026-01-10T18:00:00Z",
  };
  const s = {
    suppliers: [{ id: "s", business_name: "Vendor" }],
    invoices: [i],
    payments: [
      {
        invoice_id: "i",
        amount_cents: 2000,
        date: "2026-01-03",
        reversed_at: "2026-01-06T02:00:00Z",
      },
    ],
    credit_allocations: [
      {
        invoice_id: "i",
        amount_cents: 1000,
        date: "2026-01-04",
        reversed_at: null,
      },
    ],
  };
  assert.equal(historicalRows(s, "2026-01-01").length, 0);
  assert.equal(historicalRows(s, "2026-01-04")[0].outstanding, 7000);
  assert.equal(historicalRows(s, "2026-01-05")[0].outstanding, 9000);
  assert.equal(historicalRows(s, "2026-01-10").length, 0);
});
test("comparison keeps brands and units separate and uses latest supplier quote", () => {
  const q = (id, supplier_id, unit, brand, date, unit_cents) => ({
    id,
    supplier_id,
    product: "Beef",
    unit,
    brand,
    date,
    unit_cents,
    active: true,
    version: 1,
  });
  const s = {
    quotes: [
      q("a", "s1", "lb", "A", "2026-01-01", 100),
      q("b", "s1", "lb", "A", "2026-01-02", 200),
      q("c", "s2", "lb", "A", "2026-01-01", 150),
      q("d", "s2", "case", "A", "2026-01-01", 50),
      q("e", "s2", "lb", "B", "2026-01-01", 50),
    ],
  };
  const g = compareQuotes(s, [], "2026-01-03");
  assert.equal(g.length, 3);
  assert.equal(g.find((x) => x.length === 2)[0].id, "c");
  assert.equal(compareQuotes(s, ["s1"], "2026-01-03")[0][0].id, "b");
});
