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
test("weight-table product blocks keep the complete description, brand and catch weights separate", () => {
  const text = `Nebraskaland
Customer Number  Completed
11612  9/20/2026
Item Brand QTY DLV Tot Wgt Price Total
Description
Catch Weight List
Product Of
8500020 SEAF 2 2 20.48 7.3900 $151.35
FRESH 3-4 SALMON FILLETS 10LB
10.21, 10.27
1000554 5 5 383.31 1.0900 $417.81
WOGS 22HEADS 3.00LB
77.00, 76.82, 76.52, 77.00, 75.97
1030088 POULTRY 1 1 40.00 1.1900 $47.60
GIZZARDS CHIX 40LB FULL CASE
40.00
2013157 IBP 1 1 65.90 9.9900 $658.34
OUT SKIRT CH IBP
65.90
2021524 1 1 52.40 1.4900 $78.08
NECKBONE IOWA PREMIUM
52.40
4050008 INDI 5 5 319.15 1.1900 $379.79
CALIS - INDIANA COV 6PCS
68.83, 66.48, 55.38, 66.58, 61.88
4092234 IBP 4 4 202.50 2.1900 $443.48
RIBS - IBP 4/2 MED COV
49.00, 53.20, 49.00, 51.30`;
  const result = parseInvoice(text);
  assert.equal(result.issue_date, "2026-09-20");
  assert.equal(result.lines.length, 7);
  const salmon = result.lines[0];
  assert.equal(salmon.description, "FRESH 3-4 SALMON FILLETS 10LB");
  assert.equal(salmon.brand, "SEAF");
  assert.equal(salmon.sku, "8500020");
  assert.equal(salmon.quantity, "20.48");
  assert.equal(salmon.stock_quantity, "20.48");
  assert.equal(salmon.unit, "lb");
  assert.equal(salmon.delivered_quantity, "2");
  assert.equal(salmon.amount, "151.35");
  assert.equal(salmon.catch_weights, "10.21, 10.27");
  assert.equal(result.lines[1].description, "WOGS 22HEADS 3.00LB");
  assert.equal(result.lines[1].brand, "");
  assert.equal(result.lines[1].quantity, "383.31");
  assert.equal(result.lines[2].description, "GIZZARDS CHIX 40LB FULL CASE");
  assert.equal(result.lines[2].quantity, "40");
  assert.equal(result.lines[3].description, "OUT SKIRT CH IBP");
  assert.equal(
    result.lines[3].unit,
    "",
    "do not invent units from an unlabelled weight column",
  );
  assert.equal(result.lines[6].description, "RIBS - IBP 4/2 MED COV");
  assert.equal(
    result.total,
    "",
    "the cropped screenshot has no printed invoice total",
  );
});
test("split table headers, wrapped descriptions and numeric weight lists do not create extra products", () => {
  const result = parseInvoice(
    `Invoice Date\n09/20/2026\nItem\nBrand\nQTY DLV\nTot Wgt\nPrice Total\n8500020 SEAF 2 2 20.48 7.3900 $151.35\nFRESH 3-4 SALMON\nFILLETS 10LB\n10.21, 10.27\nSubtotal $151.35\nThank you for your business\nPage 1 of 2\nItem Brand QTY DLV Tot Wgt Price Total\n1030088 POULTRY 1 1 40.00 1.1900 $47.60\nGIZZARDS CHIX 40LB FULL CASE\n40.00\nInvoice Total $198.95`,
  );
  assert.equal(result.lines.length, 2);
  assert.equal(result.lines[0].description, "FRESH 3-4 SALMON FILLETS 10LB");
  assert.equal(result.lines[1].description, "GIZZARDS CHIX 40LB FULL CASE");
  assert.equal(result.total, "198.95");
  assert.equal(result.issue_date, "2026-09-20");
});
test("missing descriptions and nonreconciling weight stay unresolved instead of using brand or code", () => {
  const result = parseInvoice(
    `Item Brand QTY DLV Tot Wgt Price Total\n8500020 SEAF 2 2 20.48 7.3900 $151.35\n10.21, 10.27\n1030088 POULTRY 1 1 40.00 1.1900 $99.00\nGIZZARDS CHIX 40LB FULL CASE\n40.00\nTotal $250.35`,
  );
  assert.equal(result.lines.length, 2);
  assert.equal(result.lines[0].description, "");
  assert.equal(result.lines[0].brand, "SEAF");
  assert.equal(result.lines[1].quantity, "");
  assert(
    result.lines[1].reader_notes.some((n) => n.includes("does not match")),
  );
});
