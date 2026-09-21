import { useState } from "react";
import { Printer, CreditCard } from "lucide-react";
import { Button, Field, Modal, Badge } from "./common";
import {
  cents,
  money,
  today,
  addDays,
  dateLabel,
  CATEGORIES,
  STATUSES,
  METHODS,
  invoiceTotal,
  invoicePaid,
  balance,
  invoiceStatus,
} from "../core/domain";

function Footer({ busy, onClose, label = "Save" }) {
  return (
    <div className="modal-footer">
      <Button type="button" kind="secondary" disabled={busy} onClick={onClose}>
        Cancel
      </Button>
      <Button disabled={busy}>{busy ? "Saving…" : label}</Button>
    </div>
  );
}
function ErrorMessage({ error }) {
  return (
    error && (
      <div className="alert error" role="alert">
        {error}
      </div>
    )
  );
}
export function SupplierDialog({ supplier, state, onClose, onSubmit }) {
  const [f, setF] = useState(
    supplier || {
      business_name: "",
      contact: "",
      phone: "",
      email: "",
      address: "",
      category: state.categories?.find(c=>c.active)?.name || "Food & Beverages",
      status: "Active",
      terms_days: state.settings.terms_days,
      notes: "",
    },
  );
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const bind = (name) => ({
    value: f[name] ?? "",
    onChange: (e) => setF({ ...f, [name]: e.target.value }),
  });
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await onSubmit("supplier.save", {
        ...f,
        terms_days: Number(f.terms_days),
      });
      onClose();
    } catch (x) {
      setError(x.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={supplier ? "Edit supplier" : "New supplier"}
      subtitle="Contact details and payment terms"
      onClose={onClose}
      busy={busy}
    >
      <form onSubmit={submit}>
        <div className="form-grid">
          <Field label="Business name *" wide>
            <input required maxLength={250} {...bind("business_name")} />
          </Field>
          <Field label="Contact person">
            <input maxLength={250} {...bind("contact")} />
          </Field>
          <Field label="Phone">
            <input type="tel" maxLength={60} {...bind("phone")} />
          </Field>
          <Field label="Email">
            <input type="email" maxLength={250} {...bind("email")} />
          </Field>
          <Field label="Payment terms (days)">
            <input
              type="number"
              min="0"
              max="365"
              required
              {...bind("terms_days")}
            />
          </Field>
          <Field label="Category">
            <select {...bind("category")}>
              {[...new Set([...(state.categories ? state.categories.filter(c=>c.active).map(c=>c.name) : CATEGORIES), f.category])]
                .filter(Boolean)
                .map((x) => (
                  <option key={x}>{x}</option>
                ))}
            </select>
          </Field>
          <Field label="Status">
            <select {...bind("status")}>
              {STATUSES.map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </Field>
          <Field label="Address" wide>
            <textarea rows="2" maxLength={1000} {...bind("address")} />
          </Field>
          <Field label="Notes" wide>
            <textarea rows="2" maxLength={3000} {...bind("notes")} />
          </Field>
        </div>
        <p className="muted">
          Opening balances are entered as invoices so every amount has a record.
          Inactivate suppliers to preserve their history.
        </p>
        <ErrorMessage error={error} />
        <Footer
          busy={busy}
          onClose={onClose}
          label={supplier ? "Update supplier" : "Save supplier"}
        />
      </form>
    </Modal>
  );
}
export function InvoiceDialog({
  invoice,
  state,
  onClose,
  onSubmit,
  supplierId = "",
}) {
  const [f, setF] = useState(
    invoice
      ? {
          ...invoice,
          ...Object.fromEntries(
            ["subtotal", "tax", "shipping", "discount"].map((k) => [
              k,
              (invoice[k + "_cents"] / 100).toFixed(2),
            ]),
          ),
        }
      : {
          supplier_id: supplierId,
          number: "",
          issue_date: today(),
          due_date: addDays(
            today(),
            state.suppliers.find((s) => s.id === supplierId)?.terms_days ??
              state.settings.terms_days,
          ),
          category: state.categories?.find(c=>c.active)?.name || "Food & Beverages",
          description: "",
          subtotal: "",
          tax: "0.00",
          shipping: "0.00",
          discount: "0.00",
        },
  );
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  function update(name, value) {
    const next = { ...f, [name]: value };
    if (name === "supplier_id" || name === "issue_date") {
      const s = state.suppliers.find((x) => x.id === next.supplier_id);
      next.due_date = addDays(
        next.issue_date,
        s?.terms_days ?? state.settings.terms_days,
      );
    }
    setF(next);
  }
  const bind = (name) => ({
    value: f[name] ?? "",
    onChange: (e) => update(name, e.target.value),
  });
  let total = null;
  try {
    total =
      cents(f.subtotal || 0) +
      cents(f.tax) +
      cents(f.shipping) -
      cents(f.discount);
  } catch {
    /* A partially typed amount is not yet a valid total. */
  }
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const payload = { ...f };
      for (const k of ["subtotal", "tax", "shipping", "discount"]) {
        payload[k + "_cents"] = cents(f[k]);
        delete payload[k];
      }
      await onSubmit("invoice.save", payload);
      onClose();
    } catch (x) {
      setError(x.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={invoice ? "Edit draft invoice" : "New invoice"}
      subtitle="Save a draft, review the amounts, then approve it for payment."
      onClose={onClose}
      busy={busy}
    >
      <form onSubmit={submit}>
        <div className="form-grid">
          <Field label="Supplier *" wide>
            <select required {...bind("supplier_id")}>
              <option value="">Select a supplier</option>
              {state.suppliers
                .filter((x) => x.status === "Active" || x.id === f.supplier_id)
                .map((x) => (
                  <option value={x.id} key={x.id}>
                    {x.business_name}
                    {x.status !== "Active" ? " (inactive)" : ""}
                  </option>
                ))}
            </select>
          </Field>
          <Field label="Invoice number *">
            <input required maxLength={100} {...bind("number")} />
          </Field>
          <Field label="Category">
            <select {...bind("category")}>
              {[...new Set([...(state.categories ? state.categories.filter(c=>c.active).map(c=>c.name) : CATEGORIES), f.category])]
                .filter(Boolean)
                .map((x) => (
                  <option key={x}>{x}</option>
                ))}
            </select>
          </Field>
          <Field label="Invoice date *">
            <input type="date" required {...bind("issue_date")} />
          </Field>
          <Field label="Due date *">
            <input
              type="date"
              required
              min={f.issue_date}
              {...bind("due_date")}
            />
          </Field>
          {["subtotal", "tax", "shipping", "discount"].map((k) => (
            <Field
              label={
                {
                  subtotal: "Subtotal ($) *",
                  tax: "Tax ($)",
                  shipping: "Shipping / fees ($)",
                  discount: "Discount ($)",
                }[k]
              }
              key={k}
            >
              <input
                required
                type="number"
                min="0"
                max="1000000000"
                step="0.01"
                {...bind(k)}
              />
            </Field>
          ))}
          <Field label="Description / notes" wide>
            <textarea
              rows="3"
              maxLength={3000}
              placeholder="Products purchased, service period or opening balance details"
              {...bind("description")}
            />
          </Field>
        </div>
        <div className="total-line">
          <span>Invoice total</span>
          <strong>{total === null ? "—" : money(total)}</strong>
        </div>
        <ErrorMessage error={error} />
        <Footer busy={busy} onClose={onClose} label="Save draft" />
      </form>
    </Modal>
  );
}
export function PaymentDialog({ invoice, state, onClose, onSubmit }) {
  const due = balance(state, invoice),
    supplier = state.suppliers.find((x) => x.id === invoice.supplier_id);
  const [f, setF] = useState({
    amount: (due / 100).toFixed(2),
    date: today(),
    method: "ACH",
    reference: "",
    notes: "",
  });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const bind = (name) => ({
    value: f[name],
    onChange: (e) => setF({ ...f, [name]: e.target.value }),
  });
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await onSubmit("payment.record", {
        invoice_id: invoice.id,
        ...f,
        amount_cents: cents(f.amount),
      });
      onClose();
    } catch (x) {
      setError(x.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="Record payment"
      subtitle={`${supplier?.business_name} · ${invoice.number}`}
      onClose={onClose}
      busy={busy}
    >
      <form onSubmit={submit}>
        <div className="callout">
          <span>Outstanding balance</span>
          <strong>{money(due)}</strong>
        </div>
        <div className="form-grid">
          <Field label="Amount ($) *">
            <input
              required
              type="number"
              step="0.01"
              min="0.01"
              max={due / 100}
              {...bind("amount")}
            />
          </Field>
          <Field label="Payment date *">
            <input
              type="date"
              required
              min={invoice.issue_date}
              max={today()}
              {...bind("date")}
            />
          </Field>
          <Field label="Method">
            <select {...bind("method")}>
              {METHODS.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          </Field>
          <Field label="Reference / check number">
            <input maxLength={250} {...bind("reference")} />
          </Field>
          <Field label="Notes" wide>
            <textarea rows="2" maxLength={3000} {...bind("notes")} />
          </Field>
        </div>
        <p className="muted">
          Records a payment you have already made. No funds will be transferred.
        </p>
        <ErrorMessage error={error} />
        <Footer busy={busy} onClose={onClose} label="Record payment" />
      </form>
    </Modal>
  );
}
export function ConfirmDialog({
  title,
  message,
  reason = false,
  onClose,
  onConfirm,
}) {
  const [value, setValue] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await onConfirm(value);
      onClose();
    } catch (x) {
      setError(x.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={title} onClose={onClose} busy={busy}>
      <form onSubmit={submit}>
        <p>{message}</p>
        {reason && (
          <Field label="Reason *">
            <textarea
              required
              minLength={5}
              maxLength={1000}
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          </Field>
        )}
        <ErrorMessage error={error} />
        <Footer busy={busy} onClose={onClose} label="Confirm" />
      </form>
    </Modal>
  );
}
export function InvoiceDetail({
  invoice,
  state,
  onClose,
  onEdit,
  onPay,
  onApprove,
  onVoid,
  canWrite,
  isAdmin,
}) {
  const supplier = state.suppliers.find((x) => x.id === invoice.supplier_id),
    payments = state.payments.filter((p) => p.invoice_id === invoice.id);
  return (
    <Modal
      title={invoice.number}
      subtitle={supplier?.business_name}
      onClose={onClose}
      wide
    >
      <div className="invoice-detail printable">
        <div className="print-only">
          <h1>{state.settings.business_name}</h1>
          <p>{state.settings.address}</p>
          <h2>Invoice record · {invoice.number}</h2>
        </div>
        <div className="detail-top">
          <Badge>{invoiceStatus(state, invoice)}</Badge>
          <span>
            Invoice: {dateLabel(invoice.issue_date)}
            <br />
            Due: {dateLabel(invoice.due_date)}
          </span>
        </div>
        <h3>{supplier?.business_name}</h3>
        <p>{invoice.description || "No description supplied."}</p>
        <dl className="amounts">
          {["subtotal", "tax", "shipping", "discount"].map((k) => (
            <div key={k}>
              <dt>{k[0].toUpperCase() + k.slice(1)}</dt>
              <dd>{money(invoice[k + "_cents"])}</dd>
            </div>
          ))}
          <div>
            <dt>Total</dt>
            <dd>{money(invoiceTotal(invoice))}</dd>
          </div>
          <div>
            <dt>Paid</dt>
            <dd>{money(invoicePaid(state, invoice.id))}</dd>
          </div>
          <div className="total-line">
            <dt>Balance</dt>
            <dd>{money(balance(state, invoice))}</dd>
          </div>
        </dl>
        {invoice.void_reason && (
          <div className="alert">Voided: {invoice.void_reason}</div>
        )}
        <h3>Payment history</h3>
        {payments.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Method / reference</th>
                  <th>Amount</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id}>
                    <td>{dateLabel(p.date)}</td>
                    <td>
                      {p.method} · {p.reference || "—"}
                    </td>
                    <td>{money(p.amount_cents)}</td>
                    <td>
                      <Badge>{p.reversed_at ? "Reversed" : "Recorded"}</Badge>
                      {p.reversal_reason && <small>{p.reversal_reason}</small>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">No payments recorded.</p>
        )}
      </div>
      <div className="modal-footer">
        <Button kind="secondary" onClick={() => window.print()}>
          <Printer size={16} />
          Print
        </Button>
        {canWrite && invoice.status === "Draft" && (
          <>
            <Button kind="secondary" onClick={onEdit}>
              Edit draft
            </Button>
            <Button onClick={onApprove}>Approve invoice</Button>
          </>
        )}
        {canWrite &&
          invoice.status === "Approved" &&
          balance(state, invoice) > 0 && (
            <Button onClick={onPay}>
              <CreditCard size={16} />
              Record payment
            </Button>
          )}
        {isAdmin &&
          invoice.status !== "Void" &&
          invoicePaid(state, invoice.id) === 0 && (
            <Button kind="danger" onClick={onVoid}>
              Void
            </Button>
          )}
      </div>
    </Modal>
  );
}
