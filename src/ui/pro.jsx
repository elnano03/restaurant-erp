import { useState } from "react";
import { Button, Field, Modal, Empty, Pagination } from "./common";
import { money, balance, today, invoiceTotal } from "../core/domain";
import { onHand, productCosts, quantityLabel as qty } from "../core/kitchen";
import { exportCSV } from "../core/export";
import "./pro.css";
const supplier = (s, id) =>
  s.suppliers.find((x) => x.id === id)?.business_name || "Unknown";
function useAction() {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return {
    busy,
    error,
    run: async (fn) => {
      setBusy(true);
      setError("");
      try {
        await fn();
      } catch (e) {
        setError(e.message);
      } finally {
        setBusy(false);
      }
    },
  };
}
function Notice({ task }) {
  return task.error ? (
    <div role="alert" className="alert error">
      {task.error}
    </div>
  ) : null;
}
function Heading({ title, children, actions }) {
  return (
    <div className="page-heading">
      <div>
        <p className="eyebrow">OPERATIONS WORKSPACE</p>
        <h1>{title}</h1>
        <p>{children}</p>
      </div>
      <div className="actions">{actions}</div>
    </div>
  );
}
function Metrics({ items }) {
  return (
    <div className="pro-metrics">
      {items.map(([label, value]) => (
        <div key={label}>
          <span>{label}</span>
          <strong>{value}</strong>
        </div>
      ))}
    </div>
  );
}
function Grid({ headers, rows }) {
  return rows.length ? (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {headers.map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((cell, j) => (
                <td key={j}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : (
    <Empty title="No matching records">
      Records will appear here as you complete the workflow.
    </Empty>
  );
}
export function StockDesk({ state, onSubmit, isAdmin, navigate }) {
  const [query, setQuery] = useState(""),
    [low, setLow] = useState(false),
    [policy, setPolicy] = useState(null),
    task = useAction();
  const costs = productCosts(state),
    products = state.products || [],
    active = products.filter((p) => p.active);
  const shortage = (p) =>
    Number(p.reorder_point || 0) > 0 &&
    onHand(state, p.id) <= Number(p.reorder_point);
  const rows = products.filter(
    (p) =>
      p.active &&
      (!low || shortage(p)) &&
      (p.name + " " + p.sku).toLowerCase().includes(query.toLowerCase()),
  );
  const known = active.reduce(
    (s, p) => s + onHand(state, p.id) * (costs.get(p.id)?.cents || 0),
    0,
  );
  return (
    <>
      <Heading
        title="Stock overview"
        actions={
          <>
            <Button onClick={() => navigate("/inventory")}>
              Products & receipts
            </Button>
            <Button kind="secondary" onClick={() => navigate("/stock-counts")}>
              Physical count
            </Button>
          </>
        }
      >
        On-hand quantities, replenishment levels and last-purchase estimates.
      </Heading>
      <Metrics
        items={[
          ["Active products", active.length],
          ["At or below minimum", active.filter(shortage).length],
          ["Known stock cost (estimate)", money(Math.round(known))],
          [
            "Products without cost",
            active.filter((p) => !costs.has(p.id)).length,
          ],
        ]}
      />
      <div className="alert info">
        Estimated cost uses the latest approved invoice per product; it is not
        an accounting valuation. Reorder quantities use your target level and
        current stock, without subtracting open purchase orders.
      </div>
      <div className="pro-filters">
        <Field label="Search inventory">
          <input value={query} onChange={(e) => setQuery(e.target.value)} />
        </Field>
        <label>
          <input
            type="checkbox"
            checked={low}
            onChange={(e) => setLow(e.target.checked)}
          />{" "}
          Low stock only
        </label>
        <Button
          kind="secondary"
          onClick={() =>
            exportCSV("replenishment.csv", [
              [
                "Product",
                "SKU",
                "Unit",
                "On hand",
                "Minimum",
                "Target",
                "Suggested order",
              ],
              ...rows.map((p) => [
                p.name,
                p.sku,
                p.unit,
                onHand(state, p.id),
                p.reorder_point || 0,
                p.target_stock || 0,
                shortage(p)
                  ? Math.max(
                      0,
                      Number(p.target_stock || 0) - onHand(state, p.id),
                    )
                  : 0,
              ]),
            ])
          }
        >
          Export replenishment
        </Button>
      </div>
      <Notice task={task} />
      <Grid
        headers={[
          "Product",
          "On hand",
          "Minimum / target",
          "Suggested order",
          "Unit cost",
          "Action",
        ]}
        rows={rows.map((p) => [
          <>
            <strong>{p.name}</strong>
            <small>{p.sku || "No SKU"}</small>
          </>,
          qty(onHand(state, p.id)) + " " + p.unit,
          qty(p.reorder_point || 0) + " / " + qty(p.target_stock || 0),
          shortage(p)
            ? qty(
                Math.max(0, Number(p.target_stock || 0) - onHand(state, p.id)),
              ) +
              " " +
              p.unit
            : "—",
          costs.has(p.id)
            ? money(Math.round(costs.get(p.id).cents))
            : "Unknown",
          isAdmin && (
            <Button
              kind="ghost"
              onClick={() =>
                setPolicy({
                  ...p,
                  reorder_point: p.reorder_point || 0,
                  target_stock: p.target_stock || 0,
                })
              }
            >
              Set levels
            </Button>
          ),
        ])}
      />
      {policy && (
        <Modal
          title={"Stock levels · " + policy.name}
          busy={task.busy}
          onClose={() => setPolicy(null)}
        >
          <Notice task={task} />
          <form
            onSubmit={(e) => {
              e.preventDefault();
              task.run(async () => {
                await onSubmit("stock.policy", {
                  id: policy.id,
                  version: policy.version,
                  reorder_point: Number(policy.reorder_point),
                  target_stock: Number(policy.target_stock),
                });
                setPolicy(null);
              });
            }}
          >
            <p>
              Quantities are in {policy.unit}. Set minimum to zero to disable
              the low-stock alert.
            </p>
            {["reorder_point", "target_stock"].map((k) => (
              <Field
                key={k}
                label={
                  k === "reorder_point" ? "Minimum quantity" : "Target quantity"
                }
              >
                <input
                  required
                  type="number"
                  min="0"
                  max="1000000000"
                  step="0.001"
                  value={policy[k]}
                  onChange={(e) =>
                    setPolicy({ ...policy, [k]: e.target.value })
                  }
                />
              </Field>
            ))}
            <Button disabled={task.busy}>Save levels</Button>
          </form>
        </Modal>
      )}
    </>
  );
}
export function StockCounts({ state, onSubmit, isAdmin }) {
  const [lines, setLines] = useState(null),
    [reason, setReason] = useState(""),
    [reviewed, setReviewed] = useState(false),
    task = useAction();
  const selected = (lines || []).filter((l) => l.counted !== "");
  const counts = [...(state.stock_counts || [])].sort((a, b) =>
    b.created_at.localeCompare(a.created_at),
  );
  return (
    <>
      <Heading
        title="Physical counts"
        actions={
          isAdmin &&
          !lines && (
            <Button
              onClick={() => {
                setReason("");
                setReviewed(false);
                setLines(
                  (state.products || [])
                    .filter((p) => p.active)
                    .map((p) => ({
                      product_id: p.id,
                      name: p.name,
                      unit: p.unit,
                      expected: onHand(state, p.id),
                      counted: "",
                    })),
                );
              }}
            >
              Start count
            </Button>
          )
        }
      >
        Reconcile counted stock with the system. Blank quantities are skipped;
        zero means nothing remains.
      </Heading>
      <Notice task={task} />
      {lines && (
        <form
          className="panel pro-panel"
          onSubmit={(e) => {
            e.preventDefault();
            task.run(async () => {
              await onSubmit("stock.count", {
                reason,
                reviewed,
                lines: selected.map((l) => ({
                  ...l,
                  counted: Number(l.counted),
                })),
              });
              setLines(null);
            });
          }}
        >
          <fieldset disabled={task.busy}>
            <p>
              Pause stock activity while counting. If any selected product
              changes before posting, this count is rejected so you can recount
              it.
            </p>
            <Grid
              headers={["Product", "System quantity", "Counted", "Difference"]}
              rows={lines.map((l, i) => [
                l.name,
                qty(l.expected) + " " + l.unit,
                <input
                  aria-label={"Count " + l.name}
                  type="number"
                  min="0"
                  max="1000000000"
                  step="0.001"
                  value={l.counted}
                  onChange={(e) => {
                    setLines(
                      lines.map((r, j) =>
                        i === j ? { ...r, counted: e.target.value } : r,
                      ),
                    );
                    setReviewed(false);
                  }}
                />,
                l.counted === ""
                  ? "Not counted"
                  : qty(Number(l.counted) - l.expected) + " " + l.unit,
              ])}
            />
            <Field label="Count reference / reason">
              <input
                required
                minLength={5}
                maxLength={500}
                value={reason}
                onChange={(e) => {
                  setReason(e.target.value);
                  setReviewed(false);
                }}
              />
            </Field>
            <label className="inline-check">
              <input
                required
                type="checkbox"
                checked={reviewed}
                onChange={(e) => setReviewed(e.target.checked)}
              />{" "}
              I verified all entered quantities.
            </label>
            <div className="actions">
              <Button disabled={!selected.length || !reviewed}>
                Post count & reconcile
              </Button>
              <Button
                type="button"
                kind="secondary"
                onClick={() => setLines(null)}
              >
                Cancel count
              </Button>
            </div>
          </fieldset>
        </form>
      )}
      <Grid
        headers={["Date", "Reference", "Products counted", "Details"]}
        rows={counts.map((c) => [
          c.date,
          c.reason,
          c.lines.length,
          <details>
            <summary>View differences</summary>
            {c.lines.map((l) => (
              <p key={l.product_id}>
                {l.name}: {qty(l.before)} → {qty(l.counted)} {l.unit}{" "}
                (difference {qty(l.difference)})
              </p>
            ))}
            <Button
              kind="ghost"
              onClick={() =>
                exportCSV("stock-count-" + c.date + ".csv", [
                  ["Product", "Unit", "System", "Counted", "Difference"],
                  ...c.lines.map((l) => [
                    l.name,
                    l.unit,
                    l.before,
                    l.counted,
                    l.difference,
                  ]),
                ])
              }
            >
              Export count
            </Button>
          </details>,
        ])}
      />
    </>
  );
}
export function MovementLedger({ state }) {
  const [product, setProduct] = useState(""),
    [kind, setKind] = useState(""),
    [from, setFrom] = useState(""),
    [to, setTo] = useState(today()),
    [page, setPage] = useState(1);
  const moves = [...(state.inventory_moves || [])]
    .filter(
      (m) =>
        (!product || m.product_id === product) &&
        (!kind || m.kind === kind) &&
        (!from || m.date >= from) &&
        (!to || m.date <= to),
    )
    .sort(
      (a, b) =>
        b.date.localeCompare(a.date) ||
        b.created_at.localeCompare(a.created_at),
    );
  const productName = (id) =>
    (state.products || []).find((p) => p.id === id)?.name || "Unknown";
  const rows = (ms) =>
    ms.map((m) => [
      m.date,
      productName(m.product_id),
      qty(m.quantity) +
        " " +
        ((state.products || []).find((p) => p.id === m.product_id)?.unit || ""),
      m.kind,
      m.reason,
      state.invoices.find((i) => i.id === m.invoice_id)?.number || "—",
    ]);
  const filter = (fn, value) => {
    fn(value);
    setPage(1);
  };
  return (
    <>
      <Heading
        title="Movement ledger"
        actions={
          <Button
            kind="secondary"
            onClick={() =>
              exportCSV("stock-movements.csv", [
                [
                  "Date",
                  "Product",
                  "Quantity / unit",
                  "Type",
                  "Reason",
                  "Invoice",
                ],
                ...rows(moves),
              ])
            }
          >
            Export filtered ledger
          </Button>
        }
      >
        Filter the complete movement history by ingredient, date and movement
        type.
      </Heading>
      <div className="pro-filters">
        <Field label="Product">
          <select
            value={product}
            onChange={(e) => filter(setProduct, e.target.value)}
          >
            <option value="">All products</option>
            {(state.products || []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Movement type">
          <select
            value={kind}
            onChange={(e) => filter(setKind, e.target.value)}
          >
            <option value="">All types</option>
            {[...new Set((state.inventory_moves || []).map((m) => m.kind))]
              .sort()
              .map((k) => (
                <option key={k}>{k}</option>
              ))}
          </select>
        </Field>
        <Field label="From">
          <input
            type="date"
            value={from}
            onChange={(e) => filter(setFrom, e.target.value)}
          />
        </Field>
        <Field label="Through">
          <input
            type="date"
            value={to}
            onChange={(e) => filter(setTo, e.target.value)}
          />
        </Field>
      </div>
      <Grid
        headers={["Date", "Product", "Quantity", "Type", "Reason", "Invoice"]}
        rows={rows(moves.slice((page - 1) * 25, page * 25))}
      />
      <Pagination
        page={page}
        setPage={setPage}
        total={moves.length}
        size={25}
      />
    </>
  );
}
export function PayablesDesk({ state, onSubmit, canWrite, open, navigate }) {
  const [filter, setFilter] = useState("Open"),
    [search, setSearch] = useState(""),
    [hold, setHold] = useState(null),
    [reason, setReason] = useState(""),
    task = useAction();
  const outstanding = state.invoices.filter(
      (i) => i.status === "Approved" && balance(state, i) > 0,
    ),
    drafts = state.invoices.filter((i) => i.status === "Draft");
  const rows = (filter === "Drafts" ? drafts : outstanding)
    .filter(
      (i) =>
        (filter !== "Overdue" || i.due_date < today()) &&
        (filter !== "On hold" || i.payment_hold) &&
        (i.number + " " + supplier(state, i.supplier_id))
          .toLowerCase()
          .includes(search.toLowerCase()),
    )
    .sort((a, b) => a.due_date.localeCompare(b.due_date));
  return (
    <>
      <Heading
        title="Payables desk"
        actions={
          <>
            <Button onClick={() => navigate("/invoice-import")}>
              Import invoice
            </Button>
            <Button kind="secondary" onClick={() => navigate("/planner")}>
              Plan payments
            </Button>
          </>
        }
      >
        Review upcoming bills, exceptions and amounts awaiting payment.
      </Heading>
      <Metrics
        items={[
          [
            "Outstanding",
            money(outstanding.reduce((s, i) => s + balance(state, i), 0)),
          ],
          [
            "Overdue",
            money(
              outstanding
                .filter((i) => i.due_date < today())
                .reduce((s, i) => s + balance(state, i), 0),
            ),
          ],
          ["On payment hold", outstanding.filter((i) => i.payment_hold).length],
          ["Drafts to review", drafts.length],
        ]}
      />
      <div className="pro-filters">
        <Field label="Work queue">
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            {["Open", "Overdue", "On hold", "Drafts"].map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </Field>
        <Field label="Find invoice or supplier">
          <input value={search} onChange={(e) => setSearch(e.target.value)} />
        </Field>
      </div>
      <Notice task={task} />
      <Grid
        headers={["Supplier / invoice", "Due", "Balance", "Control", "Actions"]}
        rows={rows.map((i) => [
          <>
            <strong>{supplier(state, i.supplier_id)}</strong>
            <small>{i.number}</small>
          </>,
          i.due_date,
          money(balance(state, i)),
          i.payment_hold ? (
            <>
              <strong>Payment hold</strong>
              <small>{i.hold_reason}</small>
            </>
          ) : i.status === "Draft" ? (
            "Needs approval"
          ) : (
            "Ready for review"
          ),
          <div className="actions">
            <Button
              kind="ghost"
              onClick={() => open({ kind: "detail", id: i.id })}
            >
              Review
            </Button>
            {canWrite && i.status === "Approved" && (
              <>
                <Button
                  kind="ghost"
                  disabled={i.payment_hold}
                  onClick={() => open({ kind: "payment", id: i.id })}
                >
                  Record payment
                </Button>
                <Button
                  kind="ghost"
                  onClick={() => {
                    setHold(i);
                    setReason("");
                  }}
                >
                  {i.payment_hold ? "Release hold" : "Hold payment"}
                </Button>
              </>
            )}
          </div>,
        ])}
      />
      {hold && (
        <Modal
          title={
            hold.payment_hold ? "Release payment hold" : "Place payment hold"
          }
          busy={task.busy}
          onClose={() => setHold(null)}
        >
          <Notice task={task} />
          <p>
            {hold.number} · {supplier(state, hold.supplier_id)}. A hold blocks
            individual and grouped payments. It does not remove the debt from
            reports.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              task.run(async () => {
                await onSubmit("invoice.hold", {
                  id: hold.id,
                  version: hold.version,
                  hold: !hold.payment_hold,
                  reason,
                });
                setHold(null);
              });
            }}
          >
            <Field label="Reason">
              <input
                required
                minLength={5}
                maxLength={500}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </Field>
            <Button disabled={task.busy}>Confirm</Button>
          </form>
        </Modal>
      )}
    </>
  );
}
export function PurchasingDesk({ state, onSubmit, canWrite, open, navigate }) {
  const [link, setLink] = useState(null),
    [invoice, setInvoice] = useState(""),
    [reason, setReason] = useState(""),
    [status, setStatus] = useState("All"),
    task = useAction();
  const orders = state.orders || [],
    pending = orders.filter(
      (o) =>
        o.status !== "Cancelled" &&
        (!o.invoice_id ||
          state.invoices.find((i) => i.id === o.invoice_id)?.status === "Void"),
    );
  return (
    <>
      <Heading
        title="Purchasing desk"
        actions={
          <>
            <Button onClick={() => navigate("/orders")}>Purchase orders</Button>
            <Button kind="secondary" onClick={() => navigate("/purchasing")}>
              Compare prices
            </Button>
          </>
        }
      >
        Follow the order, supplier invoice and stock receipt in one place.
      </Heading>
      <Metrics
        items={[
          ["Draft orders", orders.filter((o) => o.status === "Draft").length],
          [
            "Awaiting delivery",
            orders.filter((o) => o.status === "Ordered").length,
          ],
          [
            "Delivered, no invoice",
            pending.filter((o) => o.status === "Received").length,
          ],
          [
            "Open order value",
            money(
              orders
                .filter((o) => ["Draft", "Ordered"].includes(o.status))
                .reduce((s, o) => s + o.total_cents, 0),
            ),
          ],
        ]}
      />
      <div className="alert info">
        Confirm delivery records the purchase-order status. Inventory is added
        only once from the approved invoice in Products & receipts. Import the
        actual supplier invoice and link it here, or create a draft invoice from
        a delivered order.
      </div>
      <Field label="Order status">
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          {["All", "Draft", "Ordered", "Received", "Cancelled"].map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </Field>
      <Notice task={task} />
      <Grid
        headers={[
          "Order / supplier",
          "Order value",
          "Delivery",
          "Invoice / difference",
          "Inventory",
          "Actions",
        ]}
        rows={orders
          .filter((o) => status === "All" || o.status === status)
          .map((o) => {
            const i = state.invoices.find((i) => i.id === o.invoice_id);
            return [
              <>
                <strong>{o.number}</strong>
                <small>{supplier(state, o.supplier_id)}</small>
              </>,
              money(o.total_cents),
              o.status,
              i ? (
                <>
                  {i.number} · {i.status}
                  <small>
                    Subtotal difference:{" "}
                    {money(i.subtotal_cents - o.total_cents)}
                  </small>
                </>
              ) : (
                "Not linked"
              ),
              i?.inventory_received_at
                ? "Received"
                : i?.status === "Void"
                  ? "Invoice voided"
                  : i
                    ? "Awaiting invoice receipt"
                    : "—",
              <div className="actions">
                {i && (
                  <Button
                    kind="ghost"
                    onClick={() => open({ kind: "detail", id: i.id })}
                  >
                    View invoice
                  </Button>
                )}
                {canWrite &&
                  o.status === "Received" &&
                  (!i || i.status === "Void") && (
                    <Button
                      kind="ghost"
                      onClick={() => {
                        setLink(o);
                        setInvoice("");
                        setReason("");
                      }}
                    >
                      Link existing invoice
                    </Button>
                  )}
                {i?.status === "Approved" && !i.inventory_received_at && (
                  <Button kind="ghost" onClick={() => navigate("/inventory")}>
                    Receive stock
                  </Button>
                )}
              </div>,
            ];
          })}
      />
      {link && (
        <Modal
          title={"Link invoice · " + link.number}
          busy={task.busy}
          onClose={() => setLink(null)}
        >
          <Notice task={task} />
          <form
            onSubmit={(e) => {
              e.preventDefault();
              task.run(async () => {
                await onSubmit("order.link", {
                  id: link.id,
                  version: link.version,
                  invoice_id: invoice,
                  reason,
                });
                setLink(null);
              });
            }}
          >
            <Field label="Supplier invoice">
              <select
                required
                value={invoice}
                onChange={(e) => setInvoice(e.target.value)}
              >
                <option value="">Choose existing invoice</option>
                {state.invoices
                  .filter(
                    (i) =>
                      i.supplier_id === link.supplier_id &&
                      i.status !== "Void" &&
                      !orders.some((o) => o.invoice_id === i.id),
                  )
                  .map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.number} · {money(invoiceTotal(i))} · {i.status}
                    </option>
                  ))}
              </select>
            </Field>
            {invoice && (
              <p>
                Subtotal difference:{" "}
                {money(
                  state.invoices.find((i) => i.id === invoice).subtotal_cents -
                    link.total_cents,
                )}
                . Explain any substitution, quantity or price change below.
              </p>
            )}
            <Field label="Matching review / variance explanation">
              <input
                required
                minLength={5}
                maxLength={500}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </Field>
            <Button disabled={task.busy}>Link reviewed invoice</Button>
          </form>
        </Modal>
      )}
    </>
  );
}
