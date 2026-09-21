import { useState, useRef } from "react";
import { Button, Field, Modal, Empty } from "./common";
import {
  money,
  cents,
  today,
  uid,
  balance,
  invoiceTotal,
  METHODS,
} from "../core/domain";
import {
  creditUsed,
  historicalRows,
  printableRows,
  compareQuotes,
} from "../core/operations";
import { cloud, selectedBusiness } from "../core/repository";
import { download, exportCSV } from "../core/export";
import "./operations.css";

const supplierName = (s, id) =>
  s.suppliers.find((x) => x.id === id)?.business_name || "Unknown";
const supplierOptions = (s) =>
  s.suppliers.map((x) => ({ value: x.id, label: x.business_name }));
const field = (name, label, type = "text", options) => ({
  name,
  label,
  type,
  options,
});
function useTask() {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function run(fn) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e.message || "Operation failed.");
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, run };
}
function Notice({ task }) {
  return task.error ? (
    <div className="alert error" role="alert">
      {task.error}
    </div>
  ) : null;
}
function Header({ title, children, actions }) {
  return (
    <div className="page-heading">
      <div>
        <p className="eyebrow">BUSINESS OPERATIONS</p>
        <h1>{title}</h1>
        <p>{children}</p>
      </div>
      <div className="actions">{actions}</div>
    </div>
  );
}
function Grid({ headers, rows }) {
  return rows.length ? (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {headers.map((x, i) => (
              <th key={i}>{x}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => (
                <td key={j}>{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : (
    <Empty title="No records yet">New records will appear here.</Empty>
  );
}
function Editor({ title, fields, initial = {}, save, close, children }) {
  const [f, setF] = useState(initial),
    task = useTask();
  return (
    <Modal title={title} onClose={close} busy={task.busy}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          task.run(async () => {
            await save(f);
            close();
          });
        }}
      >
        <div className="form-grid">
          {fields.map((x) => (
            <Field key={x.name} label={x.label}>
              <>
                {x.type === "select" ? (
                  <select
                    required
                    value={f[x.name] ?? ""}
                    onChange={(e) => setF({ ...f, [x.name]: e.target.value })}
                  >
                    <option value="">Choose…</option>
                    {x.options.map((o) => (
                      <option key={o.value ?? o} value={o.value ?? o}>
                        {o.label ?? o}
                      </option>
                    ))}
                  </select>
                ) : x.type === "checkbox" ? (
                  <input
                    type="checkbox"
                    checked={!!f[x.name]}
                    onChange={(e) => setF({ ...f, [x.name]: e.target.checked })}
                  />
                ) : (
                  <input
                    required={!x.optional}
                    type={x.type}
                    step={x.type === "number" ? "0.01" : undefined}
                    min={x.type === "number" ? "0" : undefined}
                    maxLength={x.type === "text" ? 1000 : undefined}
                    value={f[x.name] ?? ""}
                    onChange={(e) => setF({ ...f, [x.name]: e.target.value })}
                  />
                )}
              </>
            </Field>
          ))}
        </div>
        {children}
        <Notice task={task} />
        <div className="modal-footer">
          <Button
            type="button"
            kind="secondary"
            onClick={close}
            disabled={task.busy}
          >
            Cancel
          </Button>
          <Button disabled={task.busy}>{task.busy ? "Saving…" : "Save"}</Button>
        </div>
      </form>
    </Modal>
  );
}
export function Categories({ state, onSubmit, isAdmin }) {
  const [edit, setEdit] = useState(null);
  return (
    <>
      <Header
        title="Supplier categories"
        actions={
          isAdmin && (
            <Button onClick={() => setEdit({ name: "", active: true })}>
              New category
            </Button>
          )
        }
      >
        Create, rename or archive categories. Renaming also updates current
        supplier assignments.
      </Header>
      <Grid
        headers={["Category", "Status", "Suppliers", "Actions"]}
        rows={(state.categories || []).map((c) => [
          c.name,
          c.active ? "Active" : "Archived",
          state.suppliers.filter((s) => s.category === c.name).length,
          isAdmin && (
            <Button kind="ghost" onClick={() => setEdit(c)}>
              Edit
            </Button>
          ),
        ])}
      />
      {edit && (
        <Editor
          title="Category"
          initial={edit}
          fields={[
            field("name", "Category name"),
            field("active", "Available for new assignments", "checkbox"),
          ]}
          close={() => setEdit(null)}
          save={(f) => onSubmit("category.save", f)}
        />
      )}
    </>
  );
}
export function BusinessUsers({ state, onSubmit, isAdmin, reload }) {
  const [edit, setEdit] = useState(null),
    [business, setBusiness] = useState(false),
    task = useTask();
  return (
    <>
      <Header
        title="Businesses & users"
        actions={
          isAdmin && (
            <>
              <Button onClick={() => setBusiness(true)}>New business</Button>
              <Button
                kind="secondary"
                onClick={() =>
                  setEdit({ role: "viewer", active: true, email: "" })
                }
              >
                Grant access
              </Button>
            </>
          )
        }
      >
        Access is independent for each business. The website's private sharing
        settings also control who can open it.
      </Header>
      <Grid
        headers={["Business", "Your role"]}
        rows={(state.businesses || []).map((b) => [b.name, b.role])}
      />
      {isAdmin ? (
        <>
          <h2>People with access</h2>
          <Grid
            headers={["Email", "Role", "Status", "Actions"]}
            rows={(state.members || []).map((m) => [
              m.email,
              m.role,
              m.active ? "Active" : "Revoked",
              <Button kind="ghost" onClick={() => setEdit(m)}>
                Edit access
              </Button>,
            ])}
          />
          <p>
            Create and confirm new login accounts in Supabase Authentication
            before granting business access here. Revoked users lose access on
            their next request.
          </p>
        </>
      ) : (
        <p>Only administrators can manage access.</p>
      )}
      <Notice task={task} />
      {edit && (
        <Editor
          title="Business access"
          initial={edit}
          fields={[
            field("email", "Confirmed account email", "email"),
            field("role", "Role", "select", ["admin", "accountant", "viewer"]),
            field("active", "Access enabled", "checkbox"),
          ]}
          close={() => setEdit(null)}
          save={(f) => onSubmit("member.save", f)}
        />
      )}{" "}
      {business && (
        <Editor
          title="Create business"
          fields={[field("name", "Business name")]}
          close={() => setBusiness(false)}
          save={async (f) => {
            await onSubmit("business.create", f);
            await reload();
          }}
        />
      )}
    </>
  );
}
export function Credits({ state, onSubmit, canWrite, isAdmin }) {
  const [edit, setEdit] = useState(null);
  const credits = state.credits || [];
  const options = supplierOptions(state);
  function editor() {
    if (!edit) return null;
    let fields,
      initial = edit.data || {},
      action = edit.type;
    if (action === "credit.create")
      fields = [
        field("supplier_id", "Supplier", "select", options),
        field("number", "Credit note number"),
        field("date", "Credit date", "date"),
        field("amount", "Credit amount", "number"),
        field("reason", "Reason / returned goods"),
      ];
    if (action === "credit.apply")
      fields = [
        field(
          "invoice_id",
          "Approved invoice",
          "select",
          state.invoices
            .filter(
              (i) =>
                i.supplier_id === edit.supplier &&
                i.status === "Approved" &&
                balance(state, i) > 0,
            )
            .map((i) => ({
              value: i.id,
              label: i.number + " · " + money(balance(state, i)),
            })),
        ),
        field("date", "Application date", "date"),
        field("amount", "Amount to apply", "number"),
      ];
    if (action === "credit.reverse" || action === "credit.void")
      fields = [field("reason", "Reason (at least 5 characters)")];
    return (
      <Editor
        title={action.replace(".", " · ")}
        fields={fields}
        initial={{ date: today(), ...initial }}
        close={() => setEdit(null)}
        save={(f) =>
          onSubmit(action, {
            ...f,
            ...(f.amount ? { amount_cents: cents(f.amount) } : {}),
          })
        }
      />
    );
  }
  return (
    <>
      <Header
        title="Supplier credits"
        actions={
          canWrite && (
            <Button onClick={() => setEdit({ type: "credit.create" })}>
              New credit / return
            </Button>
          )
        }
      >
        Record supplier-approved credits for returns, damaged goods and price
        adjustments. Apply them to invoices from the same supplier.
      </Header>
      <Grid
        headers={[
          "Supplier / credit",
          "Date",
          "Amount",
          "Available",
          "Status",
          "Actions",
        ]}
        rows={credits.map((c) => [
          supplierName(state, c.supplier_id) + " / " + c.number,
          c.date,
          money(c.amount_cents),
          money(c.voided_at ? 0 : c.amount_cents - creditUsed(state, c.id)),
          c.voided_at ? "Void" : "Available",
          <div className="actions">
            {canWrite &&
              !c.voided_at &&
              c.amount_cents > creditUsed(state, c.id) && (
                <Button
                  kind="ghost"
                  onClick={() =>
                    setEdit({
                      type: "credit.apply",
                      supplier: c.supplier_id,
                      data: { credit_id: c.id },
                    })
                  }
                >
                  Apply
                </Button>
              )}
            {isAdmin && !c.voided_at && creditUsed(state, c.id) === 0 && (
              <Button
                kind="ghost"
                onClick={() =>
                  setEdit({ type: "credit.void", data: { id: c.id } })
                }
              >
                Void
              </Button>
            )}
          </div>,
        ])}
      />
      <h2>Credit applications</h2>
      <Grid
        headers={["Credit", "Invoice", "Date", "Amount", "Status", "Actions"]}
        rows={(state.credit_allocations || []).map((a) => [
          credits.find((c) => c.id === a.credit_id)?.number,
          state.invoices.find((i) => i.id === a.invoice_id)?.number,
          a.date,
          money(a.amount_cents),
          a.reversed_at ? "Reversed" : "Applied",
          isAdmin && !a.reversed_at && (
            <Button
              kind="ghost"
              onClick={() =>
                setEdit({ type: "credit.reverse", data: { id: a.id } })
              }
            >
              Reverse
            </Button>
          ),
        ])}
      />
      {editor()}
    </>
  );
}
export function PaymentPlanner({ state, onSubmit, canWrite }) {
  const [supplier, setSupplier] = useState(""),
    [until, setUntil] = useState(today()),
    [budget, setBudget] = useState(""),
    [amounts, setAmounts] = useState({}),
    [date, setDate] = useState(today()),
    [method, setMethod] = useState("ACH"),
    [reference, setReference] = useState(""),
    [name, setName] = useState("Weekly payment plan"),
    task = useTask();
  const eligible = state.invoices
    .filter(
      (i) =>
        i.status === "Approved" &&
        balance(state, i) > 0 &&
        (!supplier || i.supplier_id === supplier) &&
        i.due_date <= until,
    )
    .sort((a, b) => a.due_date.localeCompare(b.due_date));
  const selected = Object.entries(amounts)
    .filter(([, v]) => Number(v) > 0)
    .map(([id, v]) => ({
      invoice_id: id,
      amount_cents: Math.round(Number(v) * 100),
    }));
  const total = selected.reduce((n, x) => n + x.amount_cents, 0);
  async function record() {
    if (!supplier)
      throw new Error("Select one supplier to record a grouped payment.");
    const items = selected.map((x) => ({
      ...x,
      amount_cents: cents(amounts[x.invoice_id]),
    }));
    if (items.length === 0) throw new Error("Enter one or more allocations.");
    if (
      items.some(
        (x) =>
          state.invoices.find((i) => i.id === x.invoice_id)?.supplier_id !==
          supplier,
      )
    )
      throw new Error("Allocations must belong to the selected supplier.");
    if (
      !window.confirm(
        `Record ${money(total)} as one payment across ${items.length} invoices? This records a payment; it does not transfer money.`,
      )
    )
      return;
    await onSubmit("payment.batch", { items, date, method, reference });
    setAmounts({});
  }
  return (
    <>
      <Header title="Payment planner">
        Plan payments across suppliers or select one supplier to record a single
        payment covering several invoices.
      </Header>
      <Notice task={task} />
      <section className="panel">
        <div className="form-grid">
          <Field label="Supplier">
            <select
              value={supplier}
              onChange={(e) => {
                setSupplier(e.target.value);
                setAmounts({});
              }}
            >
              <option value="">All suppliers — planning only</option>
              {supplierOptions(state).map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Invoices due through">
            <input
              type="date"
              value={until}
              onChange={(e) => {
                setUntil(e.target.value);
                setAmounts({});
              }}
            />
          </Field>
          <Field label="Weekly budget">
            <input
              type="number"
              min="0"
              step="0.01"
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
            />
          </Field>
          <Field label="Plan name">
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
        </div>
        <Grid
          headers={["Supplier", "Invoice", "Due", "Outstanding", "Allocate"]}
          rows={eligible.map((i) => [
            supplierName(state, i.supplier_id),
            i.number,
            i.due_date,
            money(balance(state, i)),
            <input
              aria-label={"Allocate " + i.number}
              type="number"
              min="0"
              step="0.01"
              max={balance(state, i) / 100}
              value={amounts[i.id] || ""}
              onChange={(e) =>
                setAmounts({ ...amounts, [i.id]: e.target.value })
              }
            />,
          ])}
        />
        <div className="plan-total">
          Selected: {money(total)} · Budget remaining:{" "}
          {money(Math.round(Number(budget || 0) * 100) - total)}
        </div>
        <div className="form-grid">
          <Field label="Payment / plan date">
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </Field>
          <Field label="Method">
            <select value={method} onChange={(e) => setMethod(e.target.value)}>
              {METHODS.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          </Field>
          <Field label="Check / transfer reference">
            <input
              value={reference}
              onChange={(e) => setReference(e.target.value)}
            />
          </Field>
        </div>
        <div className="actions">
          {canWrite && (
            <>
              <Button
                disabled={task.busy || !selected.length}
                onClick={() => task.run(record)}
              >
                Record grouped payment
              </Button>
              <Button
                kind="secondary"
                disabled={task.busy}
                onClick={() =>
                  task.run(() =>
                    onSubmit("plan.save", {
                      name,
                      date,
                      budget_cents: cents(budget || "0"),
                      items: selected.map((x) => ({
                        ...x,
                        amount_cents: cents(amounts[x.invoice_id]),
                      })),
                    }),
                  )
                }
              >
                Save plan
              </Button>
            </>
          )}
          <Button
            kind="secondary"
            onClick={() =>
              exportCSV("payment-plan.csv", [
                ["Supplier", "Invoice", "Due", "Allocation"],
                ...selected.map((x) => {
                  const i = state.invoices.find((i) => i.id === x.invoice_id);
                  return [
                    supplierName(state, i.supplier_id),
                    i.number,
                    i.due_date,
                    (x.amount_cents / 100).toFixed(2),
                  ];
                }),
              ])
            }
          >
            Export plan
          </Button>
        </div>
      </section>
      <h2>Saved plans</h2>
      <Grid
        headers={["Plan", "Date", "Budget", "Planned", "Actions"]}
        rows={(state.plans || []).map((p) => [
          p.name,
          p.date,
          money(p.budget_cents),
          money(p.items.reduce((n, x) => n + x.amount_cents, 0)),
          <Button
            kind="ghost"
            onClick={() => {
              setName(p.name);
              setDate(p.date);
              setBudget(String(p.budget_cents / 100));
              setSupplier("");
              setUntil("9999-12-31");
              setAmounts(
                Object.fromEntries(
                  p.items
                    .filter((x) =>
                      state.invoices.some(
                        (i) =>
                          i.id === x.invoice_id &&
                          i.status === "Approved" &&
                          balance(state, i) > 0,
                      ),
                    )
                    .map((x) => [
                      x.invoice_id,
                      String(
                        Math.min(
                          x.amount_cents,
                          balance(
                            state,
                            state.invoices.find((i) => i.id === x.invoice_id),
                          ),
                        ) / 100,
                      ),
                    ]),
                ),
              );
            }}
          >
            Load current balances
          </Button>,
        ])}
      />
    </>
  );
}
export function HistoricalReports({ state }) {
  const [at, setAt] = useState(today()),
    [supplier, setSupplier] = useState("");
  const rows = historicalRows(state, at, supplier);
  const buckets = [0, 0, 0, 0, 0];
  rows.forEach(
    (r) =>
      (buckets[
        r.days === 0
          ? 0
          : r.days <= 30
            ? 1
            : r.days <= 60
              ? 2
              : r.days <= 90
                ? 3
                : 4
      ] += r.outstanding),
  );
  return (
    <>
      <Header
        title="Historical balances"
        actions={
          <>
            <Button kind="secondary" onClick={() => window.print()}>
              Print / PDF
            </Button>
            <Button
              onClick={() =>
                exportCSV("historical-balances.csv", [
                  [
                    "Supplier",
                    "Invoice",
                    "Issue",
                    "Due",
                    "Total",
                    "Cash paid",
                    "Credits",
                    "Balance",
                  ],
                  ...printableRows(rows),
                ])
              }
            >
              Export CSV
            </Button>
          </>
        }
      >
        Balances at the end of the selected day (America/New_York). Includes
        invoices approved by that day, payment dates, credit applications and
        dated reversals.
      </Header>
      <div className="form-grid no-print">
        <Field label="As of">
          <input
            type="date"
            max={today()}
            value={at}
            onChange={(e) => setAt(e.target.value)}
          />
        </Field>
        <Field label="Supplier">
          <select
            value={supplier}
            onChange={(e) => setSupplier(e.target.value)}
          >
            <option value="">All suppliers</option>
            {supplierOptions(state).map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <h2>
        {state.settings.business_name} · {at}
      </h2>
      <div className="aging-cards">
        {["Current", "1–30", "31–60", "61–90", "90+"].map((x, i) => (
          <div className="panel" key={x}>
            <small>{x} days</small>
            <h3>{money(buckets[i])}</h3>
          </div>
        ))}
      </div>
      <Grid
        headers={[
          "Supplier",
          "Invoice",
          "Issue",
          "Due",
          "Total",
          "Cash paid",
          "Credits",
          "Balance",
        ]}
        rows={printableRows(rows)}
      />
      <p>
        Unapplied supplier credits are listed separately; they are not deducted
        from invoice balances until allocated.
      </p>
      <Grid
        headers={["Supplier", "Credit", "Available at cutoff"]}
        rows={(state.credits || [])
          .filter(
            (c) =>
              c.date <= at && (!c.voided_at || c.voided_at.slice(0, 10) > at),
          )
          .map((c) => [
            supplierName(state, c.supplier_id),
            c.number,
            money(c.amount_cents - creditUsed(state, c.id, at)),
          ])}
      />
    </>
  );
}
function OrderEditor({ order, state, save, close }) {
  const [f, setF] = useState(
      order || {
        supplier_id: "",
        number: "",
        date: today(),
        notes: "",
        lines: [
          { product: "", brand: "", unit: "lb", quantity: "1", price: "" },
        ],
      },
    ),
    task = useTask();
  function line(n, k, v) {
    setF({
      ...f,
      lines: f.lines.map((x, i) => (i === n ? { ...x, [k]: v } : x)),
    });
  }
  return (
    <Modal title="Purchase order" wide onClose={close} busy={task.busy}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          task.run(async () => {
            await save({
              ...f,
              lines: f.lines.map((x) => ({
                ...x,
                quantity: Number(x.quantity),
                unit_cents: cents(x.price ?? String(x.unit_cents / 100)),
              })),
            });
            close();
          });
        }}
      >
        <div className="form-grid">
          <Field label="Supplier">
            <select
              required
              value={f.supplier_id}
              onChange={(e) => setF({ ...f, supplier_id: e.target.value })}
            >
              <option value="">Choose…</option>
              {supplierOptions(state).map((s) => (
                <option value={s.value} key={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Order number">
            <input
              required
              value={f.number}
              onChange={(e) => setF({ ...f, number: e.target.value })}
            />
          </Field>
          <Field label="Date">
            <input
              type="date"
              required
              value={f.date}
              onChange={(e) => setF({ ...f, date: e.target.value })}
            />
          </Field>
          <Field label="Notes">
            <input
              value={f.notes}
              onChange={(e) => setF({ ...f, notes: e.target.value })}
            />
          </Field>
        </div>
        <Grid
          headers={[
            "Product",
            "Brand",
            "Unit",
            "Quantity",
            "Unit price",
            "Remove",
          ]}
          rows={f.lines.map((x, n) => [
            <input
              aria-label={"Product " + n}
              required
              value={x.product}
              onChange={(e) => line(n, "product", e.target.value)}
            />,
            <input
              aria-label={"Brand " + n}
              value={x.brand || ""}
              onChange={(e) => line(n, "brand", e.target.value)}
            />,
            <input
              aria-label={"Unit " + n}
              required
              value={x.unit}
              onChange={(e) => line(n, "unit", e.target.value)}
            />,
            <input
              aria-label={"Quantity " + n}
              type="number"
              step="0.001"
              min="0.001"
              required
              value={x.quantity}
              onChange={(e) => line(n, "quantity", e.target.value)}
            />,
            <input
              aria-label={"Price " + n}
              type="number"
              step="0.01"
              min="0.01"
              required
              value={x.price ?? x.unit_cents / 100}
              onChange={(e) => line(n, "price", e.target.value)}
            />,
            <Button
              type="button"
              kind="ghost"
              disabled={f.lines.length === 1}
              onClick={() =>
                setF({ ...f, lines: f.lines.filter((_, i) => i !== n) })
              }
            >
              Remove
            </Button>,
          ])}
        />
        <Button
          type="button"
          kind="secondary"
          onClick={() =>
            setF({
              ...f,
              lines: [
                ...f.lines,
                { product: "", brand: "", unit: "lb", quantity: 1, price: "" },
              ],
            })
          }
        >
          Add line
        </Button>
        <p>
          Order totals exclude tax and shipping. Enter those when converting the
          received order to an invoice.
        </p>
        <Notice task={task} />
        <div className="modal-footer">
          <Button disabled={task.busy}>Save draft</Button>
        </div>
      </form>
    </Modal>
  );
}
export function Purchasing({ state, onSubmit, canWrite }) {
  const [tab, setTab] = useState("Compare"),
    [selected, setSelected] = useState([]),
    [edit, setEdit] = useState(null),
    [order, setOrder] = useState(null),
    [view, setView] = useState(null),
    [convert, setConvert] = useState(null),
    [choices, setChoices] = useState({}),
    [quantities, setQuantities] = useState({}),
    task = useTask();
  const groups = compareQuotes(state, selected);
  async function generate() {
    const perSupplier = new Map();
    for (const qs of groups) {
      const key =
        qs[0].product.toLowerCase() + "|" + qs[0].unit + "|" + qs[0].brand;
      const qty = Number(quantities[key] || 0);
      if (qty <= 0) continue;
      const q = qs.find((x) => x.id === choices[key]) || qs[0];
      if (!perSupplier.has(q.supplier_id)) perSupplier.set(q.supplier_id, []);
      perSupplier
        .get(q.supplier_id)
        .push({
          product: q.product,
          brand: q.brand,
          unit: q.unit,
          quantity: qty,
          unit_cents: q.unit_cents,
        });
    }
    if (!perSupplier.size)
      throw new Error("Enter quantities for at least one product.");
    for (const [supplier_id, lines] of perSupplier)
      await onSubmit("order.save", {
        supplier_id,
        number: "PO-" + today() + "-" + uid().slice(0, 6).toUpperCase(),
        date: today(),
        lines,
        notes:
          "Created from price comparison; review brand, quantity and availability.",
      });
    setQuantities({});
    setTab("Orders");
  }
  return (
    <>
      <Header
        title="Purchasing"
        actions={
          canWrite && (
            <>
              <Button
                onClick={() =>
                  setEdit({
                    date: today(),
                    active: true,
                    unit: "lb",
                    brand: "",
                    notes: "",
                  })
                }
              >
                Add supplier price
              </Button>
              <Button kind="secondary" onClick={() => setOrder({})}>
                New order
              </Button>
            </>
          )
        }
      >
        Compare matching products, brands and units. Choose the supplier you
        prefer, then create editable purchase orders.
      </Header>
      <div className="actions tabs">
        {["Compare", "Prices", "Orders"].map((t) => (
          <Button
            key={t}
            kind={tab === t ? "" : "secondary"}
            onClick={() => setTab(t)}
          >
            {t}
          </Button>
        ))}
      </div>
      <Notice task={task} />
      {tab === "Compare" && (
        <>
          <div className="panel">
            <h3>Compare suppliers</h3>
            <p>
              Leave all unchecked to include everyone, or select any two or
              more. Prices are the latest entered quote for each supplier and
              matching product.
            </p>
            <div className="supplier-checks">
              {state.suppliers.map((s) => (
                <label key={s.id}>
                  <input
                    type="checkbox"
                    checked={selected.includes(s.id)}
                    onChange={(e) => {
                      setSelected(
                        e.target.checked
                          ? [...selected, s.id]
                          : selected.filter((x) => x !== s.id),
                      );
                      setChoices({});
                    }}
                  />
                  {s.business_name}
                </label>
              ))}
            </div>
          </div>
          <Grid
            headers={[
              "Product / brand",
              "Unit",
              "Lowest price",
              "Your selection",
              "Quantity",
            ]}
            rows={groups.map((qs) => {
              const q = qs[0],
                key = q.product.toLowerCase() + "|" + q.unit + "|" + q.brand;
              return [
                q.product + " / " + (q.brand || "Unspecified brand"),
                q.unit,
                money(q.unit_cents),
                <select
                  aria-label={"Supplier for " + q.product}
                  value={choices[key] || q.id}
                  onChange={(e) =>
                    setChoices({ ...choices, [key]: e.target.value })
                  }
                >
                  {qs.map((x) => (
                    <option key={x.id} value={x.id}>
                      {supplierName(state, x.supplier_id)} ·{" "}
                      {money(x.unit_cents)} · {x.date}
                    </option>
                  ))}
                </select>,
                <input
                  aria-label={"Buy quantity " + q.product}
                  type="number"
                  min="0"
                  step="0.001"
                  value={quantities[key] || ""}
                  onChange={(e) =>
                    setQuantities({ ...quantities, [key]: e.target.value })
                  }
                />,
              ];
            })}
          />
          {canWrite && (
            <Button disabled={task.busy} onClick={() => task.run(generate)}>
              Create draft orders by supplier
            </Button>
          )}
          <p>
            No purchase order is sent automatically. Review the draft and
            print/export it for your supplier.
          </p>
        </>
      )}
      {tab === "Prices" && (
        <>
          <Button
            kind="secondary"
            onClick={() =>
              exportCSV("supplier-prices.csv", [
                [
                  "Supplier",
                  "Product",
                  "Brand",
                  "Unit",
                  "Price",
                  "Date",
                  "Active",
                ],
                ...(state.quotes || []).map((q) => [
                  supplierName(state, q.supplier_id),
                  q.product,
                  q.brand,
                  q.unit,
                  (q.unit_cents / 100).toFixed(2),
                  q.date,
                  q.active,
                ]),
              ])
            }
          >
            Export prices
          </Button>
          <Grid
            headers={[
              "Supplier",
              "Product / brand",
              "Unit",
              "Price",
              "Date",
              "Status",
              "Actions",
            ]}
            rows={(state.quotes || []).map((q) => [
              supplierName(state, q.supplier_id),
              q.product + " / " + q.brand,
              q.unit,
              money(q.unit_cents),
              q.date,
              q.active ? "Active" : "Archived",
              canWrite && (
                <Button
                  kind="ghost"
                  onClick={() =>
                    setEdit({ ...q, price: String(q.unit_cents / 100) })
                  }
                >
                  Edit
                </Button>
              ),
            ])}
          />
        </>
      )}
      {tab === "Orders" && (
        <Grid
          headers={["Order", "Supplier", "Date", "Total", "Status", "Actions"]}
          rows={(state.orders || []).map((o) => [
            o.number,
            supplierName(state, o.supplier_id),
            o.date,
            money(o.total_cents),
            o.status,
            <div className="actions">
              <Button kind="ghost" onClick={() => setView(o)}>
                View / print
              </Button>
              {canWrite && o.status === "Draft" && (
                <Button kind="ghost" onClick={() => setOrder(o)}>
                  Edit
                </Button>
              )}
              {canWrite && ["Draft", "Ordered"].includes(o.status) && (
                <>
                  <Button
                    kind="ghost"
                    disabled={task.busy}
                    onClick={() =>
                      task.run(() =>
                        onSubmit("order.status", {
                          id: o.id,
                          version: o.version,
                          status: o.status === "Draft" ? "Ordered" : "Received",
                        }),
                      )
                    }
                  >
                    {o.status === "Draft" ? "Mark ordered" : "Mark received"}
                  </Button>
                  <Button
                    kind="ghost"
                    disabled={task.busy}
                    onClick={() =>
                      task.run(async () => {
                        if (window.confirm("Cancel this purchase order?"))
                          await onSubmit("order.status", {
                            id: o.id,
                            version: o.version,
                            status: "Cancelled",
                          });
                      })
                    }
                  >
                    Cancel
                  </Button>
                </>
              )}
              {canWrite && o.status === "Received" && !o.invoice_id && (
                <Button kind="ghost" onClick={() => setConvert(o)}>
                  Create invoice
                </Button>
              )}
              {o.invoice_id && <span>Invoice created</span>}
            </div>,
          ])}
        />
      )}{" "}
      {edit && (
        <Editor
          title="Supplier price"
          initial={edit}
          fields={[
            field("supplier_id", "Supplier", "select", supplierOptions(state)),
            field("product", "Product"),
            { ...field("brand", "Brand"), optional: true },
            field("unit", "Unit (lb, each, case…)"),
            field("price", "Price per unit", "number"),
            field("date", "Quote date", "date"),
            { ...field("notes", "Quality / notes"), optional: true },
            field("active", "Include in comparisons", "checkbox"),
          ]}
          close={() => setEdit(null)}
          save={(f) =>
            onSubmit("quote.save", { ...f, unit_cents: cents(f.price) })
          }
        />
      )}{" "}
      {order && (
        <OrderEditor
          state={state}
          order={order.id ? order : undefined}
          close={() => setOrder(null)}
          save={(f) => onSubmit("order.save", f)}
        />
      )}{" "}
      {convert && (
        <Editor
          title="Invoice from received order"
          initial={{
            number: "",
            issue_date: today(),
            due_date: today(),
            tax: "0",
            shipping: "0",
          }}
          fields={[
            field("number", "Supplier invoice number"),
            field("issue_date", "Invoice date", "date"),
            field("due_date", "Due date", "date"),
            field("tax", "Tax", "number"),
            field("shipping", "Shipping", "number"),
          ]}
          close={() => setConvert(null)}
          save={(f) =>
            onSubmit("order.invoice", {
              id: convert.id,
              ...f,
              tax_cents: cents(f.tax),
              shipping_cents: cents(f.shipping),
            })
          }
        >
          <p>
            A draft invoice will be created. Review it against the supplier
            document before approval.
          </p>
        </Editor>
      )}{" "}
      {view && (
        <Modal
          title={"Purchase order " + view.number}
          wide
          onClose={() => setView(null)}
        >
          <div className="order-print">
            <h2>{state.settings.business_name}</h2>
            <p>{state.settings.address}</p>
            <h3>{supplierName(state, view.supplier_id)}</h3>
            <p>
              {view.date} · {view.status}
            </p>
            <Grid
              headers={[
                "Product",
                "Brand",
                "Unit",
                "Qty",
                "Price",
                "Line total",
              ]}
              rows={view.lines.map((l) => [
                l.product,
                l.brand,
                l.unit,
                l.quantity,
                money(l.unit_cents),
                money(Math.round(l.quantity * l.unit_cents)),
              ])}
            />
            <h2>Total: {money(view.total_cents)}</h2>
            <p>{view.notes}</p>
          </div>
          <div className="modal-footer no-print">
            <Button onClick={() => window.print()}>Print / PDF</Button>
            <Button
              kind="secondary"
              onClick={() =>
                exportCSV(view.number + ".csv", [
                  ["Product", "Brand", "Unit", "Quantity", "Unit price"],
                  ...view.lines.map((l) => [
                    l.product,
                    l.brand,
                    l.unit,
                    l.quantity,
                    (l.unit_cents / 100).toFixed(2),
                  ]),
                ])
              }
            >
              Export CSV
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}
export function Documents({
  state,
  onSubmit,
  canWrite,
  isAdmin,
  initialType = "invoice",
  initialId = "",
}) {
  const pendingUpload = useRef(null);
  const [type, setType] = useState(initialType),
    [entity, setEntity] = useState(initialId),
    [file, setFile] = useState(null),
    [archived, setArchived] = useState(false),
    task = useTask();
  const collections = {
    supplier: state.suppliers,
    invoice: state.invoices,
    payment: state.payments,
    order: state.orders || [],
    credit: state.credits || [],
  };
  const records = collections[type];
  const docs = (state.documents || []).filter(
    (d) =>
      d.entity_type === type &&
      (!entity || d.entity_id === entity) &&
      (archived || !d.archived_at),
  );
  async function upload() {
    if (!entity || !file) throw new Error("Select a record and a file.");
    if (
      !["application/pdf", "image/jpeg", "image/png", "image/webp"].includes(
        file.type,
      ) ||
      file.size > 10485760 ||
      file.size === 0
    )
      throw new Error("Use a PDF, JPG, PNG or WEBP up to 10 MB.");
    const signature =
      type +
      "|" +
      entity +
      "|" +
      file.name +
      "|" +
      file.size +
      "|" +
      file.lastModified;
    let path =
      pendingUpload.current?.signature === signature
        ? pendingUpload.current.path
        : null;
    if (!path) {
      path =
        selectedBusiness() +
        "/" +
        uid() +
        "/" +
        file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const result = await cloud.storage
        .from("sintech-documents")
        .upload(path, file, { contentType: file.type, upsert: false });
      if (result.error) throw result.error;
      pendingUpload.current = { signature, path };
    }
    await onSubmit("document.add", {
      entity_type: type,
      entity_id: entity,
      name: file.name,
      path,
      mime: file.type,
      size: file.size,
    });
    pendingUpload.current = null;
    setFile(null);
  }
  async function open(d) {
    const r = await cloud.storage.from("sintech-documents").download(d.path);
    if (r.error) throw r.error;
    const u = URL.createObjectURL(r.data);
    const a = document.createElement("a");
    a.href = u;
    a.download = d.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(u), 10000);
  }
  return (
    <>
      <Header title="Documents">
        Private invoice images, supplier documents and payment evidence.
        Archived files are retained for audit history.
      </Header>
      <Notice task={task} />
      <section className="panel">
        <div className="form-grid">
          <Field label="Record type">
            <select
              value={type}
              onChange={(e) => {
                setType(e.target.value);
                setEntity("");
              }}
            >
              {Object.keys(collections).map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </Field>
          <Field label="Record">
            <select value={entity} onChange={(e) => setEntity(e.target.value)}>
              <option value="">All records</option>
              {records.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.business_name ||
                    x.number ||
                    (x.reference || x.method) +
                      " · " +
                      x.date +
                      " · " +
                      money(x.amount_cents)}
                </option>
              ))}
            </select>
          </Field>
        </div>
        {canWrite && (
          <div className="actions">
            <input
              key={file ? file.name : "empty"}
              aria-label="Document file"
              type="file"
              accept="application/pdf,image/jpeg,image/png,image/webp"
              onChange={(e) => setFile(e.target.files[0] || null)}
            />
            <Button
              disabled={task.busy || !file || !entity}
              onClick={() => task.run(upload)}
            >
              Upload document
            </Button>
          </div>
        )}
        <label className="inline-check">
          <input
            type="checkbox"
            checked={archived}
            onChange={(e) => setArchived(e.target.checked)}
          />
          Show archived documents
        </label>
      </section>
      <Grid
        headers={["File", "Uploaded", "Size", "Status", "Actions"]}
        rows={docs.map((d) => [
          d.name,
          new Date(d.created_at).toLocaleDateString(),
          Math.ceil(d.size / 1024) + " KB",
          d.archived_at ? "Archived" : "Active",
          <div className="actions">
            <Button
              kind="ghost"
              disabled={task.busy}
              onClick={() => task.run(() => open(d))}
            >
              Download
            </Button>
            {isAdmin && !d.archived_at && (
              <Button
                kind="ghost"
                disabled={task.busy}
                onClick={() =>
                  task.run(async () => {
                    if (
                      window.confirm(
                        "Archive this document? The original file will be retained.",
                      )
                    )
                      await onSubmit("document.archive", { id: d.id });
                  })
                }
              >
                Archive
              </Button>
            )}
          </div>,
        ])}
      />
      <p>
        Read the document and enter its amounts manually. Automated invoice
        extraction is not enabled.
      </p>
    </>
  );
}
export function SupplierProfile({ state, navigate }) {
  const [id, setId] = useState(state.suppliers[0]?.id || "");
  const s = state.suppliers.find((x) => x.id === id);
  const invoices = state.invoices.filter((i) => i.supplier_id === id);
  const payments = state.payments.filter((p) =>
    invoices.some((i) => i.id === p.invoice_id),
  );
  const credit = (state.credits || [])
    .filter((c) => c.supplier_id === id && !c.voided_at)
    .reduce((n, c) => n + c.amount_cents - creditUsed(state, c.id), 0);
  return (
    <>
      <Header title="Supplier profile">
        Contact information, current balances and transaction history in one
        place.
      </Header>
      <Field label="Supplier">
        <select value={id} onChange={(e) => setId(e.target.value)}>
          {supplierOptions(state).map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </Field>
      {s && (
        <>
          <div className="panel">
            <h2>{s.business_name}</h2>
            <p>
              {s.contact} · {s.phone} · {s.email}
            </p>
            <p>
              {s.address} · {s.category} · Net {s.terms_days}
            </p>
            <p>{s.notes}</p>
            <h3>
              Open invoices:{" "}
              {money(
                invoices
                  .filter((i) => i.status === "Approved")
                  .reduce((n, i) => n + balance(state, i), 0),
              )}{" "}
              · Unapplied credits: {money(credit)}
            </h3>
            <Button
              kind="secondary"
              onClick={() => navigate("/documents?type=supplier&id=" + id)}
            >
              Supplier documents
            </Button>
          </div>
          <h2>Invoices</h2>
          <Grid
            headers={[
              "Number",
              "Date",
              "Status",
              "Total",
              "Balance",
              "Documents",
            ]}
            rows={invoices.map((i) => [
              i.number,
              i.issue_date,
              i.status,
              money(invoiceTotal(i)),
              money(balance(state, i)),
              <Button
                kind="ghost"
                onClick={() => navigate("/documents?type=invoice&id=" + i.id)}
              >
                Documents
              </Button>,
            ])}
          />
          <h2>Payments</h2>
          <Grid
            headers={["Date", "Method", "Reference", "Amount", "Status"]}
            rows={payments.map((p) => [
              p.date,
              p.method,
              p.reference,
              money(p.amount_cents),
              p.reversed_at ? "Reversed" : "Recorded",
            ])}
          />
        </>
      )}
    </>
  );
}
export function BackupsAccount({ state, onSubmit, isAdmin, reload }) {
  const task = useTask(),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState("");
  async function exportBackup(id) {
    const r = await cloud.rpc("ap_backup_download", {
      business: selectedBusiness(),
      backup: id,
    });
    if (r.error) throw r.error;
    download(
      "sintech-backup-" + id + ".json",
      JSON.stringify(r.data, null, 2),
      "application/json",
    );
  }
  return (
    <>
      <Header title="Backups & account">
        A daily snapshot is saved before the first business change of each day.
        Keep downloaded copies outside this service.
      </Header>
      <Notice task={task} />
      {isAdmin && (
        <>
          <div className="actions">
            <Button
              disabled={task.busy}
              onClick={() => task.run(() => onSubmit("backup.create", {}))}
            >
              Create snapshot
            </Button>
            <Button
              kind="secondary"
              onClick={() =>
                download(
                  "sintech-business-" + today() + ".json",
                  JSON.stringify(state, null, 2),
                  "application/json",
                )
              }
            >
              Export current business
            </Button>
          </div>
          <p>
            Snapshots contain business records and document references, not the
            file contents or login credentials. Download important documents
            separately. Automatic daily snapshots retain the latest 30 at daily
            creation.
          </p>
          <Grid
            headers={["Created", "Type", "Actions"]}
            rows={(state.backups || []).map((b) => [
              new Date(b.created_at).toLocaleString(),
              b.label,
              <div className="actions">
                <Button
                  kind="ghost"
                  disabled={task.busy}
                  onClick={() => task.run(() => exportBackup(b.id))}
                >
                  Download
                </Button>
                <Button
                  kind="ghost"
                  disabled={task.busy}
                  onClick={() =>
                    task.run(async () => {
                      if (
                        !window.confirm(
                          "Restore this snapshot into a separate recovered business? Current records will stay unchanged. Document files remain in the original business.",
                        )
                      )
                        return;
                      const r = await cloud.rpc("ap_backup_restore", {
                        business: selectedBusiness(),
                        backup: b.id,
                        request_id: uid(),
                      });
                      if (r.error) throw r.error;
                      await reload();
                      window.alert(
                        "Recovered business created. Select it from the business menu.",
                      );
                    })
                  }
                >
                  Restore as new business
                </Button>
              </div>,
            ])}
          />
        </>
      )}
      <section className="panel">
        <h2>Your sign-in details</h2>
        <p>
          Change your password while signed in. Email changes may require
          confirmation from Supabase.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            task.run(async () => {
              const r = await cloud.auth.updateUser({ password });
              if (r.error) throw r.error;
              setPassword("");
              window.alert("Password updated.");
            });
          }}
        >
          <Field label="New password">
            <input
              type="password"
              autoComplete="new-password"
              minLength={12}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          <Button disabled={task.busy}>Change password</Button>
        </form>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            task.run(async () => {
              const r = await cloud.auth.updateUser({ email });
              if (r.error) throw r.error;
              setEmail("");
              window.alert("Check your email for confirmation instructions.");
            });
          }}
        >
          <Field label="New email">
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          <Button disabled={task.busy} kind="secondary">
            Request email change
          </Button>
        </form>
      </section>
    </>
  );
}
