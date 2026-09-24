import { useEffect, useRef, useState } from "react";
import { Button, Field, Empty } from "./common";
import { cloud, selectedBusiness } from "../core/repository";
import { cents, money, today, addDays, uid } from "../core/domain";
import {
  fileHash,
  parseInvoice,
  readInvoice,
  validateInvoiceFile,
} from "../core/invoice-reader";
import { exportCSV } from "../core/export";
import "./invoice-import.css";
const blankLine = () => ({
  description: "",
  quantity: "",
  unit: "",
  unit_price: "",
  amount: "",
  track_stock: true,
  product_id: "",
  product_name: "",
  stock_unit: "",
  stock_quantity: "",
  sku: "",
});
const safeCents = (x) => (/^\d+(\.\d{1,2})?$/.test(String(x)) ? cents(x) : NaN);
export function InvoiceImport({
  state,
  onSubmit,
  canWrite,
  navigate,
  initialDocumentId = "",
}) {
  const [file, setFile] = useState(null),
    [docId, setDocId] = useState(initialDocumentId),
    [source, setSource] = useState(null),
    [form, setForm] = useState(null),
    [text, setText] = useState(""),
    [busy, setBusy] = useState(false),
    [progress, setProgress] = useState(""),
    [error, setError] = useState(""),
    [reviewed, setReviewed] = useState(false),
    [received, setReceived] = useState(true),
    [receivedDate, setReceivedDate] = useState(today()),
    [posted, setPosted] = useState(null),
    [preview, setPreview] = useState("");
  const uploadRef = useRef(null);
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );
  const activeDocs = (state.documents || []).filter((d) => !d.archived_at);
  async function read(selected, doc = null) {
    setBusy(true);
    setError("");
    setPosted(null);
    setReviewed(false);
    setForm(null);
    setText("");
    setSource(null);
    uploadRef.current = null;
    try {
      validateInvoiceFile(selected);
      setFile(selected);
      setPreview(URL.createObjectURL(selected));
      const hash = await fileHash(selected);
      const duplicate = (state.invoice_imports || []).find(
        (x) => x.file_hash === hash || x.path === doc?.path,
      );
      if (duplicate)
        throw new Error(
          "This document was already posted. Check the existing invoice in Invoices.",
        );
      const raw = await readInvoice(selected, setProgress);
      if (!raw.trim())
        throw new Error("No readable text found. Use a clearer scan or image.");
      setText(raw);
      const data = parseInvoice(raw, state);
      const supplier = state.suppliers.find((s) => s.id === data.supplier_id);
      setForm({
        ...data,
        supplier_id: data.supplier_id || "new",
        category: state.categories?.find((c) => c.active)?.name || "",
        contact: "",
        phone: data.supplier_phone,
        email: data.supplier_email,
        address: data.supplier_address,
        terms_days: supplier?.terms_days ?? state.settings.terms_days,
        due_date:
          data.due_date ||
          (data.issue_date
            ? addDays(
                data.issue_date,
                supplier?.terms_days ?? state.settings.terms_days,
              )
            : ""),
        lines: data.lines.length ? data.lines : [blankLine()],
      });
      setSource({ hash, path: doc?.path || null });
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
      setProgress("");
    }
  }
  async function readExisting() {
    setBusy(true);
    setError("");
    try {
      const d = activeDocs.find((d) => d.id === docId);
      if (!d) throw new Error("Choose an existing document.");
      const r = await cloud.storage.from("sintech-documents").download(d.path);
      if (r.error) throw r.error;
      await read(new File([r.data], d.name, { type: d.mime }), d);
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }
  const change = (key, value) => {
    setForm((f) => ({ ...f, [key]: value }));
    setReviewed(false);
  };
  const lineChange = (index, patch) => {
    setForm((f) => ({
      ...f,
      lines: f.lines.map((r, n) => (n === index ? { ...r, ...patch } : r)),
    }));
    setReviewed(false);
  };
  const lineTotal = form?.lines.reduce((n, l) => n + safeCents(l.amount), 0);
  const expected = form
    ? safeCents(form.subtotal) +
      safeCents(form.tax) +
      safeCents(form.shipping) -
      safeCents(form.discount)
    : NaN;
  const reconciled =
    form &&
    Number.isFinite(lineTotal) &&
    lineTotal === safeCents(form.subtotal) &&
    expected === safeCents(form.total) &&
    expected > 0;
  async function post(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (!reviewed || !reconciled)
        throw new Error(
          "Review all fields and reconcile product lines, subtotal and total.",
        );
      if (selectedBusiness() !== state.business_id)
        throw new Error("The selected business changed. Reopen this import.");
      const lines = form.lines.map((l) => ({
        ...l,
        quantity: Number(l.quantity),
        unit_price: Number(l.unit_price),
        amount_cents: cents(l.amount),
        stock_quantity: l.track_stock ? Number(l.stock_quantity) : 0,
        product_name: l.product_name || l.description,
      }));
      if (
        lines.some(
          (l) =>
            !l.description.trim() ||
            !(l.quantity > 0) ||
            !l.unit.trim() ||
            !Number.isFinite(l.unit_price) ||
            l.unit_price < 0 ||
            (l.track_stock &&
              (!(l.stock_quantity > 0) || !l.stock_unit.trim())),
        )
      )
        throw new Error(
          "Every row needs a description, billing quantity/unit and price. Inventory rows also need stock quantity/unit.",
        );
      if (
        !window.confirm(
          `Post invoice ${form.number} for ${money(expected)}? ${received ? "Receive the selected inventory quantities now." : "Inventory will wait for receipt."} This creates an approved payable and links the document to the new invoice.`,
        )
      )
        return;
      let path = source.path || uploadRef.current;
      if (!path) {
        path =
          state.business_id +
          "/" +
          uid() +
          "/" +
          file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        const r = await cloud.storage
          .from("sintech-documents")
          .upload(path, file, { contentType: file.type, upsert: false });
        if (r.error) throw r.error;
        uploadRef.current = path;
      }
      if (selectedBusiness() !== state.business_id)
        throw new Error("The selected business changed. Reopen this import.");
      const result = await onSubmit("invoice.import", {
        supplier_id: form.supplier_id === "new" ? null : form.supplier_id,
        new_supplier:
          form.supplier_id === "new"
            ? {
                business_name: form.supplier_name,
                category: form.category,
                terms_days: Number(form.terms_days),
                contact: form.contact,
                phone: form.phone,
                email: form.email,
                address: form.address,
              }
            : null,
        number: form.number,
        issue_date: form.issue_date,
        due_date: form.due_date,
        category: form.category,
        subtotal_cents: cents(form.subtotal),
        tax_cents: cents(form.tax),
        shipping_cents: cents(form.shipping),
        discount_cents: cents(form.discount),
        total_cents: cents(form.total),
        lines,
        received,
        received_date: receivedDate,
        reviewed: true,
        path,
        file_hash: source.hash,
        file_name: file.name,
        mime: file.type,
        size: file.size,
      });
      setPosted({
        number: form.number,
        total: expected,
        invoice: result?.invoice_imports?.find(
          (x) => x.file_hash === source.hash,
        )?.invoice_id,
      });
      setForm(null);
      setFile(null);
      setSource(null);
      setPreview("");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  if (!canWrite)
    return (
      <Empty title="Read-only access">
        An administrator or accountant can import invoices.
      </Empty>
    );
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">INVOICES & INVENTORY</p>
          <h1>Import invoice</h1>
          <p>
            Read a PDF or image, review its products and totals, then post the
            payable and inventory together.
          </p>
        </div>
      </div>
      {error && (
        <div className="alert error" role="alert">
          {error}
        </div>
      )}
      {posted && (
        <section className="panel">
          <h2>
            Invoice {posted.number} posted · {money(posted.total)}
          </h2>
          <p>
            The document is linked to the invoice. Inventory and accounts
            payable were saved in one transaction.
          </p>
          <div className="actions">
            <Button onClick={() => navigate("/invoices")}>View invoices</Button>
            <Button kind="secondary" onClick={() => navigate("/inventory")}>
              View inventory
            </Button>
          </div>
        </section>
      )}
      <section className="panel">
        <div className="form-grid">
          <Field label="Upload an invoice (PDF or image)">
            <input
              disabled={busy}
              type="file"
              accept="application/pdf,image/png,image/jpeg,image/webp"
              onChange={(e) => {
                if (e.target.files[0]) read(e.target.files[0]);
              }}
            />
          </Field>
          <Field label="Or read an existing document">
            <select
              disabled={busy}
              value={docId}
              onChange={(e) => setDocId(e.target.value)}
            >
              <option value="">Choose document…</option>
              {activeDocs.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Button
          kind="secondary"
          disabled={busy || !docId}
          onClick={readExisting}
        >
          Read selected document
        </Button>
        <p role="status">
          {busy
            ? progress || "Saving…"
            : "PDF/image reading runs on this device. Files are uploaded to your private business storage when you post."}
        </p>
      </section>
      {form && (
        <form onSubmit={post}>
          <fieldset disabled={busy} className="import-fieldset">
            <div className="invoice-review">
              <section className="panel original-preview">
                <h2>Original invoice</h2>
                {file?.type === "application/pdf" ? (
                  <iframe title="Original invoice" src={preview} />
                ) : (
                  <img alt="Original invoice" src={preview} />
                )}
                <a href={preview} target="_blank" rel="noreferrer">
                  Open original
                </a>
                <details>
                  <summary>Recognized text</summary>
                  <pre>{text}</pre>
                </details>
              </section>
              <section className="panel">
                <h2>Review invoice details</h2>
                <div className="alert">
                  {form.warnings.map((w, n) => (
                    <p key={n}>{w}</p>
                  ))}
                </div>
                <div className="form-grid">
                  <Field label="Supplier">
                    <select
                      required
                      value={form.supplier_id}
                      onChange={(e) => {
                        const s = state.suppliers.find(
                          (x) => x.id === e.target.value,
                        );
                        setForm((f) => ({
                          ...f,
                          supplier_id: e.target.value,
                          terms_days: s?.terms_days ?? f.terms_days,
                          due_date: f.issue_date
                            ? addDays(
                                f.issue_date,
                                s?.terms_days ?? f.terms_days,
                              )
                            : f.due_date,
                        }));
                        setReviewed(false);
                      }}
                    >
                      <option value="new">
                        Create new supplier from this invoice
                      </option>
                      {state.suppliers
                        .filter((s) => s.status === "Active")
                        .map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.business_name}
                          </option>
                        ))}
                    </select>
                  </Field>
                  {form.supplier_id === "new" && (
                    <>
                      <Field label="New supplier name">
                        <input
                          required
                          value={form.supplier_name}
                          onChange={(e) =>
                            change("supplier_name", e.target.value)
                          }
                        />
                      </Field>
                      {["contact", "phone", "email", "address"].map((k) => (
                        <Field key={k} label={"Supplier " + k}>
                          <input
                            type={k === "email" ? "email" : "text"}
                            value={form[k]}
                            onChange={(e) => change(k, e.target.value)}
                          />
                        </Field>
                      ))}
                    </>
                  )}
                  <Field label="Category">
                    <select
                      required
                      value={form.category}
                      onChange={(e) => change("category", e.target.value)}
                    >
                      <option value="">Choose category</option>
                      {state.categories
                        .filter((c) => c.active)
                        .map((c) => (
                          <option key={c.id}>{c.name}</option>
                        ))}
                    </select>
                  </Field>
                  <Field label="Invoice number">
                    <input
                      required
                      value={form.number}
                      onChange={(e) => change("number", e.target.value)}
                    />
                  </Field>
                  <Field label="Invoice date">
                    <input
                      required
                      type="date"
                      max={today()}
                      value={form.issue_date}
                      onChange={(e) => {
                        setForm((f) => ({
                          ...f,
                          issue_date: e.target.value,
                          due_date: e.target.value
                            ? addDays(e.target.value, f.terms_days)
                            : "",
                        }));
                        setReviewed(false);
                      }}
                    />
                  </Field>
                  <Field label="Payment terms (days)">
                    <input
                      required
                      type="number"
                      min="0"
                      max="365"
                      value={form.terms_days}
                      onChange={(e) => {
                        setForm((f) => ({
                          ...f,
                          terms_days: e.target.value,
                          due_date: f.issue_date
                            ? addDays(f.issue_date, Number(e.target.value))
                            : "",
                        }));
                        setReviewed(false);
                      }}
                    />
                  </Field>
                  <Field label="Due date">
                    <input
                      required
                      type="date"
                      min={form.issue_date}
                      value={form.due_date}
                      onChange={(e) => change("due_date", e.target.value)}
                    />
                  </Field>
                </div>
              </section>
            </div>
            <section className="panel">
              <h2>Products and invoice lines</h2>
              <p>
                Match each item to inventory or create a product. Enter stock
                quantity in the product’s inventory unit: 2 cases of 12 bottles
                means 24 bottles if inventory is kept in bottles. Uncheck
                Inventory for services or non-stock expenses.
              </p>
              <div className="table-wrap import-lines">
                <table>
                  <thead>
                    <tr>
                      {[
                        "Description",
                        "Billed qty",
                        "Billed unit",
                        "Unit price $",
                        "Line amount $",
                        "Inventory",
                        "Product",
                        "Stock qty",
                        "Stock unit",
                        "",
                      ].map((h, n) => (
                        <th key={n}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {form.lines.map((l, index) => (
                      <tr key={index}>
                        <td>
                          <textarea
                            rows={2}
                            aria-label={"Description " + (index + 1)}
                            required
                            value={l.description}
                            onChange={(e) =>
                              lineChange(index, {
                                description: e.target.value,
                                product_name: e.target.value,
                              })
                            }
                          />
                          {(l.sku || l.brand) && (
                            <small className="line-reader-meta">
                              {l.sku && `Code: ${l.sku}`}
                              {l.brand && ` · Brand: ${l.brand}`}
                            </small>
                          )}
                          {l.total_weight && (
                            <small className="line-reader-meta">
                              Packages ordered: {l.ordered_quantity} ·
                              Delivered: {l.delivered_quantity} · Total weight:{" "}
                              {l.total_weight}
                            </small>
                          )}
                          {l.reader_notes?.map((note, n) => (
                            <small className="line-reader-note" key={n}>
                              {note}
                            </small>
                          ))}
                          {l.source && (
                            <details className="line-source">
                              <summary>Source lines</summary>
                              <pre>{l.source}</pre>
                            </details>
                          )}
                        </td>
                        {["quantity", "unit", "unit_price", "amount"].map(
                          (k) => (
                            <td key={k}>
                              <input
                                aria-label={k + " " + (index + 1)}
                                required
                                type={k === "unit" ? "text" : "number"}
                                min={k === "quantity" ? "0.001" : "0"}
                                step={
                                  k === "quantity"
                                    ? "0.001"
                                    : k === "unit_price"
                                      ? "0.0001"
                                      : "0.01"
                                }
                                value={l[k]}
                                onChange={(e) =>
                                  lineChange(index, { [k]: e.target.value })
                                }
                              />
                            </td>
                          ),
                        )}
                        <td>
                          <input
                            aria-label={"Inventory " + (index + 1)}
                            type="checkbox"
                            checked={l.track_stock}
                            onChange={(e) =>
                              lineChange(index, {
                                track_stock: e.target.checked,
                              })
                            }
                          />
                        </td>
                        <td>
                          {l.track_stock && (
                            <select
                              aria-label={"Product " + (index + 1)}
                              value={l.product_id}
                              onChange={(e) => {
                                const p = state.products?.find(
                                  (p) => p.id === e.target.value,
                                );
                                lineChange(index, {
                                  product_id: e.target.value,
                                  stock_unit: p?.unit || l.unit,
                                });
                              }}
                            >
                              <option value="">
                                New: {l.description || "product"}
                              </option>
                              {(state.products || [])
                                .filter((p) => p.active)
                                .map((p) => (
                                  <option key={p.id} value={p.id}>
                                    {p.name} · {p.unit}
                                  </option>
                                ))}
                            </select>
                          )}
                        </td>
                        <td>
                          {l.track_stock && (
                            <input
                              aria-label={"Stock quantity " + (index + 1)}
                              required
                              type="number"
                              min="0.001"
                              step="0.001"
                              value={l.stock_quantity}
                              onChange={(e) =>
                                lineChange(index, {
                                  stock_quantity: e.target.value,
                                })
                              }
                            />
                          )}
                        </td>
                        <td>
                          {l.track_stock && (
                            <input
                              aria-label={"Stock unit " + (index + 1)}
                              required
                              readOnly={!!l.product_id}
                              value={l.stock_unit}
                              onChange={(e) =>
                                lineChange(index, {
                                  stock_unit: e.target.value,
                                })
                              }
                            />
                          )}
                        </td>
                        <td>
                          <Button
                            type="button"
                            kind="ghost"
                            onClick={() => {
                              setForm((f) => ({
                                ...f,
                                lines: f.lines.filter((_, n) => n !== index),
                              }));
                              setReviewed(false);
                            }}
                          >
                            Remove
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Button
                type="button"
                kind="secondary"
                onClick={() => {
                  setForm((f) => ({ ...f, lines: [...f.lines, blankLine()] }));
                  setReviewed(false);
                }}
              >
                Add product line
              </Button>
              <p>
                Sum of line amounts:{" "}
                {Number.isFinite(lineTotal) ? money(lineTotal) : "Incomplete"}
              </p>
            </section>
            <section className="panel">
              <div className="form-grid">
                {["subtotal", "tax", "shipping", "discount", "total"].map(
                  (k) => (
                    <Field key={k} label={"Invoice " + k + " ($)"}>
                      <input
                        required
                        type="number"
                        min="0"
                        step="0.01"
                        value={form[k]}
                        onChange={(e) => change(k, e.target.value)}
                      />
                    </Field>
                  ),
                )}
              </div>
              <p className={reconciled ? "reconcile-ok" : "reconcile-error"}>
                {reconciled
                  ? "Product lines and invoice total reconcile."
                  : "Product lines must equal subtotal; subtotal + tax + shipping − discount must equal the printed total."}
              </p>
              <label className="inline-check">
                <input
                  type="checkbox"
                  checked={received}
                  onChange={(e) => {
                    setReceived(e.target.checked);
                    setReviewed(false);
                  }}
                />
                Goods have been received — add reviewed stock quantities now
              </label>
              {received && (
                <Field label="Receipt date">
                  <input
                    required
                    type="date"
                    min={form.issue_date}
                    max={today()}
                    value={receivedDate}
                    onChange={(e) => {
                      setReceivedDate(e.target.value);
                      setReviewed(false);
                    }}
                  />
                </Field>
              )}
              <label className="inline-check">
                <input
                  required
                  type="checkbox"
                  checked={reviewed}
                  onChange={(e) => setReviewed(e.target.checked)}
                />
                I checked the supplier, invoice number, dates, every
                product/unit/quantity and the printed total.
              </label>
              <p>
                Posting creates an approved payable. Existing opening-balance
                invoices are kept unchanged; reconcile them separately to avoid
                counting the same debt twice.
              </p>
              <Button
                disabled={
                  busy || !reconciled || !reviewed || !form.lines.length
                }
              >
                {busy
                  ? "Posting…"
                  : received
                    ? "Post invoice & receive inventory"
                    : "Post invoice — receive later"}
              </Button>
            </section>
          </fieldset>
        </form>
      )}
    </>
  );
}
export function Inventory({ state, onSubmit, canWrite, isAdmin }) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [edit, setEdit] = useState(null),
    [adjust, setAdjust] = useState(null),
    [query, setQuery] = useState("");
  const products = state.products || [],
    moves = state.inventory_moves || [];
  const stock = (id) =>
    moves
      .filter((m) => m.product_id === id)
      .reduce((n, m) => n + Number(m.quantity), 0);
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
  const pending = state.invoices.filter(
    (i) =>
      i.status === "Approved" &&
      !i.inventory_received_at &&
      (state.invoice_lines || []).some(
        (l) => l.invoice_id === i.id && l.product_id,
      ),
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">PRODUCTS & RECEIPTS</p>
          <h1>Inventory</h1>
          <p>
            Stock reflects receipts, kitchen preparation, waste and audited
            adjustments. Invoice uploads alone do not change stock.
          </p>
        </div>
        <div className="actions">
          {isAdmin && (
            <Button
              onClick={() =>
                setEdit({ name: "", sku: "", unit: "ea", active: true })
              }
            >
              New product
            </Button>
          )}
          <Button
            kind="secondary"
            onClick={() =>
              exportCSV("inventory.csv", [
                ["Product", "SKU", "Unit", "On hand"],
                ...products.map((p) => [p.name, p.sku, p.unit, stock(p.id)]),
              ])
            }
          >
            Export inventory
          </Button>
        </div>
      </div>
      {error && (
        <div role="alert" className="alert error">
          {error}
        </div>
      )}
      {edit && (
        <form
          className="panel"
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              await onSubmit("product.save", edit);
              setEdit(null);
            });
          }}
        >
          <h2>{edit.id ? "Edit product" : "New product"}</h2>
          <div className="form-grid">
            {["name", "sku", "unit"].map((k) => (
              <Field key={k} label={"Product " + k}>
                <input
                  required={k !== "sku"}
                  value={edit[k]}
                  onChange={(e) => setEdit({ ...edit, [k]: e.target.value })}
                />
              </Field>
            ))}
          </div>
          <label className="inline-check">
            <input
              type="checkbox"
              checked={edit.active}
              onChange={(e) => setEdit({ ...edit, active: e.target.checked })}
            />
            Active
          </label>
          <Button disabled={busy}>Save product</Button>
          <Button
            type="button"
            kind="ghost"
            disabled={busy}
            onClick={() => setEdit(null)}
          >
            Cancel
          </Button>
        </form>
      )}
      {adjust && (
        <form
          className="panel"
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              await onSubmit("inventory.adjust", {
                ...adjust,
                quantity: Number(adjust.quantity),
              });
              setAdjust(null);
            });
          }}
        >
          <h2>
            Adjust stock ·{" "}
            {products.find((p) => p.id === adjust.product_id)?.name}
          </h2>
          <div className="form-grid">
            <Field label="Quantity change (+ receipt / − usage)">
              <input
                required
                type="number"
                step="0.001"
                value={adjust.quantity}
                onChange={(e) =>
                  setAdjust({ ...adjust, quantity: e.target.value })
                }
              />
            </Field>
            <Field label="Movement date">
              <input
                type="date"
                required
                max={today()}
                value={adjust.date}
                onChange={(e) => setAdjust({ ...adjust, date: e.target.value })}
              />
            </Field>
            <Field label="Reason">
              <input
                required
                minLength="5"
                value={adjust.reason}
                onChange={(e) =>
                  setAdjust({ ...adjust, reason: e.target.value })
                }
              />
            </Field>
          </div>
          <Button disabled={busy}>Save adjustment</Button>
          <Button
            type="button"
            kind="ghost"
            disabled={busy}
            onClick={() => setAdjust(null)}
          >
            Cancel
          </Button>
        </form>
      )}
      <Field label="Search products">
        <input value={query} onChange={(e) => setQuery(e.target.value)} />
      </Field>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {["Product", "SKU", "Unit", "On hand", "Status", "Actions"].map(
                (x) => (
                  <th key={x}>{x}</th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {products
              .filter((p) =>
                (p.name + " " + p.sku)
                  .toLowerCase()
                  .includes(query.toLowerCase()),
              )
              .map((p) => (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td>{p.sku}</td>
                  <td>{p.unit}</td>
                  <td>
                    {stock(p.id).toLocaleString(undefined, {
                      maximumFractionDigits: 3,
                    })}
                  </td>
                  <td>{p.active ? "Active" : "Archived"}</td>
                  <td>
                    {isAdmin && (
                      <div className="actions">
                        <Button kind="ghost" onClick={() => setEdit(p)}>
                          Edit
                        </Button>
                        {p.active && (
                          <Button
                            kind="ghost"
                            onClick={() =>
                              setAdjust({
                                product_id: p.id,
                                quantity: "",
                                date: today(),
                                reason: "",
                              })
                            }
                          >
                            Adjust
                          </Button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      <h2>Invoices awaiting receipt</h2>
      {pending.map((i) => (
        <section className="panel" key={i.id}>
          <strong>
            {i.number} ·{" "}
            {state.suppliers.find((s) => s.id === i.supplier_id)?.business_name}
          </strong>
          <p>
            {(state.invoice_lines || [])
              .filter((l) => l.invoice_id === i.id && l.product_id)
              .map(
                (l) =>
                  `${l.stock_quantity} ${products.find((p) => p.id === l.product_id)?.unit} ${l.description}`,
              )
              .join(" · ") || "No stock items"}
          </p>
          {canWrite && (
            <Button
              disabled={busy}
              onClick={() =>
                run(async () => {
                  if (
                    window.confirm(
                      "Confirm all listed inventory quantities have arrived today?",
                    )
                  )
                    await onSubmit("inventory.receive", {
                      id: i.id,
                      date: today(),
                    });
                })
              }
            >
              Receive goods today
            </Button>
          )}
        </section>
      ))}
      {!pending.length && <p>No invoices awaiting receipt.</p>}
      <h2>Stock movements</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {["Date", "Product", "Quantity", "Type", "Reason"].map((x) => (
                <th key={x}>{x}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[...moves]
              .sort((a, b) => b.created_at.localeCompare(a.created_at))
              .slice(0, 150)
              .map((m) => (
                <tr key={m.id}>
                  <td>{m.date}</td>
                  <td>{products.find((p) => p.id === m.product_id)?.name}</td>
                  <td>{m.quantity}</td>
                  <td>{m.kind}</td>
                  <td>{m.reason}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      <p>
        Showing the latest 150 movements. All movements remain in business
        backups.
      </p>
    </>
  );
}
