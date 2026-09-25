import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { demoState } from "../src/core/domain.js";
test("local backup converts to a valid, lossless SQL import and refuses a non-empty workspace", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sintech-test-"));
  const state = demoState();
  state.suppliers[0].business_name = "O'Brien's Foods";
  await writeFile(join(dir, "backup.json"), JSON.stringify(state));
  await promisify(execFile)(
    process.execPath,
    [
      "scripts/backup-to-sql.mjs",
      join(dir, "backup.json"),
      join(dir, "import.sql"),
    ],
    { cwd: fileURLToPath(new URL("..", import.meta.url)) },
  );
  const db = new PGlite();
  await db.exec(
    `create role anon; create role authenticated; create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql as $$ select null::uuid $$; create function auth.jwt() returns jsonb language sql as $$ select '{}'::jsonb $$;`,
  );
  await db.exec(
    await readFile(
      new URL("../supabase/001_accounts_payable.sql", import.meta.url),
      "utf8",
    ),
  );
  const sql = await readFile(join(dir, "import.sql"), "utf8");
  await db.exec(sql);
  assert.equal(
    (await db.query("select count(*)::int n from public.ap_invoices")).rows[0]
      .n,
    state.invoices.length,
  );
  assert.equal(
    (await db.query("select count(*)::int n from public.ap_audit")).rows[0].n,
    state.audit.length,
  );
  assert.equal(
    (await db.query("select sum(amount_cents)::int n from public.ap_payments"))
      .rows[0].n,
    state.payments.reduce((n, p) => n + p.amount_cents, 0),
  );
  assert.equal(
    (
      await db.query(
        "select business_name from public.ap_suppliers where id=$1",
        [state.suppliers[0].id],
      )
    ).rows[0].business_name,
    "O'Brien's Foods",
  );
  await assert.rejects(db.exec(sql), /must be empty/);
  await db.exec("rollback");
  await db.close();
});
