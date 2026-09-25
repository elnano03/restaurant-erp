export const TEAM_ZONE = "America/New_York";
export const hrKinds = [
  "employee",
  "shift",
  "time",
  "leave",
  "payrun",
  "certificate",
];
export const records = (state, kind) =>
  (state.team_records || [])
    .filter((r) => r.kind === kind)
    .map((r) => ({ ...r.data, id: r.id, version: r.version }));
export function easternInput(value) {
  if (!value) return "";
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: TEAM_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date(value))
      .map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
export function easternISO(value) {
  if (!value) return "";
  const candidates = ["-04:00", "-05:00"]
    .map((offset) => new Date(value + offset))
    .filter((d) => !isNaN(d) && easternInput(d.toISOString()) === value);
  if (candidates.length !== 1)
    throw new Error(
      "This time is skipped or repeated by daylight saving. Import an ISO timestamp with an explicit offset for this entry.",
    );
  return candidates[0].toISOString();
}
export const clock = (value) =>
  value
    ? new Intl.DateTimeFormat("en-US", {
        timeZone: TEAM_ZONE,
        dateStyle: "short",
        timeStyle: "short",
      }).format(new Date(value))
    : "Missing punch";
export const hours = (r) =>
  r.end
    ? Math.max(
        0,
        (new Date(r.end) - new Date(r.start)) / 3600000 -
          Number(r.break_minutes || 0) / 60,
      )
    : 0;
export function parseCSV(text) {
  const rows = [];
  let row = [],
    cell = "",
    quoted = false;
  text = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((c === "\n" || c === "\r") && !quoted) {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (quoted) throw new Error("Unclosed CSV quote.");
  row.push(cell);
  if (row.some((x) => x.trim())) rows.push(row);
  const headers = rows.shift()?.map((x) => x.trim());
  if (!headers?.length) throw new Error("CSV is empty.");
  if (new Set(headers).size !== headers.length)
    throw new Error("Duplicate CSV headers.");
  return rows.map((r, i) => {
    if (r.length !== headers.length)
      throw new Error(`CSV row ${i + 2} has the wrong number of columns.`);
    return Object.fromEntries(headers.map((h, j) => [h, r[j].trim()]));
  });
}
export function importRows(text, kind, state) {
  const rows = parseCSV(text);
  if (rows.length < 1 || rows.length > 200)
    throw new Error("Import between 1 and 200 rows per batch.");
  return rows.map((r, i) => {
    if (kind === "time") {
      const e = records(state, "employee").find(
        (e) => e.code.toLowerCase() === r.employee_code?.toLowerCase(),
      );
      if (!e) throw new Error(`Row ${i + 2}: unknown employee code.`);
      for (const k of ["start", "end"])
        if (r[k] && (!/(Z|[+-]\d\d:\d\d)$/.test(r[k]) || isNaN(new Date(r[k]))))
          throw new Error(
            `Row ${i + 2}: use an ISO timestamp with timezone for ${k}.`,
          );
      return {
        kind,
        data: {
          employee_id: e.id,
          start: r.start,
          end: r.end || null,
          break_minutes: Number(r.break_minutes || 0),
          status: "Draft",
          source: r.source || "Clock CSV",
          notes: r.notes || "",
        },
      };
    }
    const data = {
      date: r.date,
      source: r.source,
      reference: r.reference,
      notes: r.notes || "",
      status: "Draft",
    };
    for (const k of [
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
    ]) {
      const v = Number(r[k] || 0);
      if (
        !Number.isFinite(v) ||
        v < 0 ||
        Math.abs(v * 100 - Math.round(v * 100)) > 0.000001
      )
        throw new Error(`Row ${i + 2}: invalid ${k} amount.`);
      data[k + "_cents"] = Math.round(v * 100);
    }
    return { kind: "sale", data };
  });
}
