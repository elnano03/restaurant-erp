# SINTECH Restaurant ERP — Accounts Payable 1.0

**Para comenzar en español:** abre [LEEME_PRIMERO.md](LEEME_PRIMERO.md).

Working local-first accounts payable application built on the supplied `restaurante-erp` Sprint 1.1 project. React, Vite, Supabase/PostgreSQL. English UI, USD, America/New_York business date.

## Run the included build

Windows: `START_SINTECH.cmd`. Mac/Linux: `node scripts/start.mjs`.

The launcher serves `dist` on **http://127.0.0.1:4173**, loopback only. It requires Node.js, not npm dependencies. Never expose this launcher as a production network server.

## Develop

```sh
npm ci
npm run dev
npm run check
```

Use Node.js 22.12+ or 24 LTS. `npm run check` runs lint, unit tests, PostgreSQL migration/authorization tests (PGlite), mounted UI workflow tests (JSDOM), and a production build.

## Implemented workflows

- Supplier directory, active/inactive/blocked status, contacts and payment terms.
- Draft invoices, review/approval, immutable approved financial fields, duplicate number prevention per supplier.
- Exact integer-cent calculations. Partial/full payment recording, no overpayment, reversal and void reasons.
- Calculated dashboard, due-date priorities and five aging buckets.
- Search/filter/pagination, supplier statements, purchase-category and payment reports, CSV formula neutralization, print styles.
- Local and demo workspaces isolated from each other and from cloud data. JSON backup/validated local restore with a retained pre-restore copy.
- Cloud email/password sign-in and password recovery, administrator/accountant/viewer roles, transactional validated RPCs, RLS, denied direct table writes, append-only audit records for clients, optimistic version checks and idempotent command IDs.
- Non-destructive legacy supplier import; opening balances remain draft invoices for reconciliation.

## Source layout

`src/core/domain.js`: local business rules and pure calculations. `src/core/repository.js`: local and Supabase adapters. `src/ui`: pages, dialogs and common components. `src/App.jsx`: authentication, navigation and command dispatch. `supabase`: transactional schema and optional migration scripts. `scripts`: local launcher and backup-to-SQL conversion. `tests`: money/lifecycle, SQL/permissions and mounted UI tests.

The old inactive components and hard-coded Supabase client were removed. The uploaded RAR remains the original checkpoint. No live Supabase table or GitHub branch was changed by this delivery.

## Cloud activation

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). Build output is supplied in local mode with no production project key embedded. Existing `public."Suppliers"` remains untouched by the main migration. Review and run optional import and lockdown scripts in sequence.

## Scope and limitations

One business and currency per installation. Local mode is a trusted single-operator workspace, not a secured shared system. Cloud mode is designed for a small restaurant AP workload; snapshots load all records and should be replaced by server pagination before large-scale use. Roles do not implement segregation of approval duties. Audit records are protected against ordinary clients, not project administrators. Local imports can replace local history.

Inventory, recipes, payroll, POS, automatic bank payments, bank reconciliation, credit notes, recurring schedules, OCR and document attachments are not implemented. This is the completed AP release, not the entire future restaurant ERP.

See [docs/VALIDATION.md](docs/VALIDATION.md) for verified behavior and unverified deployment gates.
