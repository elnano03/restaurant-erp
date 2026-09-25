import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
test("recipe editor and kitchen confirmation submit correct ingredient units and quantities", async () => {
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
    entryPoints: ["src/ui/kitchen.jsx"],
    outfile: "test-results/kitchen-ui.mjs",
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
  const C = await import("../test-results/kitchen-ui.mjs");

  const calls = [];
  const onSubmit = async (type, payload) => calls.push({ type, payload });
  const state = {
    products: [{ id: "p", name: "Rice", unit: "lb", active: true }],
    recipes: [],
    kitchen_entries: [],
    invoices: [
      { id: "i", number: "I1", status: "Approved", issue_date: "2026-01-01" },
    ],
    invoice_lines: [
      {
        invoice_id: "i",
        product_id: "p",
        amount_cents: 2000,
        stock_quantity: 10,
      },
    ],
    inventory_moves: [{ product_id: "p", quantity: 10 }],
  };
  render(
    React.createElement(C.Recipes, {
      state,
      onSubmit,
      canWrite: true,
      navigate: () => {},
    }),
  );
  await user.click(screen.getByRole("button", { name: "New recipe" }));
  await user.type(screen.getByLabelText("Recipe name"), "Rice side");
  await user.clear(screen.getByLabelText("Yield (portions per recipe)"));
  await user.type(screen.getByLabelText("Yield (portions per recipe)"), "4");
  await user.selectOptions(screen.getByLabelText("Ingredient 1"), "p");
  await user.type(screen.getByLabelText("Quantity (lb)"), "2");
  await user.click(screen.getByRole("button", { name: "Save recipe" }));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].type, "recipe.save");
  assert.equal(calls[0].payload.ingredients[0].unit, "lb");
  assert.equal(Number(calls[0].payload.ingredients[0].quantity), 2);
  const recipe = { ...calls[0].payload, id: "r", version: 1 };
  cleanup();
  render(
    React.createElement(C.Kitchen, {
      state: { ...state, recipes: [recipe] },
      onSubmit,
      canWrite: true,
      isAdmin: true,
      navigate: () => {},
    }),
  );
  await user.selectOptions(screen.getByLabelText("Recipe"), "r");
  await user.type(screen.getByLabelText("Portions prepared"), "2");
  await user.type(
    screen.getByLabelText("Reason / batch reference"),
    "Lunch batch",
  );
  const post = screen.getByRole("button", { name: "Post & deduct inventory" });
  assert.equal(post.disabled, true);
  await user.click(screen.getByRole("checkbox"));
  assert.equal(post.disabled, false);
  await user.click(post);
  assert.equal(calls[1].type, "kitchen.post");
  assert.equal(calls[1].payload.quantity, 2);
  assert.equal(calls[1].payload.recipe_version, 1);
  assert.equal(calls[1].payload.reviewed, true);
  cleanup();
  render(
    React.createElement(C.Kitchen, {
      state,
      onSubmit,
      canWrite: false,
      isAdmin: false,
      navigate: () => {},
    }),
  );
  assert.equal(
    screen.queryByRole("button", { name: "Post & deduct inventory" }),
    null,
  );
  cleanup();
  dom.window.close();
});
