import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseInvoice,
  invoiceDate,
  rowsFromPdf,
} from "../src/core/invoice-reader.js";
test("extracts supplier, invoice dates and product rows without inventing missing totals", () => {
  const state = {
    suppliers: [{ id: "v", business_name: "Example Foods", status: "Active" }],
    products: [{ id: "p", name: "Chicken breast", unit: "lb", active: true }],
  };
  const result = parseInvoice(
    `Example Foods\nInvoice #: INV-100\nInvoice Date: 09/21/2026\nDue Date: 10/21/2026\nQty Description Unit Price Amount\n10 Chicken breast lb 1.29 12.90\n2 Rice case 12.50 25.00\nSubtotal 37.90\nSales Tax 2.27\nInvoice Total 40.17`,
    state,
  );
  assert.equal(result.supplier_id, "v");
  assert.equal(result.number, "INV-100");
  assert.equal(result.issue_date, "2026-09-21");
  assert.equal(result.due_date, "2026-10-21");
  assert.equal(result.lines.length, 2);
  assert.equal(result.lines[0].product_id, "p");
  assert.equal(result.lines[0].quantity, "10");
  assert.equal(result.subtotal, "37.90");
  assert.equal(result.total, "40.17");
  assert.equal(result.tax, "2.27");
  const unknown = parseInvoice("Unknown vendor\nRice 12.50 25.00");
  assert.equal(unknown.total, "");
  assert.equal(unknown.lines[0].quantity, "");
  assert.equal(unknown.issue_date, "");
  assert(unknown.warnings.length > 1);
});
test("groups PDF words by row and rejects invalid dates", () => {
  assert.equal(
    rowsFromPdf([
      { str: "12.90", transform: [1, 0, 0, 1, 100, 100] },
      { str: "Chicken", transform: [1, 0, 0, 1, 10, 100] },
      { str: "Total", transform: [1, 0, 0, 1, 10, 50] },
    ]),
    "Chicken  12.90\nTotal",
  );
  assert.equal(invoiceDate("13/50/2026"), "");
  assert.equal(invoiceDate("02/30/2026"), "");
  assert.equal(invoiceDate("2026-09-21"), "2026-09-21");
});
