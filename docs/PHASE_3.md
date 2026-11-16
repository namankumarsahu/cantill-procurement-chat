# Phase 3 delivery

Phase 2 commit: e5d46f7 (scaffold, schema, seed/import and v5 policy).

## What is implemented

- Pure TypeScript engine: validation, deterministic description matching, anchor-
  based clubbing, exact-decimal valuation, shared contract ceilings, ordered JSON
  rules, preferred suppliers and sourcing top-up, and chronological PO consolidation.
- All decision thresholds and business windows come from the policy JSON.
- POST /api/process-batch accepts multipart CSV and optional as-of/version/import
  parameters. Runs save raw lines, policy snapshots, results and audit provenance
  in PostgreSQL. GET /api/runs/:id/export returns the required CSV format.
- Source dataset rows are never dropped: the two invalid sample rows are
  NOT_PROCESSED with explicit reasons. Blocked/Inactive suppliers cannot receive
  proposals or appear in preferred/suggested lists.

## Verification

All fourteen worked scenarios pass; see WORKED_EXAMPLES.md for individual results.
The three published preferred-list examples also match. A real HTTP call against
the seeded PostgreSQL database returned 186 output rows, 149 requirements and
82 PO proposals, including exactly two NOT_PROCESSED rows. Its exported CSV
contains every input row.

Additional tests cover exact limit/date boundaries, shared ceilings across items,
contract precedence, inactive suppliers, expired contract history, ambiguity and
model-number matching, duplicates and malformed rows, repeatability, snapshots,
transaction rollback, effective policy selection, CSV escaping, and actual HTTP
round trips. JSON-only threshold, plant-rule and new-route changes are tested.

The PDF's illustrative PO numbers are not compared literally; chronological IDs
and consolidation relationships are verified. Money is compared at source-data
precision, while the PDF rounds to rupees.

## How to run

Follow README.md for PostgreSQL configuration, migration, seeding and startup.
Run npm test, npm run typecheck and npm run build. Set TEST_DATABASE_URL to
include real PostgreSQL tests; KIT_DATA_DIR selects optional local fixtures.
Use npm run test:worked or npm run report:worked for the fourteen examples.

## Still open

The web app currently provides master-data import and preview. Chat intake, batch
upload UI, buyer approvals/overrides, supplier export, policy upload/approval,
manual contract-conflict resolution, Docker packaging and public deployment remain
for later phases. Runs currently return proposals and never place real orders.
