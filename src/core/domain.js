export const VERSION = "2.0.0";
export const STATUSES = ["Active", "Inactive", "Blocked"];
export const CATEGORIES = [
  "Food & Beverages",
  "Packaging",
  "Utilities",
  "Rent",
  "Equipment",
  "Maintenance",
  "Services",
  "Other",
];
export const METHODS = ["ACH", "Check", "Cash", "Card", "Wire", "Other"];
export const uid = () => crypto.randomUUID();
export const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
export const money = (cents) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    (cents || 0) / 100,
  );
export const dateLabel = (value) =>
  value
    ? new Date(`${value}T12:00:00Z`).toLocaleDateString("en-US", {
        timeZone: "UTC",
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "—";
export function addDays(date, days) {
  const d = new Date(date + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + Number(days));
  return d.toISOString().slice(0, 10);
}
export function cents(value) {
  const s = String(value ?? "").trim();
  if (!/^\d+(\.\d{1,2})?$/.test(s))
    throw new Error("Enter a positive amount with up to two decimals.");
  const [a, b = ""] = s.split(".");
  const n = Number(a) * 100 + Number(b.padEnd(2, "0"));
  if (!Number.isSafeInteger(n) || n > 100000000000)
    throw new Error("Amount is too large.");
  return n;
}
export function validDate(d) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(d || "") &&
    !Number.isNaN(Date.parse(d)) &&
    new Date(d).toISOString().slice(0, 10) === d
  );
}
const check = (condition, message) => {
  if (!condition) throw new Error(message);
};
const amount = (n) => Number.isSafeInteger(n) && n >= 0 && n <= 100000000000;
const text = (s, max = 250) =>
  String(s ?? "")
    .trim()
    .slice(0, max);
