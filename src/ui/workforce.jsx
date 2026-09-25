import { useState } from "react";
import { useLocation } from "react-router-dom";
import { Button, Field, Modal, Empty, Badge } from "./common";
import { money, today, balance } from "../core/domain";
import {
  records,
  clock,
  hours,
  easternInput,
  easternISO,
  importRows,
  hrKinds,
} from "../core/workforce";
import { exportCSV, download } from "../core/export";
import "./workforce.css";
const definitions = {
  employee: {
    title: "Employees",
    singular: "employee",
    description: "Employee profiles, clock codes and hourly rate history.",
    fields: [
      ["code", "Clock code"],
      ["name", "Full name"],
      ["position", "Position"],
      ["department", "Department"],
      ["email", "Email", "email"],
      ["phone", "Phone"],
      ["hired", "Hire date", "date"],
      ["rate_cents", "Hourly rate $", "money"],
      ["status", "Status", ["Active", "Inactive"]],
      ["availability", "Availability & skills", "textarea"],
      ["emergency", "Emergency contact"],
      ["notes", "Notes", "textarea"],
    ],
  },
  shift: {
    title: "Scheduling",
    singular: "shift",
    description:
      "Plan shifts in Eastern time. Overlaps and approved time off are checked before saving.",
    fields: [
      ["employee_id", "Employee", "employee"],
      ["start", "Shift starts", "datetime-local"],
      ["end", "Shift ends", "datetime-local"],
      ["break_minutes", "Unpaid break (minutes)", "number"],
      ["station", "Station / assignment"],
      ["status", "Status", ["Scheduled", "Cancelled"]],
      ["notes", "Notes", "textarea"],
    ],
  },
  time: {
    title: "Attendance",
    singular: "attendance entry",
    description:
      "Review punches, correct missing clock-outs and approve hours. Corrections retain their original values.",
    fields: [
      ["employee_id", "Employee", "employee"],
      ["start", "Clock in", "datetime-local"],
      ["end", "Clock out", "datetime-local"],
      ["break_minutes", "Unpaid break (minutes)", "number"],
      ["status", "Status", ["Draft", "Approved", "Void"]],
      ["source", "Source"],
      ["notes", "Notes", "textarea"],
    ],
  },
  leave: {
    title: "Time off",
    singular: "time-off request",
    description:
      "Track requests and approvals. Resolve scheduled shifts before approving conflicting time off.",
    fields: [
      ["employee_id", "Employee", "employee"],
      ["from", "First day", "date"],
      ["to", "Last day", "date"],
      ["type", "Type", ["Vacation", "Personal", "Sick", "Other"]],
      ["status", "Status", ["Requested", "Approved", "Declined", "Cancelled"]],
      ["notes", "Notes", "textarea"],
    ],
  },
  certificate: {
    title: "Employee documents",
    singular: "document reminder",
    description:
      "Track document names and expiration dates. Store original files in your secure HR system; this register does not upload files.",
    fields: [
      ["employee_id", "Employee", "employee"],
      ["title", "Document / certification"],
      ["expires", "Expiration", "date"],
      ["notes", "Reference / notes", "textarea"],
    ],
  },
  payrun: {
    title: "Payroll review",
    singular: "payroll review",
    description:
      "Lock approved attendance and export a base-pay worksheet. Taxes, overtime premiums, tips, benefits and payroll payments are not calculated.",
    fields: [
      ["from", "Period starts", "date"],
      ["to", "Period ends", "date"],
      ["notes", "Review notes", "textarea"],
    ],
  },
  sale: {
    title: "Sales & cash",
    singular: "sales close",
    description:
      "Record one source and reference per close. Tender amounts must include tax and tips and be net of refunds.",
    fields: [
      ["date", "Business date", "date"],
      ["source", "Source / POS"],
      ["reference", "Unique close reference"],
      ["gross_cents", "Gross sales $", "money"],
      ["discounts_cents", "Discounts $", "money"],
      ["refunds_cents", "Refunds $", "money"],
      ["tax_cents", "Tax $", "money"],
      ["tips_cents", "Tips $", "money"],
      ["cash_cents", "Net cash tender $", "money"],
      ["card_cents", "Net card tender $", "money"],
      ["other_cents", "Net other tender $", "money"],
      ["opening_cents", "Opening cash $", "money"],
      ["paid_out_cents", "Cash paid out $", "money"],
      ["counted_cents", "Counted closing cash $", "money"],
      ["status", "Status", ["Draft", "Closed"]],
      ["notes", "Variance explanation / notes", "textarea"],
    ],
  },
  task: {
    title: "Operations checklist",
    singular: "task",
    description:
      "Opening, closing, cleaning, maintenance and training follow-up by business.",
    fields: [
      ["title", "Task"],
      [
        "category",
        "Category",
        [
          "Opening",
          "Closing",
          "Cleaning",
          "Maintenance",
          "Training",
          "Incident",
        ],
      ],
      ["owner", "Assigned to"],
      ["due", "Due date", "date"],
      ["status", "Status", ["Open", "In progress", "Done", "Cancelled"]],
      ["notes", "Completion notes", "textarea"],
    ],
  },
};
const routeKind = {
  "/employees": "employee",
  "/scheduling": "shift",
  "/attendance": "time",
  "/time-off": "leave",
  "/employee-documents": "certificate",
  "/payroll-review": "payrun",
  "/sales": "sale",
  "/operating-tasks": "task",
};
const defaults = (kind) =>
  Object.fromEntries(
    definitions[kind].fields.map(([key, , type]) => [
      key,
      Array.isArray(type)
        ? type[0]
        : type === "money" || type === "number"
          ? 0
          : type === "date"
            ? today()
            : "",
    ]),
  );
