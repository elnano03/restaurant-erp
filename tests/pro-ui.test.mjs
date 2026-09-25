import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
test("PRO count confirmation, stock policies and payment holds", async () => {
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
    entryPoints: ["src/ui/pro.jsx"],
    outfile: "test-results/pro-ui.mjs",
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
  const C = await import("../test-results/pro-ui.mjs");

  const calls = [];
  const onSubmit = async (type, payload) => calls.push({ type, payload });
  const state = {
    products: [{ id: "p", name: "Rice", unit: "lb", active: true, version: 1 }],
    invoices: [
      {
        id: "i",
        number: "I1",
        supplier_id: "s",
        status: "Approved",
        issue_date: "2026-01-01",
        due_date: "2026-01-31",
        subtotal_cents: 2000,
        tax_cents: 0,
        shipping_cents: 0,
        discount_cents: 0,
        version: 2,
      },
    ],
    payments: [],
    suppliers: [{ id: "s", business_name: "Vendor", status: "Active" }],
    inventory_moves: [{ product_id: "p", quantity: 10 }],
    invoice_lines: [],
    stock_counts: [],
  };
  render(
    React.createElement(C.StockCounts, { state, onSubmit, isAdmin: true }),
  );
  await user.click(screen.getByRole("button", { name: "Start count" }));
  await user.type(screen.getByLabelText("Count Rice"), "0");
  await user.type(
    screen.getByLabelText("Count reference / reason"),
    "Weekly count",
  );
  assert.equal(
    screen.getByRole("button", { name: "Post count & reconcile" }).disabled,
    true,
  );
  await user.click(screen.getByRole("checkbox"));
  await user.click(
    screen.getByRole("button", { name: "Post count & reconcile" }),
  );
  assert.equal(calls[0].type, "stock.count");
  assert.equal(calls[0].payload.lines[0].counted, 0);
  assert.equal(calls[0].payload.lines[0].expected, 10);
  cleanup();
  render(
    React.createElement(C.StockDesk, {
      state,
      onSubmit,
      isAdmin: true,
      navigate: () => {},
    }),
  );
  await user.click(screen.getByRole("button", { name: "Set levels" }));
  await user.clear(screen.getByLabelText("Minimum quantity"));
  await user.type(screen.getByLabelText("Minimum quantity"), "5");
  await user.clear(screen.getByLabelText("Target quantity"));
  await user.type(screen.getByLabelText("Target quantity"), "20");
  await user.click(screen.getByRole("button", { name: "Save levels" }));
  assert.equal(calls[1].payload.target_stock, 20);
  assert.equal(calls[1].payload.version, 1);
  cleanup();
  render(
    React.createElement(C.PayablesDesk, {
      state,
      onSubmit,
      canWrite: true,
      open: () => {},
      navigate: () => {},
    }),
  );
  await user.click(screen.getByRole("button", { name: "Hold payment" }));
  await user.type(screen.getByLabelText("Reason"), "Review unit prices");
  await user.click(screen.getByRole("button", { name: "Confirm" }));
  assert.equal(calls[2].type, "invoice.hold");
  assert.equal(calls[2].payload.hold, true);
  assert.equal(calls[2].payload.version, 2);
  cleanup();
  dom.window.close();
});
