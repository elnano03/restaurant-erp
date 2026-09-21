import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
import { parseInvoice } from "../src/core/invoice-reader.js";
test("supplier profile exposes create/edit; invoice review posts matched quantities only after confirmation", async () => {
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
  URL.createObjectURL = () => "blob:test";
  URL.revokeObjectURL = () => {};
  window.confirm = () => true;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const state = {
    business_id: "b",
    settings: { terms_days: 30 },
    suppliers: [
      {
        id: "s",
        business_name: "Example Foods",
        status: "Active",
        terms_days: 30,
      },
    ],
    products: [],
    categories: [{ id: "c", name: "Food", active: true }],
    documents: [],
    invoice_imports: [],
    invoices: [],
    payments: [],
    credits: [],
  };
  const parsed = parseInvoice(
    "Example Foods\nInvoice #: I-1\nInvoice Date: 01/01/2026\n2 Rice case 12.50 25.00\nSubtotal 25.00\nInvoice Total 25.00",
    state,
  );
  await mkdir("test-results", { recursive: true });
  await build({
    entryPoints: ["src/ui/invoice-import.jsx"],
    outfile: "test-results/import-ui.mjs",
    bundle: true,
    platform: "node",
    format: "esm",
    packages: "external",
    jsx: "automatic",
    loader: { ".css": "empty" },
    plugins: [
      {
        name: "mock-network-and-reader",
        setup(b) {
          b.onResolve({ filter: /core\/repository$/ }, () => ({
            path: "repo",
            namespace: "mock",
          }));
          b.onResolve({ filter: /core\/invoice-reader$/ }, () => ({
            path: "reader",
            namespace: "mock",
          }));
          b.onLoad({ filter: /.*/, namespace: "mock" }, (a) => ({
            contents:
              a.path === "repo"
                ? `export const selectedBusiness=()=> 'b';export const cloud={storage:{from:()=>({upload:async()=>({error:null})})}};`
                : `export const parseInvoice=()=>(${JSON.stringify(parsed)});export const fileHash=async()=> '${"a".repeat(64)}';export const validateInvoiceFile=()=>{};export const readInvoice=async()=> 'sample';`,
            loader: "js",
          }));
        },
      },
    ],
  });
  await build({
    entryPoints: ["src/ui/operations.jsx"],
    outfile: "test-results/profile-ui.mjs",
    bundle: true,
    platform: "node",
    format: "esm",
    packages: "external",
    jsx: "automatic",
    loader: { ".css": "empty" },
    define: { "import.meta.env": "{}" },
  });
  const React = await import("react"),
    { render, screen, waitFor, cleanup } =
      await import("@testing-library/react"),
    user = (await import("@testing-library/user-event")).default.setup({
      document: dom.window.document,
    });
  const { SupplierProfile } = await import("../test-results/profile-ui.mjs");
  let opened;
  render(
    React.createElement(SupplierProfile, {
      state,
      canWrite: true,
      navigate: () => {},
      open: (x) => (opened = x),
    }),
  );
  await user.click(screen.getByRole("button", { name: "New supplier" }));
  assert.deepEqual(opened, { kind: "supplier" });
  await user.click(screen.getByRole("button", { name: "Edit supplier" }));
  assert.equal(opened.id, "s");
  cleanup();
  const { InvoiceImport } = await import("../test-results/import-ui.mjs");
  let posted;
  render(
    React.createElement(InvoiceImport, {
      state,
      canWrite: true,
      navigate: () => {},
      onSubmit: async (type, payload) => {
        posted = { type, payload };
        return {};
      },
    }),
  );
  await user.upload(
    screen.getByLabelText("Upload an invoice (PDF or image)"),
    new dom.window.File(["pdf"], "bill.pdf", { type: "application/pdf" }),
  );
  const button = await screen.findByRole("button", {
    name: "Post invoice & receive inventory",
  });
  assert.equal(button.disabled, true);
  await user.clear(screen.getByLabelText("Stock quantity 1"));
  await user.type(screen.getByLabelText("Stock quantity 1"), "24");
  await user.clear(screen.getByLabelText("Stock unit 1"));
  await user.type(screen.getByLabelText("Stock unit 1"), "bag");
  await user.click(screen.getByLabelText(/I checked the supplier/));
  await user.click(button);
  await waitFor(() => assert.ok(posted));
  assert.equal(posted.type, "invoice.import");
  assert.equal(posted.payload.total_cents, 2500);
  assert.equal(posted.payload.lines[0].stock_quantity, 24);
  assert.equal(posted.payload.lines[0].quantity, 2);
  assert.equal(posted.payload.lines[0].stock_unit, "bag");
  assert.equal(posted.payload.supplier_id, "s");
  assert.equal(posted.payload.reviewed, true);
  await screen.findByText(/Invoice I-1 posted/);
  cleanup();
  dom.window.close();
});
