import test from "node:test";
import assert from "node:assert/strict";
import { productCosts, recipeCost } from "../src/core/kitchen.js";
const state = {
  products: [{ id: "rice", name: "Rice", unit: "bag", active: true }],
  invoices: [
    { id: "a", number: "Older", status: "Approved", issue_date: "2026-01-01" },
    { id: "b", number: "Newer", status: "Approved", issue_date: "2026-02-01" },
    { id: "c", number: "Void", status: "Void", issue_date: "2026-03-01" },
  ],
  invoice_lines: [
    {
      invoice_id: "a",
      product_id: "rice",
      amount_cents: 1200,
      stock_quantity: 24,
    },
    {
      invoice_id: "b",
      product_id: "rice",
      amount_cents: 1200,
      stock_quantity: 12,
    },
    {
      invoice_id: "b",
      product_id: "rice",
      amount_cents: 1300,
      stock_quantity: 12,
    },
    {
      invoice_id: "c",
      product_id: "rice",
      amount_cents: 9000,
      stock_quantity: 1,
    },
  ],
  inventory_moves: [
    { product_id: "rice", quantity: 24 },
    { product_id: "rice", quantity: -1 },
  ],
};
const recipe = {
  yield_portions: 8,
  selling_price_cents: 500,
  target_food_percent: 30,
  ingredients: [{ product_id: "rice", quantity: 2, unit: "bag" }],
};
test("recipe cost uses latest approved invoice aggregated per inventory unit", () => {
  const cost = productCosts(state).get("rice");
  assert.equal(cost.cents, 2500 / 24);
  assert.equal(cost.number, "Newer");
  const c = recipeCost(state, recipe, 4);
  assert.equal(c.total, 104);
  assert.equal(c.perPortion, 26);
  assert.equal(c.foodPercent, 5.2);
  assert.equal(c.contribution, 474);
  assert.equal(c.lines[0].stock, 23);
});
test("missing costs and invalid quantities never become free food cost", () => {
  assert.equal(recipeCost({ ...state, invoice_lines: [] }, recipe).total, null);
  assert.equal(recipeCost(state, { ...recipe, yield_portions: 0 }).total, null);
  assert.equal(
    recipeCost(state, {
      ...recipe,
      ingredients: [{ ...recipe.ingredients[0], unit: "lb" }],
    }).total,
    null,
  );
  assert.equal(recipeCost(state, { ...recipe, ingredients: [] }).total, null);
});
test("preparation scaling rounds up to inventory precision", () => {
  const c = recipeCost(
    state,
    {
      ...recipe,
      yield_portions: 3,
      ingredients: [{ ...recipe.ingredients[0], quantity: 1 }],
    },
    1,
  );
  assert.equal(c.lines[0].quantity, 0.334);
});
