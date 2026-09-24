// Cost estimates use the latest approved purchase, per inventory unit.
// They exclude invoice-level tax, shipping and discounts; they are not a ledger valuation.
export function productCosts(state) {
  const costs = new Map();
  const invoices = [...state.invoices]
    .filter((i) => i.status === "Approved")
    .sort(
      (a, b) =>
        b.issue_date.localeCompare(a.issue_date) || b.id.localeCompare(a.id),
    );
  for (const inv of invoices) {
    const grouped = new Map();
    for (const line of state.invoice_lines || []) {
      if (
        line.invoice_id !== inv.id ||
        !line.product_id ||
        !(Number(line.stock_quantity) > 0)
      )
        continue;
      const g = grouped.get(line.product_id) || { amount: 0, quantity: 0 };
      g.amount += Number(line.amount_cents);
      g.quantity += Number(line.stock_quantity);
      grouped.set(line.product_id, g);
    }
    for (const [id, g] of grouped)
      if (!costs.has(id))
        costs.set(id, {
          cents: g.amount / g.quantity,
          date: inv.issue_date,
          number: inv.number,
        });
  }
  return costs;
}
export function onHand(state, id) {
  return (state.inventory_moves || [])
    .filter((m) => m.product_id === id)
    .reduce((sum, m) => sum + Number(m.quantity), 0);
}
export function recipeCost(
  state,
  recipe,
  portions = Number(recipe.yield_portions),
) {
  const costs = productCosts(state);
  const lines = (recipe.ingredients || []).map((line) => {
    const product = (state.products || []).find(
      (p) => p.id === line.product_id,
    );
    const quantity =
      Math.ceil(
        ((Number(line.quantity) * Number(portions)) /
          Number(recipe.yield_portions) -
          1e-9) *
          1000,
      ) / 1000;
    const cost = costs.get(line.product_id);
    return {
      ...line,
      product,
      quantity,
      cost,
      amount:
        cost && Number.isFinite(quantity) && quantity > 0
          ? Math.round(cost.cents * quantity)
          : null,
      stock: onHand(state, line.product_id),
      valid:
        !!product?.active &&
        product.unit === line.unit &&
        Number.isFinite(quantity) &&
        quantity > 0,
    };
  });
  const complete =
    lines.length > 0 && lines.every((l) => l.amount !== null && l.valid);
  const total = complete ? lines.reduce((sum, l) => sum + l.amount, 0) : null;
  const perPortion = total === null ? null : total / Number(portions);
  const price = Number(recipe.selling_price_cents);
  return {
    lines,
    total,
    perPortion,
    foodPercent:
      perPortion !== null && price > 0 ? (perPortion / price) * 100 : null,
    contribution: perPortion !== null && price > 0 ? price - perPortion : null,
    suggested:
      perPortion !== null && Number(recipe.target_food_percent) > 0
        ? perPortion / (Number(recipe.target_food_percent) / 100)
        : null,
  };
}
export const quantityLabel = (value) =>
  Number(value).toLocaleString("en-US", { maximumFractionDigits: 3 });
