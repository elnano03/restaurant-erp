import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
test("v2 forms create categories, credits, grouped payments and supplier prices", async () => {
  const dom = new JSDOM('<div id="root"></div>', {
    url: "http://localhost:4173",
  });
  for (const k of [
    "window",
    "document",
    "HTMLElement",
    "HTMLDialogElement",
    "Node",
    "Event",
    "MouseEvent",
    "localStorage",
    "sessionStorage",
    "MutationObserver",
  ])
    Object.defineProperty(globalThis, k, {
      value: dom.window[k],
      configurable: true,
      writable: true,
    });
  Object.defineProperty(globalThis, "navigator", {
    value: dom.window.navigator,
    configurable: true,
  });
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
  window.confirm = () => true;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  await mkdir("test-results", { recursive: true });
  await build({
    entryPoints: ["src/ui/operations.jsx"],
    outfile: "test-results/v2-ui.mjs",
    bundle: true,
    platform: "node",
    format: "esm",
    packages: "external",
    jsx: "automatic",
    loader: { ".css": "empty" },
    define: { "import.meta.env": "{}" },
  });
  const React = await import("react"),
    { render, screen, cleanup } = await import("@testing-library/react"),
    user = (await import("@testing-library/user-event")).default.setup({
      document: dom.window.document,
    });
  const C = await import("../test-results/v2-ui.mjs");
  let calls = [];
  const onSubmit = async (type, payload) => calls.push({ type, payload });
  const state = {
    settings: { business_name: "Test" },
    suppliers: [{ id: "s", business_name: "Vendor", status: "Active" }],
    invoices: [
      {
        id: "i",
        supplier_id: "s",
        number: "INV1",
        status: "Approved",
        issue_date: "2026-01-01",
        due_date: "2026-01-01",
        subtotal_cents: 10000,
        tax_cents: 0,
        shipping_cents: 0,
        discount_cents: 0,
      },
    ],
    payments: [],
    categories: [],
    credits: [],
    credit_allocations: [],
    orders: [],
    quotes: [],
    plans: [],
  };
  const props = { state, onSubmit, isAdmin: true, canWrite: true };
  render(React.createElement(C.Categories, props));
  await user.click(screen.getByRole("button", { name: "New category" }));
  await user.type(screen.getByLabelText("Category name"), "Meat");
  await user.click(screen.getByRole("button", { name: "Save", exact: true }));
  assert.equal(calls.at(-1).payload.name, "Meat");
  cleanup();
  render(React.createElement(C.Credits, props));
  await user.click(screen.getByRole("button", { name: "New credit / return" }));
  await user.selectOptions(screen.getByLabelText("Supplier"), "s");
  await user.type(screen.getByLabelText("Credit note number"), "CR1");
  await user.type(screen.getByLabelText("Credit amount"), "12.34");
  await user.type(
    screen.getByLabelText("Reason / returned goods"),
    "Damaged case",
  );
  await user.click(screen.getByRole("button", { name: "Save", exact: true }));
  assert.equal(calls.at(-1).type, "credit.create");
  assert.equal(calls.at(-1).payload.amount_cents, 1234);
  cleanup();
  render(React.createElement(C.PaymentPlanner, props));
  await user.selectOptions(screen.getByLabelText("Supplier"), "s");
  await user.type(screen.getByLabelText("Allocate INV1"), "25.50");
  await user.click(
    screen.getByRole("button", { name: "Record grouped payment" }),
  );
  assert.equal(calls.at(-1).type, "payment.batch");
  assert.equal(calls.at(-1).payload.items[0].amount_cents, 2550);
  cleanup();
  render(React.createElement(C.Purchasing, props));
  await user.click(screen.getByRole("button", { name: "Add supplier price" }));
  await user.selectOptions(screen.getByLabelText("Supplier"), "s");
  await user.type(screen.getByLabelText("Product"), "Beef");
  await user.type(screen.getByLabelText("Price per unit"), "1.29");
  await user.click(screen.getByRole("button", { name: "Save", exact: true }));
  assert.equal(calls.at(-1).type, "quote.save");
  assert.equal(calls.at(-1).payload.unit_cents, 129);
  cleanup();
  const attempts = [];
  render(
    React.createElement(C.Purchasing, {
      ...props,
      state: {
        ...state,
        quotes: [
          {
            id: "quote",
            supplier_id: "s",
            product: "Rice",
            unit: "lb",
            brand: "",
            unit_cents: 100,
            date: "2026-01-01",
            active: true,
            version: 1,
          },
        ],
      },
      onSubmit: async (type, payload) => {
        attempts.push({ type, payload: structuredClone(payload) });
        if (attempts.length === 1) throw new Error("Simulated lost response");
      },
    }),
  );
  await user.type(screen.getByLabelText("Buy quantity Rice"), "2");
  await user.click(
    screen.getByRole("button", { name: "Create draft orders by supplier" }),
  );
  await screen.findByText("Simulated lost response");
  await user.click(
    screen.getByRole("button", { name: "Create draft orders by supplier" }),
  );
  assert.equal(attempts.length, 2);
  assert.equal(attempts[0].type, "order.batch");
  assert.deepEqual(
    attempts[0].payload,
    attempts[1].payload,
    "retry keeps identical order numbers and payload",
  );
  cleanup();
  render(
    React.createElement(C.Purchasing, {
      ...props,
      state: {
        ...state,
        products: [
          { id: "rice", name: "Rice inventory", unit: "bag", active: true },
        ],
      },
    }),
  );
  await user.click(screen.getByRole("button", { name: "New order" }));
  await user.selectOptions(screen.getByLabelText("Supplier"), "s");
  await user.type(screen.getByLabelText("Order number"), "MAPPED-UI");
  await user.type(screen.getByLabelText("Product 0"), "Rice");
  await user.type(screen.getByLabelText("Price 0"), "12.50");
  await user.selectOptions(
    screen.getByLabelText("Inventory product 0"),
    "rice",
  );
  await user.type(screen.getByLabelText("Stock quantity 0"), "24");
  await user.click(screen.getByRole("button", { name: "Save draft" }));
  assert.equal(calls.at(-1).payload.lines[0].stock_unit, "bag");
  assert.equal(calls.at(-1).payload.lines[0].stock_quantity, "24");
  cleanup();
  dom.window.close();
});
