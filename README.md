# SINTECH Restaurant ERP — Business Operations 2.0

Restaurant accounts payable and purchasing application. React/Vite, Supabase/PostgreSQL, English UI, USD, America/New_York business dates.

**Guía en español:** [LEEME_PRIMERO.md](LEEME_PRIMERO.md).

## Run and verify

```sh
npm ci
npm run dev
npm run check
```

Use Node.js 22.12+ or 24 LTS. Set the public Supabase URL and publishable key from `.env.example` before building the shared workspace. Never put a service-role key in the client. Sites hosting configuration is in `.openai/hosting.json`.

## Shared workspace

- Multiple businesses with independent records and administrator/accountant/viewer permissions.
- Supplier directory and profile, editable supplier categories with archival and rename propagation.
- Draft/approved invoices, partial payments, grouped payments, reversals, duplicate protection and audit history.
- Supplier credits/returns, allocation to invoices and controlled reversal.
- Weekly payment plans with budget and current balances.
- Supplier price comparison by matching product, brand and unit; editable purchase orders, receipt and conversion to draft invoices.
- Private PDF/JPEG/PNG/WebP documents linked to suppliers, invoices, payments, orders or credits.
- Current and historical balance reports, CSV and print/PDF.
- Business snapshots before the first write each UTC day, manual snapshots, download and non-destructive restore as a separate business.
- Transactional RPCs, RLS, business-scoped foreign keys, optimistic versions and idempotent commands.

Local/demo mode retains the original AP workflows. Advanced v2 operations require the shared workspace; local records never synchronize automatically.

## Source and deployment

`src/core` contains calculations and persistence; `src/ui` contains forms/pages. The v2 upgrade is `supabase/migrations/20260921201114_business_operations_v2.sql`. `scripts/v2` preserves migration generation sources. Run the upgrade once after the existing v1 schema; do not apply the old unscoped import scripts after upgrading.

See [deployment](docs/DEPLOYMENT.md), [validation](docs/VALIDATION.md) and [release notes](docs/RELEASE_V2.md).

## Limits

This is an AP/purchasing module, not a full general ledger, POS, inventory, recipes or payroll system. Payments record externally made transactions; no money is transferred. Invoice amounts are entered manually; OCR/AI extraction is not enabled. Purchase-order receipt is whole-order, not partial. Quotes are entered manually, with no automatic unit conversion.

Snapshots share the same database and exclude document bytes and Auth credentials; they do not replace independent disaster-recovery backups. A restored business keeps financial history and gets new IDs; only the restoring administrator receives access. Documents remain in the original business.

Account creation/confirmation remains in Supabase Authentication; business access is managed in the app. Password recovery and email changes depend on Auth URL and email-provider configuration. Private website sharing is an additional access gate. Snapshots load all business records; server pagination is needed before large-scale use.
