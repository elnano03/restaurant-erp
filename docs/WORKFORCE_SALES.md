# Workforce, Sales & Cash — v2.4

## Workforce
Employees have a unique clock code per business, active/inactive status, job/department, availability/skills notes, emergency contact and hourly rate. Rate changes retain an audit history. No employee records are seeded in production.

Scheduling checks same-employee overlaps and approved leave. Time-off approval also rejects conflicts with scheduled shifts. Availability and skills are notes, not an automatic scheduling engine. Dates/times display in America/New_York with 12-hour clocks. Nonexistent/ambiguous daylight-saving local times must be imported with explicit ISO offsets.

Attendance supports missing clock-outs, unpaid break minutes, drafts, approval and voiding. Entries may span midnight, up to 24 elapsed hours. Future punches, invalid breaks and overlapping nonvoid entries are rejected on the server. Updates require an optimistic version and correction reason. Hourly rate is captured at initial entry creation and preserved when that employee's punch is corrected. Historical imports therefore need the correct employee rate set before importing; this is not an effective-dated rate engine.

Payroll review requires a period of at most 32 days without draft punches. It snapshots approved minutes, rate and base pay, locks included entries and prevents duplicate inclusion. Hours belong to their Eastern clock-in date. Review is a BASE-PAY worksheet, not final wages: no overtime premium calculation, paid-leave accrual, tip allocation, deductions, taxes, direct deposits or filings. An admin may void a review with a reason to unlock entries; the original remains in history. Coordinate any replacement with the payroll provider if an export was already used.

Document reminders track document title, expiration and reference notes. Original file upload/signature workflow is not part of this release.

## Access and audit
Business admins have HR access. They can grant/revoke HR access to an existing active member in Workforce > Access & history. That grant does not grant purchasing/accounting write access. Other members cannot read employee, scheduling, attendance, leave, payroll or certificate records. Sales/tasks remain visible to business members, writable by admin/accountant. Private tables have RLS, no direct client grants; authorized private functions behind invoker RPC wrappers check membership and permissions.

Requests are idempotent; business locking serializes writes; stale version updates are rejected. Before/after values, actor, timestamp and reason are retained in a separate HR-safe audit, outside the general AP audit. Recent history shows the latest 200 accessible changes. HR command payloads are not persisted in the browser pending-command session storage.

## Sales & cash
One record per normalized source/reference per business. Gross sales less discounts/refunds gives net sales; tax/tips stay separate. Net cash/card/other tender must equal net sales + tax + tips to close. Expected drawer cash = opening + cash tender - cash paid out. Any variance requires explanation. Closed records are immutable until an admin reopens with reason; changes retain history. Negative net sales are not supported: investigate/adjust source report before entry. Use one drawer/source/reference per close and do not duplicate opening float across multiple sources.

Cash outlook subtracts approved AP balances (including overdue and held invoices) due within 7/30/60 days from entered available cash. It is not a bank balance, complete cashflow forecast, profit statement, general ledger or reconciliation. It excludes payroll/rent/taxes/other commitments and future receipts. Closed MTD net sales are shown separately from cash.

## Imports
Download the attendance or sales template from Import CSV. Files are limited to 1 MB and 200 rows. Map your external report columns to the template first. Review all rows before confirming. Batches are atomic and create drafts; duplicate source/reference or overlapping punches reject the batch. Original ZKTeco Monthly Summary spreadsheets and native Square exports are not yet automatically mapped; live connectors are not installed by this release.

## Operations
Kitchen > Operations checklist tracks opening, closing, cleaning, maintenance, incidents and training tasks with owner, due date, status and completion notes. This is not recurring task automation, equipment asset accounting or a training LMS.

## Export / recovery boundary
HR archive exports all current HR records for the current business as JSON. Each register exports filtered CSV; payroll review exports minutes, rate and base pay. Existing AP daily/manual backup/restore does NOT include these new private records. Do not assume an AP restore recovers Workforce or Sales & Cash. Keep separate exports until integrated module recovery is implemented. No employees, wages or sales data are committed to source control.

## Verification
PostgreSQL-compatible integration tests exercise access revocation, private-table denial, anonymous denial, HR isolation, version checks, duplicate codes, midnight/break arithmetic, historical rate preservation, payroll lock/void/replacement, time-off conflicts, sales reconciliation, idempotency and batch rollback. React DOM tests cover forms, cents conversion, role restriction and import preview. Existing financial/inventory/kitchen suites remain gates. Browser visual QA unavailable because the prescribed control-browser skill is not exposed in this environment.

## Next phases
Native Square and clock adapters, overtime/payroll-provider integration, document files, automatic skill-based scheduling, bank reconciliation/general ledger, partial PO receipts, lot/expiry inventory, transfers and prepared-goods/subrecipes remain separate implementation phases.
