# Corvo procurement workspace

A policy-driven PR-to-PO take-home project for Cantill.ai.

Current status: **phase 3 complete: deterministic engine, batch API, and CSV export**. Read [the review and proposed schema](docs/PHASE_1.md),
[business decisions](DECISIONS.md), and [tool disclosure](APPROACH.md).

## Local kit

Extract the task ZIP contents into `kit_data/`, with `master_data/`, `contracts/`,
`pr_batches/`, and the three source PDFs directly beneath it. This folder and its
extracted text are ignored. Do not commit datasets, PDFs, `.env`, or credentials.

## Run locally

Install Node.js 24+ and PostgreSQL. Create an empty database, then:

```sh
npm ci
# Copy .env.example to .env and set DATABASE_URL and ADMIN_TOKEN.
npm run migrate
npm run seed -- ./kit_data
npm run build
npm start
```

Open http://localhost:3000. For web development, run `npm run dev` and
`npm run dev:web` in separate terminals; Vite proxies `/api` to the backend.
Docker packaging and public hosting remain phase 8. Hosted URL: pending deployment.

The seed CLI reads the register snapshot date from the kit README. For a different
kit, pass `--snapshot-date=YYYY-MM-DD`. The admin screen accepts the original ZIP,
previews extracted contract terms, then requires confirmation before importing.
The screen and CLI share the import service. No kit files are required at runtime
after import; PostgreSQL stores master data, raw PRs, and contract source bytes.

Imports are immutable and content-addressed; importing the same content again
returns its existing ID. PDF/register discrepancies stop import for confirmation;
manual conflict resolution belongs to the later contracts screen.

## Checks

```sh
npm test
npm run typecheck
npm run build
# Include PostgreSQL integration tests against a disposable/test database:
TEST_DATABASE_URL=postgresql://user:password@localhost/test npm test
```

In PowerShell, set `$env:TEST_DATABASE_URL='postgresql://...'` before `npm test`.
DB tests create and remove their own random schema, never the supplied database.
Kit-backed tests skip when `kit_data/` is absent; set `KIT_DATA_DIR` to use a
different kit directory. Synthetic tests always run.

## Environment and API

- `DATABASE_URL`: required PostgreSQL connection string. For hosted TLS, include
  the provider's connection options; do not disable certificate validation.
- `PORT`: defaults to 3000.
- `ADMIN_TOKEN`: bearer token for imports; required in production. Without one,
  the server binds to loopback and accepts imports only from loopback.
- `SEED_ACTOR`: optional CLI audit actor; the web API requires `x-actor`.
- `LLM_BASE_URL`, `LLM_MODEL`, `LLM_API_KEY`: reserved for later parsing features.

`GET /api/health` checks the database. `GET /api/status` lists the current import
and policies. `POST /api/admin/import-master` accepts multipart `file` (ZIP), optional
`snapshot_date`, `x-actor` and `Authorization: Bearer ...`. Its first response is a
preview with a fingerprint; resubmit with `confirm_fingerprint` to save exactly
the reviewed content. Uploads are limited to 10 MB compressed / 50 MB expanded.

## Code boundaries

TypeScript monorepo: pure `engine/`, Express `server/`, React `web/`, PostgreSQL.
Phase 2 includes migrations, imports, policy validation and the hand-authored v5 seed.
Phase 3 includes the pure engine, supplier ranking needed for decisions, the batch
API, and persisted CSV exports. Later phases add supplier ranking exports, policy version workflow,
requester/buyer UI and audit, contract extraction, and deployment.

The actual v5 seed is `server/policies/v5.0.json`; the earlier JSON in `docs/` is
only a design example. Thresholds and windows are data, not engine constants.


## Process a PR batch

With the server running and master data imported:

```sh
curl -X POST http://localhost:3000/api/process-batch \
  -H "x-actor: buyer-demo" \
  -F "file=@kit_data/pr_batches/sample_pr_batch.csv" \
  -F "policy_version=5.0" \
  -F "as_of_date=2026-11-20"
```

Use `curl.exe` in PowerShell and put the command on one line (the backslashes
above are shell line continuations). `file` is the multipart CSV field. Optional
parameters can be separate multipart fields or a JSON `params` field containing
`as_of_date`, `policy_version`, and optionally an immutable `import_id`.
Without an as-of date, the latest valid input creation date is used. Without a
version, choose the latest approved policy effective on that date. Future and
draft policies cannot be used early. See DECISIONS.md for cutoff and replay rules.

The JSON response contains `run_id`, `rows` (one per input line), `requirements`
(with clause, contract/PO evidence, valuation source and ranking breakdown),
`purchase_orders` (proposals), `contract_consumed` (simulated), and `export_url`.
Processing does not place orders or consume live ceilings.

Fetch `GET /api/runs/<run_id>/export` for the exact required CSV column order,
or `GET /api/runs/<run_id>` for the saved result. In CSV only, `group_value_inr`
rounds half-up to the nearest rupee; JSON and stored values keep paisa, and
unit prices retain their precision. Runs retain policy JSON and an
immutable master-data snapshot reference. Invalid rows remain in the export with
route NOT_PROCESSED and a reason. Formula-like text is escaped for spreadsheet
safety; API values preserve the original input.

```sh
npm run test:worked
npm run report:worked
```

The [worked-example report](docs/WORKED_EXAMPLES.md) records all 14 scenarios.
All pass on routes, source-data values, suppliers/rates, suggestions, and illustrated
group/consolidation relationships. PO labels differ from the PDF's illustrative
labels; deterministic chronological numbering and membership are tested.

Thresholds and history/clubbing/consolidation windows live in
`server/policies/v5.0.json`. Tests demonstrate raising the spot limit, adding a
plant-only restriction, and adding a sourcing route using JSON changes alone.
Uploading and approving amendments through the app is phase 5, not yet available.


## Preferred suppliers (phase 4)

Use the Preferred suppliers screen, choose an as-of date and calculate. Expand an
item to see eligible suppliers, factor contributions and reference-price evidence.
Download exports the top three eligible suppliers per item with exactly
`item_code,rank,supplier_id,reference_price`. Items with no eligible suppliers
remain visible in the UI and contribute no CSV rows.

GET /api/preferred-suppliers and /api/preferred-suppliers/export take required
`as_of_date` and optional `policy_version`, `import_id`, and `item_code`. The UI
pins both the returned policy and import snapshot in its export link. Weights,
recency bands and eligibility windows come from the chosen policy JSON.