export function normalizeStatus(status) {
  return (
    {
      activo: "Active",
      inactivo: "Inactive",
      bloqueado: "Blocked",
      active: "Active",
      inactive: "Inactive",
      blocked: "Blocked",
    }[String(status).toLowerCase()] || "Inactive"
  );
}
export function emptyState() {
  return {
    schema: 1,
    revision: 0,
    suppliers: [],
    invoices: [],
    payments: [],
    audit: [],
    settings: {
      business_name: "SINTECH Restaurant",
      address: "",
      phone: "",
      email: "",
      terms_days: 30,
    },
    commands: [],
  };
}
export function invoiceTotal(i) {
  return i.subtotal_cents + i.tax_cents + i.shipping_cents - i.discount_cents;
}
export function invoicePaid(state, id, asOf = "9999-12-31") {
  return state.payments
    .filter(
      (p) =>
        p.invoice_id === id &&
        p.date <= asOf &&
        (!p.reversed_at || p.reversed_at.slice(0, 10) > asOf),
    )
    .reduce((n, p) => n + p.amount_cents, 0);
}
export function balance(state, i, asOf = "9999-12-31") {
  return i.status === "Void"
    ? 0
    : invoiceTotal(i) - invoicePaid(state, i.id, asOf) - (state.credit_allocations || []).filter(a => a.invoice_id === i.id && a.date <= asOf && (!a.reversed_at || a.reversed_at.slice(0,10) > asOf)).reduce((sum,a) => sum+a.amount_cents,0);
}
export function invoiceStatus(state, i, at = today()) {
  if (i.status === "Void" || i.status === "Draft") return i.status;
  if (balance(state, i) === 0) return "Paid";
  if (i.due_date < at) return "Overdue";
  return balance(state,i) < invoiceTotal(i) ? "Partial" : "Open";
}
export function supplierBalance(state, id) {
  return state.invoices
    .filter((i) => i.supplier_id === id && i.status === "Approved")
    .reduce((n, i) => n + balance(state, i), 0);
}
export function aging(state, at = today()) {
  const buckets = [
    { label: "Current", value: 0 },
    { label: "1–30 days", value: 0 },
    { label: "31–60 days", value: 0 },
    { label: "61–90 days", value: 0 },
    { label: "90+ days", value: 0 },
  ];
  for (const i of state.invoices.filter((i) => i.status === "Approved")) {
    const days = Math.floor(
      (Date.parse(at) - Date.parse(i.due_date)) / 86400000,
    );
    buckets[
      days <= 0 ? 0 : days <= 30 ? 1 : days <= 60 ? 2 : days <= 90 ? 3 : 4
    ].value += balance(state, i);
  }
  return buckets;
}
export function applyCommand(
  original,
  command,
  actor = "Local owner",
  role = "admin",
  now = new Date().toISOString(),
) {
  check(
    ["admin", "accountant"].includes(role),
    "Your account has read-only access.",
  );
  check(command && command.id && command.type, "Invalid command.");
  if (original.commands.includes(command.id)) return original;
  const s = structuredClone(original),
    p = command.payload || {},
    type = command.type;
  const at = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(now));
  let before = null,
    after = null,
    entityId = p.id;
  if (type === "supplier.save") {
    before = s.suppliers.find((x) => x.id === p.id);
    check(!p.id || before, "Supplier no longer exists. Refresh and try again.");
    check(
      !before || before.version === p.version,
      "This supplier changed in another session. Refresh and reopen it.",
    );
    const name = text(p.business_name);
    check(name, "Business name is required.");
    check(
      !s.suppliers.some(
        (x) =>
          x.id !== p.id && x.business_name.toLowerCase() === name.toLowerCase(),
      ),
      "A supplier with this name already exists.",
    );
    check(STATUSES.includes(p.status), "Choose a valid supplier status.");
    check(
      !p.email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email),
      "Enter a valid email.",
    );
    check(
      Number.isInteger(p.terms_days) &&
        p.terms_days >= 0 &&
        p.terms_days <= 365,
      "Payment terms must be 0–365 days.",
    );
    after = {
      id: before?.id || command.id,
      business_name: name,
      contact: text(p.contact),
      phone: text(p.phone, 60),
      email: text(p.email),
      address: text(p.address, 1000),
      category: text(p.category),
      status: p.status,
      terms_days: p.terms_days,
      notes: text(p.notes, 3000),
      version: (before?.version || 0) + 1,
      created_at: before?.created_at || now,
    };
    if (before)
      s.suppliers = s.suppliers.map((x) => (x.id === p.id ? after : x));
    else s.suppliers.push(after);
    entityId = after.id;
  } else if (type === "invoice.save") {
    before = s.invoices.find((x) => x.id === p.id);
    check(!p.id || before, "Invoice no longer exists.");
    check(
      !before || (before.status === "Draft" && before.version === p.version),
      "Only unchanged drafts can be edited. Refresh and reopen the invoice.",
    );
    const supplier = s.suppliers.find((x) => x.id === p.supplier_id);
    check(
      supplier && supplier.status === "Active",
      "Choose an active supplier.",
    );
    const number = text(p.number, 100);
    check(number, "Invoice number is required.");
    check(
      !s.invoices.some(
        (x) =>
          x.id !== p.id &&
          x.supplier_id === p.supplier_id &&
          x.number.toLowerCase() === number.toLowerCase(),
      ),
      "This invoice number already exists for this supplier, including voided invoices.",
    );
    check(
      validDate(p.issue_date) &&
        validDate(p.due_date) &&
        p.due_date >= p.issue_date,
      "Due date must be on or after the invoice date.",
    );
    check(
      ["subtotal_cents", "tax_cents", "shipping_cents", "discount_cents"].every(
        (k) => amount(p[k]),
      ),
      "Invalid invoice amounts.",
    );
    check(
      invoiceTotal(p) > 0 && invoiceTotal(p) <= 100000000000,
      "Invoice total must be greater than zero and within the limit.",
    );
    after = {
      id: before?.id || command.id,
      supplier_id: p.supplier_id,
      number,
      issue_date: p.issue_date,
      due_date: p.due_date,
      category: text(p.category),
      description: text(p.description, 3000),
      subtotal_cents: p.subtotal_cents,
      tax_cents: p.tax_cents,
      shipping_cents: p.shipping_cents,
      discount_cents: p.discount_cents,
      status: "Draft",
      version: (before?.version || 0) + 1,
      created_at: before?.created_at || now,
    };
    if (before) s.invoices = s.invoices.map((x) => (x.id === p.id ? after : x));
    else s.invoices.push(after);
    entityId = after.id;
  } else if (type === "invoice.approve" || type === "invoice.void") {
    const i = s.invoices.find((x) => x.id === p.id);
    check(i, "Invoice not found.");
    before = structuredClone(i);
    check(
      i.version === p.version,
      "Invoice changed. Refresh before continuing.",
    );
    if (type === "invoice.approve") {
      check(i.status === "Draft", "Only drafts can be approved.");
      check(
        s.suppliers.find((x) => x.id === i.supplier_id)?.status === "Active",
        "Supplier is not active.",
      );
      i.status = "Approved";
      i.approved_at = now;
    } else {
      check(role === "admin", "Only an administrator can void invoices.");
      check(
        i.status !== "Void" && invoicePaid(s, i.id) === 0,
        "Reverse recorded payments before voiding this invoice.",
      );
      check(
        text(p.reason).length >= 5,
        "Enter a reason of at least five characters.",
      );
      i.status = "Void";
      i.void_reason = text(p.reason, 1000);
      i.voided_at = now;
    }
    i.version++;
    after = i;
  } else if (type === "payment.record") {
    const i = s.invoices.find((x) => x.id === p.invoice_id);
    check(i?.status === "Approved", "Payments require an approved invoice.");
    check(
      s.suppliers.find((x) => x.id === i.supplier_id)?.status !== "Blocked",
      "Payments to a blocked supplier are not allowed.",
    );
    check(
      amount(p.amount_cents) &&
        p.amount_cents > 0 &&
        p.amount_cents <= balance(s, i),
      "Payment must be greater than zero and cannot exceed the outstanding balance.",
    );
    check(
      validDate(p.date) && p.date >= i.issue_date && p.date <= at,
      "Payment date must be between invoice date and today.",
    );
    check(METHODS.includes(p.method), "Choose a payment method.");
    after = {
      id: command.id,
      invoice_id: i.id,
      amount_cents: p.amount_cents,
      date: p.date,
      method: p.method,
      reference: text(p.reference),
      notes: text(p.notes, 3000),
      created_at: now,
      reversed_at: null,
    };
    s.payments.push(after);
    entityId = after.id;
  } else if (type === "payment.reverse") {
    check(role === "admin", "Only an administrator can reverse payments.");
    const payment = s.payments.find((x) => x.id === p.id);
    check(
      payment && !payment.reversed_at,
      "Payment is missing or already reversed.",
    );
    check(
      s.invoices.find((x) => x.id === payment.invoice_id)?.status !== "Void",
      "Invoice is void.",
    );
    check(
      text(p.reason).length >= 5,
      "Enter a reason of at least five characters.",
    );
    before = structuredClone(payment);
    payment.reversed_at = now;
    payment.reversal_reason = text(p.reason, 1000);
    after = payment;
  } else if (type === "settings.save") {
    check(
      role === "admin",
      "Only an administrator can change business settings.",
    );
    check(text(p.business_name), "Business name is required.");
    check(
      Number.isInteger(p.terms_days) &&
        p.terms_days >= 0 &&
        p.terms_days <= 365,
      "Invalid payment terms.",
    );
    before = s.settings;
    after = {
      business_name: text(p.business_name),
      address: text(p.address, 1000),
      phone: text(p.phone, 60),
      email: text(p.email),
      terms_days: p.terms_days,
    };
    s.settings = after;
    entityId = "settings";
  } else throw new Error("Unknown operation.");
  s.audit.unshift({
    id: command.id,
    type,
    entity_id: entityId,
    actor,
    at: now,
    before: before || null,
    after: structuredClone(after),
  });
  s.commands.push(command.id);
  s.revision++;
  return s;
}
export function validateBackup(s) {
  check(
    s?.schema === 1 &&
      Number.isInteger(s.revision) &&
      s.settings &&
      typeof s.settings.business_name === "string",
    "This is not a SINTECH v1 backup.",
  );
  for (const key of ["suppliers", "invoices", "payments", "audit", "commands"])
    check(Array.isArray(s[key]), `Invalid backup: ${key}.`);
  for (const key of ["suppliers", "invoices", "payments"])
    check(
      new Set(s[key].map((x) => x.id)).size === s[key].length &&
        s[key].every((x) => typeof x.id === "string" && x.id),
      "Duplicate or missing IDs.",
    );
  for (const x of s.suppliers)
    check(
      typeof x.business_name === "string" && STATUSES.includes(x.status),
      "Invalid supplier.",
    );
  const seen = new Set();
  for (const i of s.invoices) {
    check(
      s.suppliers.some((x) => x.id === i.supplier_id),
      "Invoice references an unknown supplier.",
    );
    check(
      ["Draft", "Approved", "Void"].includes(i.status) &&
        validDate(i.issue_date) &&
        validDate(i.due_date) &&
        i.due_date >= i.issue_date,
      "Invalid invoice status or dates.",
    );
    check(
      ["subtotal_cents", "tax_cents", "shipping_cents", "discount_cents"].every(
        (k) => amount(i[k]),
      ) && invoiceTotal(i) > 0,
      "Invalid invoice amount.",
    );
    const key = i.supplier_id + ":" + String(i.number).toLowerCase();
    check(!seen.has(key), "Duplicate invoice number.");
    seen.add(key);
  }
  for (const p of s.payments) {
    const i = s.invoices.find((x) => x.id === p.invoice_id);
    check(
      i &&
        amount(p.amount_cents) &&
        p.amount_cents > 0 &&
        validDate(p.date) &&
        p.date >= i.issue_date &&
        METHODS.includes(p.method),
      "Invalid payment.",
    );
    check(
      p.reversed_at || i.status === "Approved",
      "Payment on an unapproved invoice.",
    );
  }
  for (const i of s.invoices)
    check(
      invoicePaid(s, i.id) <= invoiceTotal(i),
      "Backup contains an overpaid invoice.",
    );
  return s;
}
export function demoState() {
  let s = emptyState();
  s.settings.business_name = "La Casa del Chimi · Sample data";
  const run = (type, payload) => {
    const c = { id: uid(), type, payload };
    s = applyCommand(s, c);
    return c.id;
  };
  const ids = ["Nebraska", "Quaker", "Eagles Foods"].map((name, n) =>
    run("supplier.save", {
      business_name: name,
      status: "Active",
      category: "Food & Beverages",
      terms_days: [14, 30, 7][n],
    }),
  );
  [128450, 86325, 242800, 51900, 73950, 186200].forEach((n, k) => {
    const id = run("invoice.save", {
      supplier_id: ids[k % 3],
      number: `SAMPLE-${1001 + k}`,
      issue_date: addDays(today(), -40 + k * 4),
      due_date: addDays(today(), -20 + k * 8),
      category: "Food & Beverages",
      description: "Sample purchase — replace with your own records",
      subtotal_cents: n,
      tax_cents: 0,
      shipping_cents: 0,
      discount_cents: 0,
    });
    if (k !== 5) run("invoice.approve", { id, version: 1 });
    if (k === 1 || k === 3)
      run("payment.record", {
        invoice_id: id,
        amount_cents: k === 1 ? 30000 : n,
        date: addDays(today(), -2),
        method: "ACH",
        reference: "SAMPLE",
      });
  });
  return s;
}
