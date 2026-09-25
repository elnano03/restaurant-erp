import { invoiceTotal, invoicePaid, money, today } from "./domain";
export const businessDay = (timestamp) =>
  timestamp
    ? new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/New_York",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date(timestamp))
    : null;
export function creditUsed(state, id, at = "9999-12-31") {
  return (state.credit_allocations || [])
    .filter(
      (a) =>
        a.credit_id === id &&
        a.date <= at &&
        (!a.reversed_at || businessDay(a.reversed_at) > at),
    )
    .reduce((s, a) => s + a.amount_cents, 0);
}
export function historicalRows(state, at = today(), supplier = "") {
  return state.invoices
    .filter(
      (i) =>
        (!supplier || supplier === i.supplier_id) &&
        i.issue_date <= at &&
        i.approved_at &&
        businessDay(i.approved_at) <= at &&
        (!i.voided_at || businessDay(i.voided_at) > at),
    )
    .map((i) => {
      const credits = (state.credit_allocations || [])
        .filter(
          (a) =>
            a.invoice_id === i.id &&
            a.date <= at &&
            (!a.reversed_at || businessDay(a.reversed_at) > at),
        )
        .reduce((s, a) => s + a.amount_cents, 0);
      const paid = invoicePaid(
        {
          ...state,
          payments: state.payments.map((p) => ({
            ...p,
            reversed_at: p.reversed_at ? businessDay(p.reversed_at) : null,
          })),
        },
        i.id,
        at,
      );
      const outstanding = invoiceTotal(i) - paid - credits;
      return {
        ...i,
        supplier: state.suppliers.find((s) => s.id === i.supplier_id)
          ?.business_name,
        total: invoiceTotal(i),
        paid,
        credits,
        outstanding,
        days: Math.max(
          0,
          Math.floor((Date.parse(at) - Date.parse(i.due_date)) / 86400000),
        ),
      };
    });
}
export const quoteKey = (q) =>
  [q.product, q.unit, q.brand || ""]
    .map((v) => v.trim().toLowerCase())
    .join("|");
export function compareQuotes(state, selected = [], at = today()) {
  const latest = new Map();
  for (const q of state.quotes || []) {
    if (
      !q.active ||
      (state.suppliers &&
        !state.suppliers.some(
          (s) => s.id === q.supplier_id && s.status === "Active",
        )) ||
      q.date > at ||
      (selected.length && !selected.includes(q.supplier_id))
    )
      continue;
    const key = [
      q.product.trim().toLowerCase(),
      q.unit.trim().toLowerCase(),
      q.brand.trim().toLowerCase(),
      q.supplier_id,
    ].join("|");
    const old = latest.get(key);
    if (
      !old ||
      q.date > old.date ||
      (q.date === old.date && q.version > old.version)
    )
      latest.set(key, q);
  }
  const groups = new Map();
  for (const q of latest.values()) {
    const key = [
      q.product.trim().toLowerCase(),
      q.unit.trim().toLowerCase(),
      q.brand.trim().toLowerCase(),
    ].join("|");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(q);
  }
  return [...groups.values()].map((qs) =>
    qs.sort((a, b) => a.unit_cents - b.unit_cents),
  );
}
export const printableRows = (rows) =>
  rows.map((r) => [
    r.supplier,
    r.number,
    r.issue_date,
    r.due_date,
    money(r.total),
    money(r.paid),
    money(r.credits),
    money(r.outstanding),
  ]);
