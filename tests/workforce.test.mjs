import { test } from "node:test";
import assert from "node:assert/strict";
import {
  easternISO,
  easternInput,
  hours,
  importRows,
  parseCSV,
} from "../src/core/workforce.js";
test("Eastern time conversion and DST ambiguity protection", () => {
  assert.equal(easternISO("2026-01-10T22:00"), "2026-01-11T03:00:00.000Z");
  assert.equal(easternISO("2026-07-10T22:00"), "2026-07-11T02:00:00.000Z");
  assert.equal(easternInput("2026-01-11T03:00:00Z"), "2026-01-10T22:00");
  assert.throws(() => easternISO("2026-03-08T02:30"), /daylight/);
  assert.throws(() => easternISO("2026-11-01T01:30"), /daylight/);
  assert.equal(
    hours({
      start: "2026-01-10T22:00:00-05:00",
      end: "2026-01-11T06:00:00-05:00",
      break_minutes: 30,
    }),
    7.5,
  );
});
test("CSV parser preserves quoted descriptions and validates codes, timestamps and cents", () => {
  assert.deepEqual(parseCSV('a,b\r\n"a,b","two\nlines"'), [
    { a: "a,b", b: "two\nlines" },
  ]);
  assert.throws(() => parseCSV("a,a\n1,2"), /Duplicate/);
  const state = {
    team_records: [
      { kind: "employee", id: "e1", data: { code: "01", name: "Worker" } },
    ],
  };
  const rows = importRows(
    "employee_code,start,end,break_minutes\n01,2026-01-10T22:00:00-05:00,2026-01-11T06:00:00-05:00,30",
    "time",
    state,
  );
  assert.equal(rows[0].data.employee_id, "e1");
  assert.throws(
    () =>
      importRows("employee_code,start\n02,2026-01-10T22:00:00Z", "time", state),
    /unknown/,
  );
  assert.throws(
    () =>
      importRows(
        "date,source,reference,gross\n2026-01-10,POS,ref,10.111",
        "sale",
        state,
      ),
    /invalid/,
  );
});
