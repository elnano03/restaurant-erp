import { useState } from "react";
import {
  Plus,
  ArrowUpRight,
  Download,
  Printer,
  Wallet,
  Clock,
  CheckCircle2,
  AlertCircle,
  FileText,
  Pencil,
  ChevronRight,
  Archive,
} from "lucide-react";
import {
  Stat,
  Button,
  Badge,
  Empty,
  SearchBox,
  Pagination,
  Field,
} from "./common";
import {
  money,
  today,
  addDays,
  dateLabel,
  invoiceStatus,
  invoiceTotal,
  invoicePaid,
  balance,
  supplierBalance,
  aging,
  STATUSES,
  VERSION,
} from "../core/domain";
import { download, exportCSV } from "../core/export";

const supplierName = (s, id) =>
  s.suppliers.find((x) => x.id === id)?.business_name || "Unknown supplier";
export function InvoiceRows({ state, items, onOpen, onPay, canWrite }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Invoice / supplier</th>
            <th>Due date</th>
            <th>Status</th>
            <th className="numeric">Total</th>
            <th className="numeric">Balance</th>
            <th className="no-print">Actions</th>
          </tr>
        </thead>
        <tbody>
          {items.map((i) => (
            <tr key={i.id}>
              <td>
                <button className="text-link" onClick={() => onOpen(i)}>
                  {i.number}
                </button>
                <small>{supplierName(state, i.supplier_id)}</small>
              </td>
              <td>{dateLabel(i.due_date)}</td>
              <td>
                <Badge>{invoiceStatus(state, i)}</Badge>
                {i.payment_hold && (
                  <small>Payment hold · {i.hold_reason}</small>
                )}
              </td>
              <td className="numeric">{money(invoiceTotal(i))}</td>
              <td className="numeric strong">{money(balance(state, i))}</td>
              <td className="no-print">
                <div className="row-actions">
                  <Button kind="ghost small" onClick={() => onOpen(i)}>
                    View
                  </Button>
                  {canWrite &&
                    i.status === "Approved" &&
                    !i.payment_hold &&
                    balance(state, i) > 0 && (
                      <Button kind="secondary small" onClick={() => onPay(i)}>
                        Pay
                      </Button>
                    )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Dashboard({ state, open, navigate, canWrite }) {
  const at = today(),
    approved = state.invoices.filter((i) => i.status === "Approved"),
    outstanding = approved.filter((i) => balance(state, i) > 0),
    overdue = outstanding.filter((i) => i.due_date < at),
    dueSoon = outstanding.filter(
      (i) => i.due_date >= at && i.due_date <= addDays(at, 7),
    );
  const paid = state.payments
      .filter((p) => !p.reversed_at && p.date.slice(0, 7) === at.slice(0, 7))
      .reduce((n, p) => n + p.amount_cents, 0),
    buckets = aging(state),
    sum = outstanding.reduce((n, i) => n + balance(state, i), 0),
    max = Math.max(1, ...buckets.map((x) => x.value));
  const next = [...outstanding]
    .sort((a, b) => a.due_date.localeCompare(b.due_date))
    .slice(0, 6);
  const suppliers = state.suppliers
    .map((s) => ({ ...s, balance: supplierBalance(state, s.id) }))
    .filter((s) => s.balance > 0)
    .sort((a, b) => b.balance - a.balance)
    .slice(0, 4);
  return (
    <>
      <div className="page-title">
        <div>
          <p className="eyebrow">YOUR BUSINESS AT A GLANCE</p>
          <h1>Accounts payable</h1>
          <p>Know what you owe. Plan what comes next.</p>
        </div>
        {canWrite && (
          <Button onClick={() => open({ kind: "invoice" })}>
            <Plus size={18} />
            New invoice
          </Button>
        )}
      </div>
      <div className="stats">
        <Stat
          label="Total outstanding"
          value={money(sum)}
          hint={`${outstanding.length} unpaid invoices`}
          icon={Wallet}
        />
        <Stat
          label="Overdue"
          value={money(overdue.reduce((n, i) => n + balance(state, i), 0))}
          hint={`${overdue.length} invoices need attention`}
          icon={AlertCircle}
          tone="red"
        />
        <Stat
          label="Due in 7 days"
          value={money(dueSoon.reduce((n, i) => n + balance(state, i), 0))}
          hint={`${dueSoon.length} upcoming invoices`}
          icon={Clock}
          tone="amber"
        />
        <Stat
          label="Paid this month"
          value={money(paid)}
          hint="Recorded payments, excluding reversals"
          icon={CheckCircle2}
          tone="green"
        />
      </div>
      <div className="dashboard-grid">
        <section className="panel">
          <div className="panel-title">
            <div>
              <h2>Aging overview</h2>
              <p>Outstanding balances by days past due</p>
            </div>
            <span className="tag">USD</span>
          </div>
          <div className="aging-chart">
            {buckets.map((b, n) => (
              <div key={b.label} className="bar-column">
                <strong>{money(b.value)}</strong>
                <div className="bar-track">
                  <div
                    className={"bar bar-" + n}
                    style={{
                      height: `${Math.max(b.value > 0 ? 4 : 0, (b.value / max) * 100)}%`,
                    }}
                  />
                </div>
                <span>{b.label}</span>
              </div>
            ))}
          </div>
        </section>
        <section className="panel">
          <div className="panel-title">
            <div>
              <h2>Supplier balances</h2>
              <p>Largest outstanding amounts</p>
            </div>
            <Button
              kind="icon ghost"
              aria-label="View suppliers"
              onClick={() => navigate("/suppliers")}
            >
              <ArrowUpRight size={20} />
            </Button>
          </div>
          {suppliers.length ? (
            suppliers.map((s, n) => (
              <div className="supplier-summary" key={s.id}>
                <div className="avatar">{String(n + 1).padStart(2, "0")}</div>
                <div>
                  <strong>{s.business_name}</strong>
                  <small>{s.category || "Uncategorized"}</small>
                </div>
                <b>{money(s.balance)}</b>
              </div>
            ))
          ) : (
            <Empty title="All clear">
              Supplier balances will appear when invoices are approved.
            </Empty>
          )}
          <div className="draft-callout">
            <FileText size={20} />
            <div>
              <strong>
                {state.invoices.filter((i) => i.status === "Draft").length}{" "}
                draft invoices
              </strong>
              <small>Not included in outstanding balances</small>
            </div>
          </div>
        </section>
      </div>
      <section className="panel">
        <div className="panel-title">
          <div>
            <h2>Payment priorities</h2>
            <p>Unpaid invoices, earliest due first</p>
          </div>
          <Button kind="ghost" onClick={() => navigate("/invoices")}>
            View all
            <ChevronRight size={16} />
          </Button>
        </div>
        {next.length ? (
          <InvoiceRows
            state={state}
            items={next}
            canWrite={canWrite}
            onOpen={(i) => open({ kind: "detail", id: i.id })}
            onPay={(i) => open({ kind: "payment", id: i.id })}
          />
        ) : (
          <Empty title="No outstanding invoices">
            Create and approve your first invoice to begin tracking payments.
          </Empty>
        )}
      </section>
    </>
  );
}
export function Suppliers({ state, open, canWrite, navigate }) {
  const [q, setQ] = useState(""),
    [status, setStatus] = useState("All"),
    [page, setPage] = useState(1);
  const items = state.suppliers
    .filter(
      (s) =>
        (status === "All" || s.status === status) &&
        [s.business_name, s.email, s.phone, s.category]
          .join(" ")
          .toLowerCase()
          .includes(q.toLowerCase()),
    )
    .sort((a, b) => a.business_name.localeCompare(b.business_name));
  function exportRows() {
    exportCSV("sintech-suppliers.csv", [
      [
        "Business name",
        "Contact",
        "Email",
        "Phone",
        "Category",
        "Status",
        "Terms days",
        "Outstanding USD",
      ],
      ...items.map((s) => [
        s.business_name,
        s.contact,
        s.email,
        s.phone,
        s.category,
        s.status,
        s.terms_days,
        (supplierBalance(state, s.id) / 100).toFixed(2),
      ]),
    ]);
  }
  return (
    <>
      <div className="page-title">
        <div>
          <p className="eyebrow">YOUR BUSINESS PARTNERS</p>
          <h1>Suppliers</h1>
          <p>Manage contacts, terms and outstanding balances.</p>
        </div>
        {canWrite && (
          <Button onClick={() => open({ kind: "supplier" })}>
            <Plus size={18} />
            New supplier
          </Button>
        )}
      </div>
      <section className="panel">
        <div className="toolbar">
          <SearchBox
            value={q}
            onChange={(v) => {
              setQ(v);
              setPage(1);
            }}
            placeholder="Search suppliers…"
          />
          <select
            aria-label="Supplier status"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            <option>All</option>
            {STATUSES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <Button kind="secondary" onClick={exportRows}>
            <Download size={16} />
            Export
          </Button>
        </div>
        {items.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Supplier</th>
                  <th>Contact</th>
                  <th>Terms</th>
                  <th>Status</th>
                  <th className="numeric">Outstanding</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.slice((page - 1) * 15, page * 15).map((s) => (
                  <tr key={s.id}>
                    <td>
                      <strong>{s.business_name}</strong>
                      <small>{s.category}</small>
                    </td>
                    <td>
                      {s.contact || s.email || "—"}
                      <small>{s.phone}</small>
                    </td>
                    <td>
                      {s.terms_days === 0
                        ? "Due on receipt"
                        : `Net ${s.terms_days}`}
                    </td>
                    <td>
                      <Badge>{s.status}</Badge>
                    </td>
                    <td className="numeric strong">
                      {money(supplierBalance(state, s.id))}
                    </td>
                    <td>
                      <div className="row-actions">
                        {canWrite && (
                          <Button
                            kind="ghost small"
                            onClick={() => open({ kind: "supplier", id: s.id })}
                          >
                            <Pencil size={14} />
                            Edit
                          </Button>
                        )}
                        <Button
                          kind="ghost small"
                          onClick={() => navigate("/reports?supplier=" + s.id)}
                        >
                          Statement
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title={
              state.suppliers.length
                ? "No matching suppliers"
                : "Add your first supplier"
            }
          >
            Keep your vendors organized in one place.
          </Empty>
        )}
        <Pagination page={page} setPage={setPage} total={items.length} />
      </section>
    </>
  );
}
export function Invoices({ state, open, canWrite, navigate }) {
  const [q, setQ] = useState(""),
    [status, setStatus] = useState("All"),
    [supplier, setSupplier] = useState(""),
    [page, setPage] = useState(1);
  const items = state.invoices
    .filter(
      (i) =>
        (!supplier || supplier === i.supplier_id) &&
        (status === "All" || invoiceStatus(state, i) === status) &&
        [i.number, supplierName(state, i.supplier_id), i.description]
          .join(" ")
          .toLowerCase()
          .includes(q.toLowerCase()),
    )
    .sort(
      (a, b) =>
        b.issue_date.localeCompare(a.issue_date) ||
        b.created_at.localeCompare(a.created_at),
    );
  function exportRows() {
    exportCSV("sintech-invoices.csv", [
      [
        "Invoice",
        "Supplier",
        "Invoice date",
        "Due date",
        "Status",
        "Category",
        "Total USD",
        "Paid USD",
        "Balance USD",
      ],
      ...items.map((i) => [
        i.number,
        supplierName(state, i.supplier_id),
        i.issue_date,
        i.due_date,
        invoiceStatus(state, i),
        i.category,
        (invoiceTotal(i) / 100).toFixed(2),
        (invoicePaid(state, i.id) / 100).toFixed(2),
        (balance(state, i) / 100).toFixed(2),
      ]),
    ]);
  }
  return (
    <>
      <div className="page-title">
        <div>
          <p className="eyebrow">FROM PURCHASE TO PAYMENT</p>
          <h1>Invoices</h1>
          <p>Review, approve and track every bill.</p>
        </div>
        {canWrite && (
          <div className="actions">
            {state.business_id && (
              <Button
                kind="secondary"
                onClick={() => navigate("/invoice-import")}
              >
                Upload & read invoice
              </Button>
            )}
            <Button onClick={() => open({ kind: "invoice" })}>
              <Plus size={18} />
              New invoice
            </Button>
          </div>
        )}
      </div>
      <section className="panel">
        <div className="toolbar">
          <SearchBox
            value={q}
            onChange={(v) => {
              setQ(v);
              setPage(1);
            }}
            placeholder="Search invoices…"
          />
          <select
            aria-label="Invoice status"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            {["All", "Draft", "Open", "Partial", "Overdue", "Paid", "Void"].map(
              (s) => (
                <option key={s}>{s}</option>
              ),
            )}
          </select>
          <select
            aria-label="Invoice supplier"
            value={supplier}
            onChange={(e) => {
              setSupplier(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All suppliers</option>
            {state.suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.business_name}
              </option>
            ))}
          </select>
          <Button kind="secondary" onClick={exportRows}>
            <Download size={16} />
            Export
          </Button>
        </div>
        {items.length ? (
          <InvoiceRows
            state={state}
            items={items.slice((page - 1) * 15, page * 15)}
            canWrite={canWrite}
            onOpen={(i) => open({ kind: "detail", id: i.id })}
            onPay={(i) => open({ kind: "payment", id: i.id })}
          />
        ) : (
          <Empty title="No invoices found">
            Create a draft invoice or adjust the filters.
          </Empty>
        )}
        <Pagination page={page} setPage={setPage} total={items.length} />
      </section>
    </>
  );
}
export function Payments({ state, open, isAdmin }) {
  const [q, setQ] = useState(""),
    [status, setStatus] = useState("All"),
    [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [page, setPage] = useState(1);
  const items = state.payments
    .map((p) => ({
      ...p,
      invoice: state.invoices.find((i) => i.id === p.invoice_id),
    }))
    .filter(
      (p) =>
        (status === "All" ||
          (status === "Reversed" ? p.reversed_at : !p.reversed_at)) &&
        (!from || p.date >= from) &&
        (!to || p.date <= to) &&
        [
          p.reference,
          p.invoice?.number,
          supplierName(state, p.invoice?.supplier_id),
        ]
          .join(" ")
          .toLowerCase()
          .includes(q.toLowerCase()),
    )
    .sort((a, b) => b.date.localeCompare(a.date));
  function exportRows() {
    exportCSV("sintech-payments.csv", [
      [
        "Date",
        "Supplier",
        "Invoice",
        "Method",
        "Reference",
        "Amount USD",
        "Reversed at",
        "Reversal reason",
      ],
      ...items.map((p) => [
        p.date,
        supplierName(state, p.invoice?.supplier_id),
        p.invoice?.number,
        p.method,
        p.reference,
        (p.amount_cents / 100).toFixed(2),
        p.reversed_at,
        p.reversal_reason,
      ]),
    ]);
  }
  return (
    <>
      <div className="page-title">
        <div>
          <p className="eyebrow">A CLEAR PAYMENT TRAIL</p>
          <h1>Payments</h1>
          <p>
            Record payments from an approved invoice. Reverse mistakes with a
            reason.
          </p>
        </div>
        <Button kind="secondary" onClick={exportRows}>
          <Download size={16} />
          Export payments
        </Button>
      </div>
      <section className="panel">
        <div className="toolbar">
          <SearchBox
            value={q}
            onChange={(v) => {
              setQ(v);
              setPage(1);
            }}
            placeholder="Search payments…"
          />
          <select
            aria-label="Payment status"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            {["All", "Recorded", "Reversed"].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <input
            type="date"
            aria-label="Payments from"
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
              setPage(1);
            }}
          />
          <input
            type="date"
            aria-label="Payments to"
            value={to}
            min={from}
            onChange={(e) => {
              setTo(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <div className="section-note">
          Filtered active payments:{" "}
          <strong>
            {money(
              items
                .filter((p) => !p.reversed_at)
                .reduce((n, p) => n + p.amount_cents, 0),
            )}
          </strong>
        </div>
        {items.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Date / supplier</th>
                  <th>Invoice</th>
                  <th>Method / reference</th>
                  <th className="numeric">Amount</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.slice((page - 1) * 15, page * 15).map((p) => (
                  <tr key={p.id}>
                    <td>
                      {dateLabel(p.date)}
                      <small>
                        {supplierName(state, p.invoice?.supplier_id)}
                      </small>
                    </td>
                    <td>
                      <button
                        className="text-link"
                        onClick={() =>
                          open({ kind: "detail", id: p.invoice_id })
                        }
                      >
                        {p.invoice?.number}
                      </button>
                    </td>
                    <td>
                      {p.method}
                      <small>{p.reference || "No reference"}</small>
                    </td>
                    <td className="numeric strong">{money(p.amount_cents)}</td>
                    <td>
                      <Badge>{p.reversed_at ? "Reversed" : "Recorded"}</Badge>
                      <small>{p.reversal_reason}</small>
                    </td>
                    <td>
                      {isAdmin && !p.reversed_at && (
                        <Button
                          kind="ghost danger-text small"
                          onClick={() => open({ kind: "reverse", id: p.id })}
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
          <Empty title="No payments found">
            Payment records will appear here after you record them on an
            invoice.
          </Empty>
        )}
        <Pagination page={page} setPage={setPage} total={items.length} />
      </section>
    </>
  );
}
export function Reports({ state, initialSupplier = "" }) {
  const [type, setType] = useState(
      initialSupplier ? "Supplier statement" : "Aging",
    ),
    [supplier, setSupplier] = useState(initialSupplier),
    [from, setFrom] = useState(today().slice(0, 7) + "-01"),
    [to, setTo] = useState(today());
  let headers = [],
    rows = [];
  let note = "";
  if (type === "Aging") {
    headers = [
      "Supplier",
      "Current",
      "1–30 days",
      "31–60 days",
      "61–90 days",
      "90+ days",
      "Total",
    ];
    rows = state.suppliers.map((s) => {
      const b = aging({
        ...state,
        invoices: state.invoices.filter((i) => i.supplier_id === s.id),
      });
      return [
        s.business_name,
        ...b.map((x) => money(x.value)),
        money(b.reduce((n, x) => n + x.value, 0)),
      ];
    });
    note =
      "Current approved balances, excluding drafts and voided invoices. As of " +
      dateLabel(today()) +
      ".";
  } else if (type === "Supplier statement") {
    headers = [
      "Invoice",
      "Invoice date",
      "Due date",
      "Status",
      "Total",
      "Paid",
      "Outstanding",
    ];
    rows = state.invoices
      .filter(
        (i) =>
          (!supplier || i.supplier_id === supplier) && i.status === "Approved",
      )
      .sort((a, b) => a.issue_date.localeCompare(b.issue_date))
      .map((i) => [
        i.number,
        dateLabel(i.issue_date),
        dateLabel(i.due_date),
        invoiceStatus(state, i),
        money(invoiceTotal(i)),
        money(invoicePaid(state, i.id)),
        money(balance(state, i)),
      ]);
    note =
      "Current statement for " +
      (supplier ? supplierName(state, supplier) : "all suppliers") +
      ". Total outstanding: " +
      money(
        state.invoices
          .filter(
            (i) =>
              i.status === "Approved" &&
              (!supplier || i.supplier_id === supplier),
          )
          .reduce((n, i) => n + balance(state, i), 0),
      ) +
      ".";
  } else if (type === "Purchases by category") {
    headers = ["Category", "Invoices", "Total invoiced"];
    const groups = {};
    state.invoices
      .filter(
        (i) =>
          i.status === "Approved" && i.issue_date >= from && i.issue_date <= to,
      )
      .forEach((i) => {
        const k = i.category || "Other";
        groups[k] ??= { count: 0, total: 0 };
        groups[k].count++;
        groups[k].total += invoiceTotal(i);
      });
    rows = Object.entries(groups).map(([k, v]) => [k, v.count, money(v.total)]);
    note =
      "Approved purchases by invoice date, including paid invoices. " +
      dateLabel(from) +
      " – " +
      dateLabel(to) +
      ".";
  } else {
    headers = ["Date", "Supplier", "Invoice", "Method", "Reference", "Amount"];
    rows = state.payments
      .filter((p) => !p.reversed_at && p.date >= from && p.date <= to)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((p) => {
        const i = state.invoices.find((x) => x.id === p.invoice_id);
        return [
          dateLabel(p.date),
          supplierName(state, i?.supplier_id),
          i?.number,
          p.method,
          p.reference,
          money(p.amount_cents),
        ];
      });
    note =
      "Recorded cash outflow by payment date. Reversed payments excluded. " +
      dateLabel(from) +
      " – " +
      dateLabel(to) +
      ".";
  }
  return (
    <>
      <div className="page-title no-print">
        <div>
          <p className="eyebrow">DECISIONS WITH CONTEXT</p>
          <h1>Reports</h1>
          <p>Clear summaries for purchasing and payment planning.</p>
        </div>
        <div className="row-actions">
          <Button
            kind="secondary"
            onClick={() =>
              exportCSV("sintech-report.csv", [
                [state.settings.business_name],
                [type],
                [note],
                [],
                headers,
                ...rows,
              ])
            }
          >
            <Download size={16} />
            Export CSV
          </Button>
          <Button onClick={() => window.print()}>
            <Printer size={16} />
            Print / PDF
          </Button>
        </div>
      </div>
      <section className="panel">
        <div className="toolbar no-print">
          <select
            aria-label="Report type"
            value={type}
            onChange={(e) => setType(e.target.value)}
          >
            {[
              "Aging",
              "Supplier statement",
              "Purchases by category",
              "Payment register",
            ].map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
          {type === "Supplier statement" && (
            <select
              aria-label="Statement supplier"
              value={supplier}
              onChange={(e) => setSupplier(e.target.value)}
            >
              <option value="">All suppliers</option>
              {state.suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.business_name}
                </option>
              ))}
            </select>
          )}
          {["Purchases by category", "Payment register"].includes(type) && (
            <>
              <input
                type="date"
                aria-label="Report from"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
              <input
                type="date"
                aria-label="Report to"
                min={from}
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </>
          )}
        </div>
        <div className="report-heading">
          <p className="eyebrow">{state.settings.business_name}</p>
          <h2>{type}</h2>
          <p>{note}</p>
        </div>
        {rows.length ? (
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
                {rows.map((r, n) => (
                  <tr key={n}>
                    {r.map((cell, k) => (
                      <td key={k}>{cell}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="No records in this report">
            Adjust your filters or add records to get started.
          </Empty>
        )}
        <div className="report-footer">
          SINTECH ERP · Generated {dateLabel(today())} · USD
        </div>
      </section>
    </>
  );
}
export function Audit({ state }) {
  const [q, setQ] = useState(""),
    [page, setPage] = useState(1),
    [expanded, setExpanded] = useState(null);
  const items = state.audit.filter((a) =>
    [a.type, a.actor, a.after?.number, a.after?.business_name, a.entity_id]
      .join(" ")
      .toLowerCase()
      .includes(q.toLowerCase()),
  );
  return (
    <>
      <div className="page-title">
        <div>
          <p className="eyebrow">ACCOUNTABILITY BUILT IN</p>
          <h1>Activity log</h1>
          <p>Who changed what, with the original and updated values.</p>
        </div>
        <Button
          kind="secondary"
          onClick={() =>
            download(
              "sintech-audit.json",
              JSON.stringify(items, null, 2),
              "application/json",
            )
          }
        >
          <Download size={16} />
          Export log
        </Button>
      </div>
      <section className="panel">
        <div className="toolbar">
          <SearchBox
            value={q}
            onChange={(v) => {
              setQ(v);
              setPage(1);
            }}
            placeholder="Search activity…"
          />
        </div>
        {items.slice((page - 1) * 15, page * 15).map((a) => (
          <div className="audit-entry" key={a.id}>
            <button
              className="audit-toggle"
              onClick={() => setExpanded(expanded === a.id ? null : a.id)}
            >
              <span className="activity-dot" />
              <span>
                <strong>{a.type.replace(".", " · ")}</strong>
                <small>
                  {a.actor} ·{" "}
                  {new Date(a.at).toLocaleString("en-US", {
                    timeZone: "America/New_York",
                  })}{" "}
                  ET
                </small>
              </span>
              <span className="audit-name">
                {a.after?.number || a.after?.business_name || "View changes"}
              </span>
              <ChevronRight size={16} />
            </button>
            {expanded === a.id && (
              <div className="audit-values">
                <div>
                  <h4>Before</h4>
                  <pre>{JSON.stringify(a.before, null, 2)}</pre>
                </div>
                <div>
                  <h4>After</h4>
                  <pre>{JSON.stringify(a.after, null, 2)}</pre>
                </div>
              </div>
            )}
          </div>
        ))}
        {!items.length && (
          <Empty title="No activity yet">
            Changes will be recorded automatically.
          </Empty>
        )}
        <Pagination page={page} setPage={setPage} total={items.length} />
      </section>
    </>
  );
}
export function Settings({ state, mode, isAdmin, onSubmit, reload, open }) {
  const [f, setF] = useState(state.settings),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  const bind = (k) => ({
    value: f[k] ?? "",
    onChange: (e) => setF({ ...f, [k]: e.target.value }),
  });
  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await onSubmit("settings.save", {
        ...f,
        terms_days: Number(f.terms_days),
      });
      setMessage("Business settings saved.");
    } catch (x) {
      setError(x.message);
    } finally {
      setBusy(false);
    }
  }
  async function importFile(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      if (file.size > 15000000)
        throw new Error("Backup must be smaller than 15 MB.");
      const data = JSON.parse(await file.text());
      open({ kind: "restore", data });
    } catch (x) {
      setError(x.message);
    }
  }
  return (
    <>
      <div className="page-title">
        <div>
          <p className="eyebrow">MAKE IT YOURS</p>
          <h1>Settings</h1>
          <p>Business details, data ownership and connection status.</p>
        </div>
        <span className="tag">v{VERSION}</span>
      </div>
      <div className="settings-grid">
        <section className="panel">
          <div className="panel-title">
            <h2>Business profile</h2>
          </div>
          <form onSubmit={save}>
            <fieldset disabled={!isAdmin || busy}>
              <div className="form-grid">
                <Field label="Business name *" wide>
                  <input required maxLength={250} {...bind("business_name")} />
                </Field>
                <Field label="Phone">
                  <input {...bind("phone")} />
                </Field>
                <Field label="Email">
                  <input type="email" {...bind("email")} />
                </Field>
                <Field label="Address" wide>
                  <textarea rows="2" {...bind("address")} />
                </Field>
                <Field label="Default terms (days)">
                  <input
                    required
                    type="number"
                    min="0"
                    max="365"
                    {...bind("terms_days")}
                  />
                </Field>
                <Field label="Currency">
                  <input value="USD — US Dollar" disabled />
                </Field>
              </div>
              <div className="form-actions">
                <Button disabled={busy || !isAdmin}>
                  {busy ? "Saving…" : "Save settings"}
                </Button>
              </div>
            </fieldset>
          </form>
          {error && <div className="alert error">{error}</div>}
          {message && <div className="alert success">{message}</div>}
        </section>
        <div>
          <section className="panel">
            <div className="panel-title">
              <h2>Data & backups</h2>
              <Archive size={20} />
            </div>
            <p>
              {mode === "cloud"
                ? "Records are stored in your Supabase project. Download an export for your own archive. Cloud restore requires a database administrator."
                : "Records are saved in this browser only. Export a backup regularly and before clearing browser data or changing computers."}
            </p>
            <div className="stack">
              <Button
                kind="secondary"
                onClick={() =>
                  download(
                    `SINTECH-backup-${today()}.json`,
                    JSON.stringify(
                      { ...state, exported_at: new Date().toISOString() },
                      null,
                      2,
                    ),
                    "application/json",
                  )
                }
              >
                <Download size={16} />
                Download full backup
              </Button>
              {mode !== "cloud" && (
                <label className="button secondary file-label">
                  Restore a backup
                  <input
                    type="file"
                    accept="application/json,.json"
                    onChange={importFile}
                  />
                </label>
              )}
              <Button kind="ghost" onClick={reload}>
                Refresh records
              </Button>
            </div>
          </section>
          <section className="panel connection">
            <h2>Workspace</h2>
            <dl>
              <div>
                <dt>Storage</dt>
                <dd>
                  {mode === "cloud"
                    ? "Supabase"
                    : mode === "demo"
                      ? "Demo — sample records"
                      : "Local browser"}
                </dd>
              </div>
              <div>
                <dt>Access</dt>
                <dd>{mode === "cloud" ? state.role : "Local owner"}</dd>
              </div>
              <div>
                <dt>Business timezone</dt>
                <dd>America/New_York</dd>
              </div>
            </dl>
            <p className="muted">
              Local mode is for one trusted operator. Shared users and
              permissions are enforced in cloud mode.
            </p>
          </section>
        </div>
      </div>
    </>
  );
}
