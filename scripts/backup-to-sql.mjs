import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { validateBackup } from "../src/core/domain.js";
// Administrator utility. Converts a local backup into a reviewed SQL import;
// it never connects to a database or executes the generated SQL.
const input = process.argv[2],
  output = process.argv[3];
if (!input || !output) {
  console.error(
    "Usage: node scripts/backup-to-sql.mjs BACKUP.json NEW_IMPORT.sql",
  );
  process.exit(1);
}
const state = validateBackup(JSON.parse(await readFile(input, "utf8")));
const quote = (x) =>
  x === null || x === undefined
    ? "null"
    : typeof x === "number"
      ? String(x)
      : "'" + String(x).replaceAll("'", "''") + "'";
const json = (x) => quote(JSON.stringify(x ?? null)) + "::jsonb";
const sql = [
  "-- SINTECH AP 1.0 local backup import. REVIEW BEFORE EXECUTION.",
  "-- Run only on an empty AP workspace after 001_accounts_payable.sql.",
  "begin;",
  "do $$ begin if exists(select 1 from public.ap_suppliers) or exists(select 1 from public.ap_invoices) or exists(select 1 from public.ap_payments) or exists(select 1 from public.ap_audit) then raise exception 'AP workspace must be empty. No data was changed.'; end if; end $$;",
];
const fields = {
  ap_suppliers: [
    "id",
    "business_name",
    "contact",
    "phone",
    "email",
    "address",
    "category",
    "status",
    "terms_days",
    "notes",
    "version",
    "created_at",
  ],
  ap_invoices: [
    "id",
    "supplier_id",
    "number",
    "issue_date",
    "due_date",
    "category",
    "description",
    "subtotal_cents",
    "tax_cents",
    "shipping_cents",
    "discount_cents",
    "status",
    "version",
    "created_at",
    "approved_at",
    "voided_at",
    "void_reason",
  ],
  ap_payments: [
    "id",
    "invoice_id",
    "amount_cents",
    "date",
    "method",
    "reference",
    "notes",
    "created_at",
    "reversed_at",
    "reversal_reason",
  ],
};
for (const [table, list] of [
  ["ap_suppliers", state.suppliers],
  ["ap_invoices", state.invoices],
  ["ap_payments", state.payments],
])
  for (const row of list) {
    const keys = fields[table].filter((k) => row[k] !== undefined);
    sql.push(
      `insert into public.${table}(${keys.join(",")}) values(${keys.map((k) => quote(row[k])).join(",")});`,
    );
  }
for (const a of state.audit)
  sql.push(
    `insert into public.ap_audit(id,type,entity_id,actor,at,before,after) values(${[a.id, a.type, a.entity_id, a.actor, a.at].map(quote).join(",")},${json(a.before)},${json(a.after)});`,
  );
sql.push(
  `update public.ap_settings set ${["business_name", "address", "phone", "email", "terms_days"].map((k) => `${k}=${quote(state.settings[k])}`).join(",")},revision=${state.revision} where id=1;`,
  "commit;",
);
await writeFile(resolve(output), sql.join("\n") + "\n", { flag: "wx" });
console.log(
  "SQL import created. It has not been executed. Keep it private: it contains business data.",
);