function Rows({ headers, rows }) {
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
          {rows.map((row, i) => (
            <tr key={i}>
              {row.map((c, j) => (
                <td key={j}>{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : (
    <Empty title="No records yet">Add a record or adjust the filters.</Empty>
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
function Edit({ kind, record, state, onSubmit, close }) {
  const def = definitions[kind];
  const [form, setForm] = useState(() => {
    const d = { ...defaults(kind), ...record };
    for (const [key, , type] of def.fields) {
      if (type === "money") d[key] = (Number(d[key] || 0) / 100).toFixed(2);
      if (type === "datetime-local") d[key] = easternInput(d[key]);
    }
    return d;
  });
  const [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const data = {};
      for (const [key, , type] of def.fields) {
        data[key] =
          type === "money"
            ? Math.round(Number(form[key]) * 100)
            : type === "number"
              ? Number(form[key])
              : type === "datetime-local"
                ? easternISO(form[key]) || null
                : form[key];
      }
      await onSubmit("team.save", {
        kind,
        id: record?.id,
        version: record?.version,
        data,
        reason,
      });
      close();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={(record ? "Edit " : "New ") + def.singular}
      onClose={close}
      busy={busy}
      wide
    >
      <form onSubmit={save}>
        <div className="form-grid">
          {def.fields.map(([key, label, type = "text"]) => (
            <Field key={key} label={label} wide={type === "textarea"}>
              {Array.isArray(type) ? (
                <select
                  value={form[key]}
                  onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                >
                  {type.map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
              ) : type === "employee" ? (
                <select
                  required
                  value={form[key]}
                  onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                >
                  <option value="">Choose employee</option>
                  {records(state, "employee")
                    .filter((e) => e.status === "Active" || e.id === form[key])
                    .map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.code} · {e.name}
                      </option>
                    ))}
                </select>
              ) : type === "textarea" ? (
                <textarea
                  maxLength={2000}
                  value={form[key] || ""}
                  onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                />
              ) : (
                <input
                  type={type === "money" ? "number" : type}
                  min={["money", "number"].includes(type) ? 0 : undefined}
                  step={
                    type === "money"
                      ? "0.01"
                      : type === "number"
                        ? "1"
                        : undefined
                  }
                  maxLength={200}
                  value={form[key] ?? ""}
                  onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                  required={
                    [
                      "name",
                      "code",
                      "title",
                      "employee_id",
                      "start",
                      "from",
                      "to",
                      "date",
                      "due",
                      "expires",
                      "reference",
                      "source",
                    ].includes(key) ||
                    (kind === "shift" && key === "end")
                  }
                />
              )}
            </Field>
          ))}
        </div>
        {record && (
          <Field label="Correction reason">
            <textarea
              required
              minLength={5}
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
        )}
        {kind === "payrun" && (
          <p className="alert">
            Only approved attendance is included, grouped by the Eastern date of
            clock-in. A shift crossing midnight stays on its clock-in date. Base
            pay is a worksheet for your payroll provider, not final wages.
          </p>
        )}
        {error && (
          <p className="alert error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <Button type="button" onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button disabled={busy}>
            {busy
              ? "Saving…"
              : kind === "payrun"
                ? "Approve payroll review"
                : "Save"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
function Import({ kind, state, onSubmit, close }) {
  const [rows, setRows] = useState([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const headers =
    kind === "time"
      ? ["employee_code", "start", "end", "break_minutes", "source", "notes"]
      : [
          "date",
          "source",
          "reference",
          "gross",
          "discounts",
          "refunds",
          "tax",
          "tips",
          "cash",
          "card",
          "other",
          "opening",
          "paid_out",
          "counted",
          "notes",
        ];
  return (
    <Modal
      title={kind === "time" ? "Import attendance" : "Import sales"}
      onClose={close}
      busy={busy}
      wide
    >
      <p>
        {kind === "time"
          ? "Map your clock export to the template columns. Start and end require ISO timestamps with timezone, for example 2026-09-20T17:00:00-04:00."
          : "Map your POS close report to the template. Amounts are dollars. Import creates drafts for review; it does not connect to Square automatically."}
      </p>
      <Button onClick={() => exportCSV(kind + "-template.csv", [headers])}>
        Download CSV template
      </Button>
      <Field label="CSV file">
        <input
          type="file"
          accept=".csv,text/csv"
          disabled={busy}
          onChange={async (e) => {
            setRows([]);
            setError("");
            try {
              const file = e.target.files[0];
              if (!file) return;
              if (file.size > 1000000)
                throw new Error("CSV must be smaller than 1 MB.");
              setRows(importRows(await file.text(), kind, state));
            } catch (err) {
              setError(err.message);
            }
          }}
        />
      </Field>
      {rows.length > 0 && (
        <>
          <p>
            {rows.length} rows ready for review. The full batch is rejected if
            any row is invalid or duplicated.
          </p>
          <Rows
            headers={
              kind === "time"
                ? ["Employee", "Clock in", "Clock out"]
                : ["Date", "Source", "Reference", "Gross"]
            }
            rows={rows.map(({ data: d }) =>
              kind === "time"
                ? [
                    records(state, "employee").find(
                      (e) => e.id === d.employee_id,
                    )?.name,
                    clock(d.start),
                    clock(d.end),
                  ]
                : [d.date, d.source, d.reference, money(d.gross_cents)],
            )}
          />
        </>
      )}
      {error && (
        <p className="alert error" role="alert">
          {error}
        </p>
      )}
      <div className="dialog-actions">
        <Button
          disabled={busy || !rows.length}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              await onSubmit("team.batch", { rows });
              close();
            } catch (e) {
              setError(e.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Importing…" : "Confirm import"}
        </Button>
      </div>
    </Modal>
  );
}
export function Workforce({ state, onSubmit, isAdmin, canWrite }) {
  const kind = routeKind[useLocation().pathname] || "employee",
    def = definitions[kind];
  const [edit, setEdit] = useState(null),
    [importing, setImporting] = useState(false),
    [query, setQuery] = useState(""),
    [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [detail, setDetail] = useState(null),
    [reopen, setReopen] = useState(null),
    [reason, setReason] = useState("");
  const hr = hrKinds.includes(kind),
    allowed = hr ? state.hr_enabled : canWrite;
  if (hr && !state.hr_enabled)
    return (
      <section className="panel">
        <h1>Workforce access required</h1>
        <p>
          An administrator can grant HR access in Workforce → Access & history.
        </p>
      </section>
    );
  const all = records(state, kind),
    name = (id) =>
      records(state, "employee").find((e) => e.id === id)?.name ||
      "Unknown employee";
  const dateOf = (r) =>
    r.date ||
    r.from ||
    r.due ||
    r.expires ||
    (r.start ? easternInput(r.start).slice(0, 10) : "");
  const visible = all.filter(
    (r) =>
      (!query ||
        JSON.stringify({ ...r, employee: name(r.employee_id) })
          .toLowerCase()
          .includes(query.toLowerCase())) &&
      (!from || dateOf(r) >= from) &&
      (!to || dateOf(r) <= to),
  );
  const editButton = (r) =>
    allowed &&
    (kind === "payrun" ? (
      <Button
        onClick={() => {
          setDetail(r);
          setReason("");
          setError("");
        }}
      >
        View / export
      </Button>
    ) : kind === "sale" && r.status === "Closed" ? (
      isAdmin && (
        <Button
          onClick={() => {
            setReopen(r);
            setReason("");
            setError("");
          }}
        >
          Reopen
        </Button>
      )
    ) : (
      <Button onClick={() => setEdit(r)}>Edit</Button>
    ));
  const table = {
    employee: {
      headers: [
        "Code",
        "Employee",
        "Position",
        "Rate / hour",
        "Status",
        "Actions",
      ],
      row: (r) => [
        r.code,
        r.name,
        r.position,
        money(r.rate_cents),
        <Badge>{r.status}</Badge>,
        editButton(r),
      ],
    },
    shift: {
      headers: [
        "Employee",
        "Start (Eastern)",
        "End (Eastern)",
        "Hours",
        "Station",
        "Status",
        "Actions",
      ],
      row: (r) => [
        name(r.employee_id),
        clock(r.start),
        clock(r.end),
        hours(r).toFixed(2),
        r.station,
        r.status,
        editButton(r),
      ],
    },
    time: {
      headers: [
        "Employee",
        "Clock in (Eastern)",
        "Clock out (Eastern)",
        "Hours",
        "Base pay estimate",
        "Status",
        "Actions",
      ],
      row: (r) => [
        name(r.employee_id),
        clock(r.start),
        clock(r.end),
        hours(r).toFixed(2),
        r.end
          ? money(Math.round((Number(r.minutes) * Number(r.rate_cents)) / 60))
          : "—",
        r.status,
        editButton(r),
      ],
    },
    leave: {
      headers: ["Employee", "From", "To", "Type", "Status", "Actions"],
      row: (r) => [
        name(r.employee_id),
        r.from,
        r.to,
        r.type,
        r.status,
        editButton(r),
      ],
    },
    certificate: {
      headers: ["Employee", "Document", "Expires", "Status", "Actions"],
      row: (r) => [
        name(r.employee_id),
        r.title,
        r.expires,
        r.expires < today() ? "Expired" : "Current",
        editButton(r),
      ],
    },
    payrun: {
      headers: [
        "Period starts",
        "Period ends",
        "Entries",
        "Base pay worksheet",
        "Reviewed",
        "Actions",
      ],
      row: (r) => [
        r.from,
        r.to,
        r.lines?.length,
        money(r.base_pay_cents),
        clock(r.reviewed_at),
        editButton(r),
      ],
    },
    sale: {
      headers: [
        "Date",
        "Source / reference",
        "Net sales",
        "Tax / tips",
        "Expected cash",
        "Cash variance",
        "Status",
        "Actions",
      ],
      row: (r) => [
        r.date,
        `${r.source} · ${r.reference}`,
        money(r.net_cents),
        `${money(r.tax_cents)} / ${money(r.tips_cents)}`,
        money(r.expected_cash_cents),
        money(r.variance_cents),
        r.status,
        editButton(r),
      ],
    },
    task: {
      headers: ["Task", "Category", "Assigned to", "Due", "Status", "Actions"],
      row: (r) => [
        r.title,
        r.category,
        r.owner,
        r.due,
        r.status,
        editButton(r),
      ],
    },
  }[kind];
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">{hr ? "WORKFORCE" : "BUSINESS OPERATIONS"}</p>
          <h1>{def.title}</h1>
          <p>{def.description}</p>
        </div>
        <div className="actions">
          {allowed && (
            <Button onClick={() => setEdit({})}>New {def.singular}</Button>
          )}
          {allowed && ["time", "sale"].includes(kind) && (
            <Button onClick={() => setImporting(true)}>Import CSV</Button>
          )}
          <Button
            onClick={() => {
              const fields = def.fields.map((x) => x[0]);
              exportCSV(kind + ".csv", [
                fields,
                ...visible.map((r) => fields.map((f) => r[f] ?? "")),
              ]);
            }}
          >
            Export records
          </Button>
        </div>
      </div>
      {kind === "time" && (
        <Metrics
          items={[
            [
              "Draft entries",
              visible.filter((r) => r.status === "Draft").length,
            ],
            [
              "Missing clock-outs",
              visible.filter((r) => !r.end && r.status !== "Void").length,
            ],
            [
              "Approved hours",
              visible
                .filter((r) => r.status === "Approved")
                .reduce((s, r) => s + hours(r), 0)
                .toFixed(2),
            ],
          ]}
        />
      )}
      {kind === "sale" && (
        <Metrics
          items={[
            [
              "Closed net sales",
              money(
                visible
                  .filter((r) => r.status === "Closed")
                  .reduce((s, r) => s + Number(r.net_cents), 0),
              ),
            ],
            [
              "Draft closes",
              visible.filter((r) => r.status === "Draft").length,
            ],
            [
              "Closed cash variance",
              money(
                visible
                  .filter((r) => r.status === "Closed")
                  .reduce((s, r) => s + Number(r.variance_cents), 0),
              ),
            ],
          ]}
        />
      )}
      <div className="team-filters">
        <Field label="Search">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Name, code, status or reference"
          />
        </Field>
        {kind !== "employee" && (
          <>
            <Field label="From">
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </Field>
            <Field label="To">
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </Field>
          </>
        )}
      </div>
      <Rows headers={table.headers} rows={visible.map(table.row)} />
      {edit && (
        <Edit
          kind={kind}
          record={edit.id ? edit : null}
          state={state}
          onSubmit={onSubmit}
          close={() => setEdit(null)}
        />
      )}
      {importing && (
        <Import
          kind={kind}
          state={state}
          onSubmit={onSubmit}
          close={() => setImporting(false)}
        />
      )}
      {detail && (
        <Modal
          title={"Payroll review worksheet · " + detail.status}
          onClose={() => setDetail(null)}
          wide
        >
          <p>
            Base pay only. Review overtime premiums, tips, deductions and taxes
            with your payroll provider. Hours are assigned to the Eastern
            clock-in date.
          </p>
          <Rows
            headers={["Employee", "Clock in", "Hours", "Rate", "Base pay"]}
            rows={detail.lines.map((r) => [
              r.employee_name,
              clock(r.start),
              (Number(r.minutes) / 60).toFixed(2),
              money(r.rate_cents),
              money(r.base_pay_cents),
            ])}
          />
          <Button
            onClick={() =>
              exportCSV(`payroll-${detail.from}-${detail.to}.csv`, [
                [
                  "Employee code",
                  "Employee",
                  "Clock in",
                  "Clock out",
                  "Minutes",
                  "Rate dollars",
                  "Base pay dollars",
                ],
                ...detail.lines.map((r) => [
                  r.employee_code,
                  r.employee_name,
                  r.start,
                  r.end,
                  r.minutes,
                  (r.rate_cents / 100).toFixed(2),
                  (r.base_pay_cents / 100).toFixed(2),
                ]),
              ])
            }
          >
            Export payroll worksheet
          </Button>
          {isAdmin && detail.status === "Reviewed" && (
            <div className="panel">
              <h3>Correct a reviewed period</h3>
              <p>
                Voiding preserves this worksheet and unlocks its attendance. If
                it was already sent to payroll, coordinate the correction with
                your payroll provider before exporting a replacement.
              </p>
              <Field label="Reason for voiding review">
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  maxLength={500}
                />
              </Field>
              {error && <p role="alert">{error}</p>}
              <Button
                disabled={busy || reason.trim().length < 5}
                onClick={async () => {
                  setBusy(true);
                  setError("");
                  try {
                    await onSubmit("team.void_review", {
                      id: detail.id,
                      version: detail.version,
                      reason,
                    });
                    setDetail(null);
                  } catch (e) {
                    setError(e.message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Void review and unlock attendance
              </Button>
            </div>
          )}
        </Modal>
      )}
      {reopen && (
        <Modal
          title="Reopen sales close"
          onClose={() => setReopen(null)}
          busy={busy}
        >
          <Field label="Reason">
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              minLength={5}
              maxLength={500}
            />
          </Field>
          {error && <p role="alert">{error}</p>}
          <Button
            disabled={busy || reason.trim().length < 5}
            onClick={async () => {
              setBusy(true);
              try {
                await onSubmit("team.reopen", {
                  id: reopen.id,
                  version: reopen.version,
                  reason,
                });
                setReopen(null);
              } catch (e) {
                setError(e.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Reopen for correction
          </Button>
        </Modal>
      )}
    </>
  );
}
export function TeamAccess({ state, onSubmit, isAdmin }) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [detail, setDetail] = useState(null);
  if (!state.hr_enabled)
    return (
      <section className="panel">
        <h1>Workforce access required</h1>
      </section>
    );
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">WORKFORCE</p>
          <h1>Access & history</h1>
          <p>
            HR access includes employee pay, attendance and payroll review. Only
            administrators grant this permission.
          </p>
        </div>
        <Button
          onClick={() =>
            download(
              `workforce-export-${today()}.json`,
              JSON.stringify(
                {
                  business_id: state.business_id,
                  exported_at: new Date().toISOString(),
                  records: (state.team_records || []).filter((r) =>
                    hrKinds.includes(r.kind),
                  ),
                },
                null,
                2,
              ),
              "application/json",
            )
          }
        >
          Export HR archive
        </Button>
      </div>
      <p>
        The HR archive is a downloadable record export. General AP backups do
        not include Workforce or Sales & Cash records.
      </p>
      {error && (
        <p role="alert" className="alert error">
          {error}
        </p>
      )}
      {isAdmin && (
        <Rows
          headers={["Member", "Business role", "HR access", "Actions"]}
          rows={(state.members || [])
            .filter((m) => m.active)
            .map((m) => [
              m.email,
              m.role,
              m.role === "admin" || state.hr_access?.includes(m.user_id)
                ? "Enabled"
                : "Restricted",
              m.role !== "admin" && (
                <Button
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    setError("");
                    try {
                      await onSubmit("team.access", {
                        user_id: m.user_id,
                        enabled: !state.hr_access?.includes(m.user_id),
                      });
                    } catch (e) {
                      setError(e.message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {state.hr_access?.includes(m.user_id)
                    ? "Revoke HR access"
                    : "Grant HR access"}
                </Button>
              ),
            ])}
        />
      )}
      <h2>Recent history</h2>
      <p>Latest 200 changes visible to your role.</p>
      <Rows
        headers={["When", "Record", "Reason", "Actor", "Details"]}
        rows={(state.team_audit || []).map((a) => [
          clock(a.created_at),
          a.kind,
          a.reason,
          a.actor,
          <Button onClick={() => setDetail(a)}>View change</Button>,
        ])}
      />
      {detail && (
        <Modal
          title="Original and updated values"
          onClose={() => setDetail(null)}
          wide
        >
          <h3>Before</h3>
          <pre className="team-json">
            {JSON.stringify(detail.before, null, 2)}
          </pre>
          <h3>After</h3>
          <pre className="team-json">
            {JSON.stringify(detail.after, null, 2)}
          </pre>
        </Modal>
      )}
    </>
  );
}
export function FinanceDesk({ state }) {
  const [cash, setCash] = useState("0"),
    [days, setDays] = useState("30");
  const end = new Date(today() + "T12:00:00Z");
  end.setUTCDate(end.getUTCDate() + Number(days));
  const until = end.toISOString().slice(0, 10);
  const due = state.invoices.filter(
    (i) =>
      i.status === "Approved" && i.due_date <= until && balance(state, i) > 0,
  );
  const total = due.reduce((s, i) => s + balance(state, i), 0),
    held = due
      .filter((i) => i.payment_hold)
      .reduce((s, i) => s + balance(state, i), 0);
  const sales = records(state, "sale").filter(
    (r) =>
      r.status === "Closed" &&
      r.date >= today().slice(0, 7) + "-01" &&
      r.date <= today(),
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">FINANCIAL PLANNING</p>
          <h1>Cash outlook</h1>
          <p>
            Compare available cash with approved invoice balances due within
            your planning window, including overdue and held invoices.
          </p>
        </div>
      </div>
      <div className="team-filters">
        <Field label="Available cash $">
          <input
            type="number"
            min="0"
            step="0.01"
            value={cash}
            onChange={(e) => setCash(e.target.value)}
          />
        </Field>
        <Field label="Planning window">
          <select value={days} onChange={(e) => setDays(e.target.value)}>
            <option value="7">7 days</option>
            <option value="30">30 days</option>
            <option value="60">60 days</option>
          </select>
        </Field>
      </div>
      <Metrics
        items={[
          ["Payables through " + until, money(total)],
          ["Included on payment hold", money(held)],
          [
            "Cash after these payables",
            money(Math.round(Number(cash || 0) * 100) - total),
          ],
          [
            "Month-to-date closed net sales",
            money(sales.reduce((s, r) => s + Number(r.net_cents), 0)),
          ],
        ]}
      />
      <p className="alert">
        Planning estimate only. This does not include payroll, rent, taxes,
        other future expenses or expected receipts. Sales are not bank deposits.
        Bank reconciliation and a general ledger are not connected.
      </p>
      <Rows
        headers={["Invoice", "Due", "Balance", "Hold"]}
        rows={due.map((i) => [
          i.number,
          i.due_date,
          money(balance(state, i)),
          i.payment_hold ? "Yes" : "No",
        ])}
      />
    </>
  );
}
