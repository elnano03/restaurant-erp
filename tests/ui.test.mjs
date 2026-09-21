import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
test("mounted React workflow: supplier, invoice, partial payment, reversal, reports and restore", async () => {
  const dom = new JSDOM(
    '<!doctype html><html><body><div id="root"></div></body></html>',
    { url: "http://localhost:4173/" },
  );
  for (const key of [
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
    Object.defineProperty(globalThis, key, {
      value: dom.window[key],
      configurable: true,
      writable: true,
    });
  Object.defineProperty(globalThis, "navigator", {
    value: dom.window.navigator,
    configurable: true,
  });
  navigator.locks = { request: async (_name, fn) => fn() };
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const dir = fileURLToPath(new URL("../test-results/", import.meta.url));
  await mkdir(dir, { recursive: true });
  await build({
    entryPoints: [fileURLToPath(new URL("../src/App.jsx", import.meta.url))],
    outfile: dir + "ui-bundle.mjs",
    bundle: true,
    platform: "node",
    format: "esm",
    packages: "external",
    jsx: "automatic",
    loader: { ".css": "empty" },
    define: { "import.meta.env": "{}" },
  });
  const React = await import("react"),
    { HashRouter } = await import("react-router-dom"),
    { render, screen, within, waitFor, cleanup } =
      await import("@testing-library/react"),
    user = (await import("@testing-library/user-event")).default.setup({
      document: dom.window.document,
    });
  const { default: App } = await import("../test-results/ui-bundle.mjs");
  render(React.createElement(HashRouter, null, React.createElement(App)));
  await user.click(
    screen.getByRole("button", { name: /Open local workspace/ }),
  );
  await screen.findByRole("heading", { name: "Accounts payable" });
  assert.match(document.body.textContent, /No outstanding invoices/);
  await user.click(
    screen.getByRole("button", { name: "Suppliers", exact: true }),
  );
  await user.click(
    screen.getByRole("button", { name: "New supplier", exact: true }),
  );
  await user.type(screen.getByLabelText("Business name *"), "UI Test Supplier");
  await user.type(screen.getByLabelText("Email"), "ui@example.com");
  await user.click(screen.getByRole("button", { name: "Save supplier" }));
  await screen.findByText("UI Test Supplier", { selector: "td strong" });
  await user.click(
    screen.getByRole("button", { name: "Invoices", exact: true }),
  );
  await user.click(
    screen.getByRole("button", { name: "New invoice", exact: true }),
  );
  await user.selectOptions(
    screen.getByLabelText("Supplier *"),
    within(screen.getByLabelText("Supplier *")).getByRole("option", {
      name: "UI Test Supplier",
    }).value,
  );
  await user.type(screen.getByLabelText("Invoice number *"), "UI-001");
  await user.type(screen.getByLabelText("Subtotal ($) *"), "100.00");
  await user.click(screen.getByRole("button", { name: "Save draft" }));
  await screen.findByRole("button", { name: "UI-001", exact: true });
  await user.click(screen.getByRole("button", { name: "UI-001", exact: true }));
  await user.click(screen.getByRole("button", { name: "Approve invoice" }));
  await user.click(screen.getByRole("button", { name: "Confirm" }));
  await waitFor(() => assert.equal(document.querySelector("dialog"), null));
  await user.click(screen.getByRole("button", { name: "Pay", exact: true }));
  await user.clear(screen.getByLabelText("Amount ($) *"));
  await user.type(screen.getByLabelText("Amount ($) *"), "40.00");
  await user.click(
    screen.getByRole("button", { name: "Record payment", exact: true }),
  );
  await waitFor(() =>
    assert.match(document.querySelector("tbody").textContent, /\$60\.00/),
  );
  let saved = JSON.parse(localStorage.getItem("sintech-ap-v1-local"));
  assert.equal(saved.payments[0].amount_cents, 4000);
  await user.click(
    screen.getByRole("button", { name: "Payments", exact: true }),
  );
  await user.click(
    screen.getByRole("button", { name: "Reverse", exact: true }),
  );
  await user.type(
    screen.getByLabelText("Reason *"),
    "Incorrect payment reference",
  );
  await user.click(screen.getByRole("button", { name: "Confirm" }));
  await waitFor(() =>
    assert.ok(
      JSON.parse(localStorage.getItem("sintech-ap-v1-local")).payments[0]
        .reversed_at,
    ),
  );
  await user.click(
    screen.getByRole("button", { name: "Suppliers", exact: true }),
  );
  await user.click(
    screen.getByRole("button", { name: "Statement", exact: true }),
  );
  await screen.findByRole("heading", { name: "Supplier statement" });
  assert.match(document.body.textContent, /Total outstanding: \$100.00/);
  await user.click(
    screen.getByRole("button", { name: "Settings", exact: true }),
  );
  await user.clear(screen.getByLabelText("Business name *"));
  await user.type(screen.getByLabelText("Business name *"), "UI Restaurant");
  await user.click(screen.getByRole("button", { name: "Save settings" }));
  await waitFor(() =>
    assert.equal(
      JSON.parse(localStorage.getItem("sintech-ap-v1-local")).settings
        .business_name,
      "UI Restaurant",
    ),
  );
  saved = JSON.parse(localStorage.getItem("sintech-ap-v1-local"));
  assert.equal(saved.audit.length, 6);
  await user.click(screen.getByRole("button", { name: "Switch workspace" }));
  await user.click(
    screen.getByRole("button", { name: /Explore with sample data/ }),
  );
  await screen.findByRole("heading", { name: "Accounts payable" });
  assert.equal(
    JSON.parse(localStorage.getItem("sintech-ap-v1-local")).suppliers.length,
    1,
  );
  assert.equal(
    JSON.parse(localStorage.getItem("sintech-ap-v1-demo")).suppliers.length,
    3,
  );
  await user.click(
    screen.getByRole("button", { name: "Settings", exact: true }),
  );
  const file = new dom.window.File([JSON.stringify(saved)], "backup.json", {
    type: "application/json",
  });
  file.text = async () => JSON.stringify(saved);
  await user.upload(document.querySelector("input[type=file]"), file);
  await screen.findByRole("heading", { name: "Restore local backup" });
  await user.click(screen.getByRole("button", { name: "Confirm" }));
  await waitFor(() =>
    assert.equal(
      JSON.parse(localStorage.getItem("sintech-ap-v1-demo")).suppliers.length,
      1,
    ),
  );
  assert.equal(
    JSON.parse(localStorage.getItem("sintech-ap-v1-demo-before-restore"))
      .suppliers.length,
    3,
  );
  cleanup();
  dom.window.close();
});
