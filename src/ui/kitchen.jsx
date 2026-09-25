import { useState } from "react";
import { Button, Field, Empty, Modal } from "./common";
import { money, today } from "../core/domain";
import { exportCSV } from "../core/export";
import {
  recipeCost,
  productCosts,
  onHand,
  quantityLabel as qty,
} from "../core/kitchen";
import "./kitchen.css";
const cash = (n) =>
  n === null || n === undefined ? "Cost unavailable" : money(Math.round(n));
const fresh = () => ({
  name: "",
  yield_portions: 1,
  selling_price_cents: 0,
  target_food_percent: 30,
  notes: "",
  active: true,
  ingredients: [{ product_id: "", quantity: "", unit: "" }],
});
function CostSummary({ cost }) {
  return (
    <div className="kitchen-metrics">
      <div>
        <span>Recipe cost</span>
        <strong>{cash(cost.total)}</strong>
      </div>
      <div>
        <span>Cost / portion</span>
        <strong>{cash(cost.perPortion)}</strong>
      </div>
      <div>
        <span>Food cost</span>
        <strong>
          {cost.foodPercent === null ? "—" : cost.foodPercent.toFixed(1) + "%"}
        </strong>
      </div>
      <div>
        <span>Contribution / portion</span>
        <strong>{cash(cost.contribution)}</strong>
        <small>Before labor and overhead</small>
      </div>
    </div>
  );
}
export function Recipes({ state, onSubmit, canWrite, navigate }) {
  const [edit, setEdit] = useState(null),
    [detail, setDetail] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [search, setSearch] = useState(""),
    [archived, setArchived] = useState(false);
  const recipes = state.recipes || [],
    products = state.products || [];
  const shown = recipes.filter(
    (r) =>
      (archived || r.active) &&
      r.name.toLowerCase().includes(search.toLowerCase()),
  );
  const current = edit || detail,
    cost = current ? recipeCost(state, current) : null;
  function update(k, v) {
    setEdit({ ...edit, [k]: v });
  }
  function ingredient(index, key, value) {
    setEdit({
      ...edit,
      ingredients: edit.ingredients.map((l, i) =>
        i === index
          ? {
              ...l,
              [key]: value,
              ...(key === "product_id"
                ? { unit: products.find((p) => p.id === value)?.unit || "" }
                : {}),
            }
          : l,
      ),
    });
  }
  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await onSubmit("recipe.save", edit);
      setEdit(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">KITCHEN & FOOD COST</p>
          <h1>Recipes & costs</h1>
          <p>
            Build recipes with inventory ingredients and see the cost of each
            portion.
          </p>
        </div>
        <div className="actions">
          {canWrite && (
            <Button
              onClick={() => {
                setError("");
                setEdit(fresh());
              }}
            >
              New recipe
            </Button>
          )}
          <Button
            kind="secondary"
            onClick={() =>
              exportCSV("recipe-costs.csv", [
                [
                  "Recipe",
                  "Yield portions",
                  "Batch cost USD",
                  "Cost per portion USD",
                  "Selling price USD",
                  "Food cost %",
                  "Target %",
                ],
                ...shown.map((r) => {
                  const c = recipeCost(state, r);
                  return [
                    r.name,
                    r.yield_portions,
                    c.total === null ? "" : (c.total / 100).toFixed(2),
                    c.perPortion === null
                      ? ""
                      : (c.perPortion / 100).toFixed(2),
                    r.selling_price_cents / 100,
                    c.foodPercent?.toFixed(2) || "",
                    r.target_food_percent,
                  ];
                }),
              ])
            }
          >
            Export costs
          </Button>
        </div>
      </div>
      <div className="alert info">
        Costs use the latest approved invoice for each ingredient, divided by
        its inventory quantity. Tax, freight and invoice-level discounts are
        excluded. Missing costs stay blank.
      </div>
      {!products.some((p) => p.active) && (
        <Empty title="Start with your ingredients">
          Import and confirm a supplier invoice, or add products in Inventory.
          <div className="actions">
            <Button onClick={() => navigate("/invoice-import")}>
              Import invoice
            </Button>
            <Button kind="secondary" onClick={() => navigate("/inventory")}>
              Open inventory
            </Button>
          </div>
        </Empty>
      )}
      <div className="kitchen-filters">
        <Field label="Search recipes">
          <input value={search} onChange={(e) => setSearch(e.target.value)} />
        </Field>
        <label className="inline-check">
          <input
            type="checkbox"
            checked={archived}
            onChange={(e) => setArchived(e.target.checked)}
          />{" "}
          Show inactive recipes
        </label>
      </div>
      {shown.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {[
                  "Recipe",
                  "Portions",
                  "Cost / portion",
                  "Selling price",
                  "Food cost",
                  "Status",
                  "Actions",
                ].map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const c = recipeCost(state, r);
                return (
                  <tr key={r.id}>
                    <td>
                      <strong>{r.name}</strong>
                    </td>
                    <td>{qty(r.yield_portions)}</td>
                    <td>{cash(c.perPortion)}</td>
                    <td>{cash(r.selling_price_cents)}</td>
                    <td>
                      {c.foodPercent === null
                        ? "—"
                        : c.foodPercent.toFixed(1) + "%"}
                      <small className="kitchen-meta">
                        Target {r.target_food_percent}%
                      </small>
                    </td>
                    <td>{r.active ? "Active" : "Inactive"}</td>
                    <td>
                      <div className="actions">
                        <Button kind="ghost" onClick={() => setDetail(r)}>
                          View
                        </Button>
                        {canWrite && (
                          <Button
                            kind="ghost"
                            onClick={() => {
                              setError("");
                              setEdit(structuredClone(r));
                            }}
                          >
                            Edit
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty title="No recipes yet">
          Add the actual ingredients and yield for one of your dishes to
          calculate its cost.
        </Empty>
      )}
      {current && (
        <Modal
          title={edit ? (edit.id ? "Edit recipe" : "New recipe") : detail.name}
          wide
          busy={busy}
          onClose={() => {
            setEdit(null);
            setDetail(null);
          }}
        >
          {error && (
            <div className="alert error" role="alert">
              {error}
            </div>
          )}
          {edit ? (
            <form onSubmit={save}>
              <fieldset disabled={busy} className="kitchen-fieldset">
                <div className="form-grid">
                  <Field label="Recipe name">
                    <input
                      required
                      maxLength={200}
                      value={edit.name}
                      onChange={(e) => update("name", e.target.value)}
                    />
                  </Field>
                  <Field label="Yield (portions per recipe)">
                    <input
                      type="number"
                      min="0.001"
                      max="100000"
                      step="0.001"
                      required
                      value={edit.yield_portions}
                      onChange={(e) => update("yield_portions", e.target.value)}
                    />
                  </Field>
                  <Field label="Selling price / portion ($)">
                    <input
                      type="number"
                      min="0"
                      max="100000"
                      step="0.01"
                      required
                      value={edit.selling_price_cents / 100}
                      onChange={(e) =>
                        update(
                          "selling_price_cents",
                          Math.round(Number(e.target.value) * 100),
                        )
                      }
                    />
                  </Field>
                  <Field label="Target food cost (%)">
                    <input
                      type="number"
                      min="1"
                      max="100"
                      step="0.1"
                      required
                      value={edit.target_food_percent}
                      onChange={(e) =>
                        update("target_food_percent", e.target.value)
                      }
                    />
                  </Field>
                </div>
                <h3>Ingredients for the full recipe</h3>
                <p>
                  Enter the raw quantity taken from stock, including trimming or
                  cooking loss. Use each product’s inventory unit; for 8 oz of
                  an ingredient stocked in lb, enter 0.5 lb.
                </p>
                <div className="kitchen-ingredients">
                  {edit.ingredients.map((l, i) => (
                    <div className="kitchen-ingredient" key={i}>
                      <Field label={"Ingredient " + (i + 1)}>
                        <select
                          required
                          value={l.product_id}
                          onChange={(e) =>
                            ingredient(i, "product_id", e.target.value)
                          }
                        >
                          <option value="">Choose product</option>
                          {products
                            .filter((p) => p.active || p.id === l.product_id)
                            .map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name} · {p.unit}
                                {p.active ? "" : " (inactive)"}
                              </option>
                            ))}
                        </select>
                      </Field>
                      <Field
                        label={"Quantity (" + (l.unit || "stock unit") + ")"}
                      >
                        <input
                          required
                          type="number"
                          min="0.001"
                          max="1000000"
                          step="0.001"
                          value={l.quantity}
                          onChange={(e) =>
                            ingredient(i, "quantity", e.target.value)
                          }
                        />
                      </Field>
                      <Button
                        type="button"
                        kind="ghost"
                        aria-label={"Remove ingredient " + (i + 1)}
                        disabled={edit.ingredients.length === 1}
                        onClick={() =>
                          update(
                            "ingredients",
                            edit.ingredients.filter((_, j) => j !== i),
                          )
                        }
                      >
                        Remove
                      </Button>
                    </div>
                  ))}
                </div>
                <Button
                  type="button"
                  kind="secondary"
                  disabled={edit.ingredients.length >= 100}
                  onClick={() =>
                    update("ingredients", [
                      ...edit.ingredients,
                      { product_id: "", quantity: "", unit: "" },
                    ])
                  }
                >
                  Add ingredient
                </Button>
                <Field label="Preparation instructions / notes">
                  <textarea
                    maxLength={4000}
                    rows={3}
                    value={edit.notes}
                    onChange={(e) => update("notes", e.target.value)}
                  />
                </Field>
                <label className="inline-check">
                  <input
                    type="checkbox"
                    checked={edit.active}
                    onChange={(e) => update("active", e.target.checked)}
                  />{" "}
                  Active recipe
                </label>
                <CostSummary cost={cost} />
                <p>
                  Price at target food cost:{" "}
                  <strong>{cash(cost.suggested)}</strong>. This is an
                  ingredient-cost estimate.
                </p>
                <Button>Save recipe</Button>
              </fieldset>
            </form>
          ) : (
            <>
              <p>{detail.notes || "No preparation notes."}</p>
              <CostSummary cost={cost} />
              <p>
                Yield: {qty(detail.yield_portions)} portions · Price at target:{" "}
                {cash(cost.suggested)}
              </p>
              <CostTable cost={cost} />
              <Button kind="secondary" onClick={() => window.print()}>
                Print recipe
              </Button>
            </>
          )}
        </Modal>
      )}
    </>
  );
}
function CostTable({ cost }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {[
              "Ingredient",
              "Quantity",
              "On hand",
              "Estimated cost",
              "Cost source",
            ].map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {cost.lines.map((l, i) => (
            <tr key={i}>
              <td>
                {l.product?.name || "Select ingredient"}
                {!l.valid && (
                  <small className="kitchen-warning">
                    Check active product and unit
                  </small>
                )}
              </td>
              <td>
                {qty(l.quantity)} {l.unit}
              </td>
              <td className={l.stock < l.quantity ? "kitchen-warning" : ""}>
                {qty(l.stock)} {l.unit}
              </td>
              <td>{cash(l.amount)}</td>
              <td>
                {l.cost
                  ? `${l.cost.number} · ${l.cost.date}`
                  : "No approved invoice"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
export function Kitchen({ state, onSubmit, canWrite, isAdmin, navigate }) {
  const [kind, setKind] = useState("production"),
    [recipeId, setRecipeId] = useState(""),
    [productId, setProductId] = useState(""),
    [amount, setAmount] = useState(""),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [reviewed, setReviewed] = useState(false),
    [reverse, setReverse] = useState(null),
    [reversalReason, setReversalReason] = useState("");
  const [from, setFrom] = useState(""),
    [to, setTo] = useState(today());
  const recipe = (state.recipes || []).find((r) => r.id === recipeId),
    product = (state.products || []).find((p) => p.id === productId);
  const cost =
    kind === "production" && recipe && Number(amount) > 0
      ? recipeCost(state, recipe, Number(amount))
      : null;
  const unitCost = productCosts(state).get(productId),
    wasteCost = unitCost ? unitCost.cents * Number(amount) : null;
  const valid =
    kind === "production"
      ? cost?.lines.every((l) => l.valid && l.stock + 1e-9 >= l.quantity)
      : product?.active &&
        Number(amount) > 0 &&
        onHand(state, productId) + 1e-9 >= Number(amount);
  const entries = (state.kitchen_entries || [])
    .filter((e) => (!from || e.date >= from) && (!to || e.date <= to))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const active = entries.filter((e) => !e.reversed_at),
    missing = active.filter((e) => e.cost_cents === null).length;
  async function run(fn) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  function changed(fn) {
    fn();
    setReviewed(false);
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">PREPARATION & WASTE</p>
          <h1>Kitchen usage</h1>
          <p>
            Record preparation to deduct raw ingredients, or record discarded
            stock with a reason.
          </p>
        </div>
        <Button kind="secondary" onClick={() => navigate("/recipes")}>
          Recipes & costs
        </Button>
      </div>
      <div className="alert info">
        Record each preparation once. Portions are a kitchen log, not
        finished-goods inventory or POS sales. Today’s date is assigned when you
        post.
      </div>
      {error && (
        <div className="alert error" role="alert">
          {error}
        </div>
      )}
      {canWrite && (
        <form
          className="panel kitchen-panel"
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              await onSubmit("kitchen.post", {
                kind,
                recipe_id: recipeId,
                recipe_version: recipe?.version,
                product_id: productId,
                quantity: Number(amount),
                reason,
                reviewed,
              });
              setAmount("");
              setReason("");
              setReviewed(false);
            });
          }}
        >
          <fieldset className="kitchen-fieldset" disabled={busy}>
            <h2>New kitchen entry</h2>
            <div className="form-grid">
              <Field label="Entry type">
                <select
                  value={kind}
                  onChange={(e) => changed(() => setKind(e.target.value))}
                >
                  <option value="production">Recipe preparation</option>
                  <option value="waste">Ingredient waste</option>
                </select>
              </Field>
              {kind === "production" ? (
                <Field label="Recipe">
                  <select
                    required
                    value={recipeId}
                    onChange={(e) =>
                      changed(() => {
                        setRecipeId(e.target.value);
                        setAmount("");
                      })
                    }
                  >
                    <option value="">Choose recipe</option>
                    {(state.recipes || [])
                      .filter((r) => r.active)
                      .map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name}
                        </option>
                      ))}
                  </select>
                </Field>
              ) : (
                <Field label="Ingredient">
                  <select
                    required
                    value={productId}
                    onChange={(e) =>
                      changed(() => setProductId(e.target.value))
                    }
                  >
                    <option value="">Choose product</option>
                    {(state.products || [])
                      .filter((p) => p.active)
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} · {p.unit}
                        </option>
                      ))}
                  </select>
                </Field>
              )}
              <Field
                label={
                  kind === "production"
                    ? "Portions prepared"
                    : `Quantity discarded (${product?.unit || "stock unit"})`
                }
              >
                <input
                  type="number"
                  required
                  min="0.001"
                  max="100000"
                  step="0.001"
                  value={amount}
                  onChange={(e) => changed(() => setAmount(e.target.value))}
                />
              </Field>
              <Field label="Reason / batch reference">
                <input
                  required
                  minLength={5}
                  maxLength={500}
                  placeholder="Lunch preparation / spoilage / batch reference"
                  value={reason}
                  onChange={(e) => changed(() => setReason(e.target.value))}
                />
              </Field>
            </div>
            {cost && (
              <>
                <CostTable cost={cost} />
                <p>
                  Estimated ingredient cost: <strong>{cash(cost.total)}</strong>
                </p>
              </>
            )}
            {kind === "waste" && product && (
              <p>
                Available:{" "}
                <strong>
                  {qty(onHand(state, productId))} {product.unit}
                </strong>{" "}
                · Estimated waste cost: <strong>{cash(wasteCost)}</strong>
              </p>
            )}
            {Number(amount) > 0 && !valid && (
              <p className="kitchen-warning">
                Insufficient stock or invalid ingredients. Review Inventory
                before posting.
              </p>
            )}
            <label className="inline-check">
              <input
                required
                type="checkbox"
                checked={reviewed}
                onChange={(e) => setReviewed(e.target.checked)}
              />{" "}
              I checked the quantities and this entry has not already been
              recorded.
            </label>
            <div className="actions">
              <Button disabled={!valid || !reviewed}>
                Post & deduct inventory
              </Button>
              <Button
                type="button"
                kind="ghost"
                onClick={() => navigate("/inventory")}
              >
                Open inventory
              </Button>
            </div>
          </fieldset>
        </form>
      )}
      <div className="kitchen-filters">
        <Field label="From">
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </Field>
        <Field label="Through">
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </Field>
        <Button
          kind="secondary"
          onClick={() =>
            exportCSV("kitchen-usage.csv", [
              [
                "Date",
                "Type",
                "Recipe / product",
                "Quantity",
                "Unit",
                "Estimated cost USD",
                "Status",
                "Reason",
              ],
              ...entries.map((e) => [
                e.date,
                e.kind,
                e.label,
                e.quantity,
                e.unit,
                e.cost_cents === null ? "" : (e.cost_cents / 100).toFixed(2),
                e.reversed_at ? "Reversed" : "Posted",
                e.reason,
              ]),
            ])
          }
        >
          Export kitchen log
        </Button>
      </div>
      <div className="kitchen-metrics">
        <div>
          <span>Prepared portions</span>
          <strong>
            {qty(
              active
                .filter((e) => e.kind === "production")
                .reduce((s, e) => s + Number(e.quantity), 0),
            )}
          </strong>
        </div>
        <div>
          <span>Known preparation cost</span>
          <strong>
            {cash(
              active
                .filter((e) => e.kind === "production")
                .reduce((s, e) => s + Number(e.cost_cents || 0), 0),
            )}
          </strong>
        </div>
        <div>
          <span>Known waste cost</span>
          <strong>
            {cash(
              active
                .filter((e) => e.kind === "waste")
                .reduce((s, e) => s + Number(e.cost_cents || 0), 0),
            )}
          </strong>
        </div>
        <div>
          <span>Entries without full cost</span>
          <strong>{missing}</strong>
        </div>
      </div>
      {entries.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {[
                  "Date / type",
                  "Recipe / product",
                  "Quantity",
                  "Estimated cost",
                  "Status / reason",
                  "Actions",
                ].map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id}>
                  <td>
                    {e.date}
                    <small className="kitchen-meta">{e.kind}</small>
                  </td>
                  <td>
                    {e.label}
                    <details>
                      <summary>Ingredients recorded</summary>
                      {e.lines.map((l, i) => (
                        <p key={i}>
                          {l.name}: {qty(l.quantity)} {l.unit} ·{" "}
                          {cash(l.cost_cents)}
                        </p>
                      ))}
                    </details>
                  </td>
                  <td>
                    {qty(e.quantity)} {e.unit}
                  </td>
                  <td>{cash(e.cost_cents)}</td>
                  <td>
                    {e.reversed_at ? "Reversed" : "Posted"}
                    <small className="kitchen-meta">{e.reason}</small>
                    {e.reversed_at && (
                      <small className="kitchen-meta">
                        Correction: {e.reversal_reason}
                      </small>
                    )}
                  </td>
                  <td>
                    {isAdmin && !e.reversed_at && (
                      <Button
                        kind="ghost"
                        onClick={() => {
                          setReverse(e);
                          setReversalReason("");
                        }}
                      >
                        Reverse
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty title="No kitchen entries">
          Confirmed preparation and waste will appear here.
        </Empty>
      )}
      {reverse && (
        <Modal
          title="Reverse kitchen entry"
          busy={busy}
          onClose={() => setReverse(null)}
        >
          <p>
            This corrects an entry recorded by mistake and returns its original
            ingredient quantities to stock. Do not use it to undo food that was
            actually prepared or discarded.
          </p>
          {error && (
            <div role="alert" className="alert error">
              {error}
            </div>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              run(async () => {
                await onSubmit("kitchen.reverse", {
                  id: reverse.id,
                  reason: reversalReason,
                });
                setReverse(null);
              });
            }}
          >
            <Field label="Correction reason">
              <input
                required
                minLength={5}
                maxLength={500}
                value={reversalReason}
                onChange={(e) => setReversalReason(e.target.value)}
              />
            </Field>
            <Button disabled={busy}>Reverse & restore stock</Button>
          </form>
        </Modal>
      )}
    </>
  );
}
