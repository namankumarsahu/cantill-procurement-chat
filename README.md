# Corvo procurement workspace

A policy-driven PR-to-PO take-home project for Cantill.ai.

Current status: **phase 2, scaffold and imports**. Read [the review and proposed schema](docs/PHASE_1.md),
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
Later phases add the engine/API, supplier ranking exports, policy version workflow,
requester/buyer UI and audit, contract extraction, and deployment.

The actual v5 seed is `server/policies/v5.0.json`; the earlier JSON in `docs/` is
only a design example. Thresholds and windows are data, not engine constants.
