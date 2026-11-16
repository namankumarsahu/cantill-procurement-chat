# Corvo procurement workspace

Cantill.ai take-home: requester chat, deterministic policy-driven purchasing,
buyer approval/override/audit, contract PDF reconciliation, and versioned policy
amendments with a diff and batch impact preview. TypeScript, React, Express and
PostgreSQL. Limits, windows, weights and ordered routing rules live in policy JSON.

**Hosted URL: pending your manual deployment.** Follow
[Render + Neon deployment](docs/DEPLOY_RENDER_NEON.md), then send the live URL for
deployed acceptance checks. Local checks do not claim a public deployment passed.

## One-command local run

Install/start Docker Desktop (Linux containers) or Docker Engine + Compose.
From a fresh clone:

```sh
cp .env.example .env
docker compose up
```

PowerShell uses `Copy-Item .env.example .env` for the copy. If you already have
an .env, keep it and merge settings instead of overwriting your secrets.
Open **http://localhost:3000**. Compose runs PostgreSQL and one app container
serving both API and built web. It waits for database readiness, migrates safely,
and seeds policy v5.0. No kit files or LLM key are needed to start.

The sample admin token is `local-demo-only-change-me`, for local use only. Enter
it under **Acting user and admin access** before import/approval. Set a random
ADMIN_TOKEN for hosting. Compose publishes the app on loopback and does not
publish the DB port. If 3000 is busy, change APP_PORT in .env to 3100.

```sh
docker compose up --build -d --wait
docker compose ps
docker compose logs --tail=50 app
docker compose stop
```

The named database volume survives stop/restart and redeploy. Do not remove it
unless you intend to erase that local database. Compose overrides DATABASE_URL
to its private db service; the .env DATABASE_URL is for non-Docker Node usage.

On a network with a private TLS-inspection CA, trust that existing CA during
build using the Dockerfile's optional BuildKit secret `npm_ca`. It is not stored
in the image. Do not disable TLS checking to fix certificate errors. Normal
public-network builds need no additional secret.

If your existing corporate CA is in a PEM bundle, the optional override is:

```powershell
$env:NPM_CA_FILE = 'C:/path/to/your-existing-trusted-ca.pem'
docker compose -f docker-compose.yml -f docker-compose.ca.yml up --build
```

Use a CA already trusted by your machine/organization; this is a network setup
exception, not a task-data or application-secret requirement. No CA is bundled.

## Import your kit

The repository/image contains no task datasets. Choose **Procurement**, enter
your actor name/token, then **Import data → choose original kit ZIP → Preview
import → review counts/warnings/contract terms → Confirm and import**. The README
in the ZIP supplies the register snapshot date; override it only when appropriate.
The supplied kit yields 73 items, 48 suppliers, 468 history POs and 12 contracts/
PDFs, including two absent from the register. Inspect those flags in **Contracts**.

PostgreSQL stores every imported source document and immutable master snapshot;
the hosted app relies on no local dataset files after import. A matching
fingerprint is reused. A signed PDF/register discrepancy stops the bulk import;
resolve conflicting source data before confirming. The Contracts screen supports
buyer-confirmed additions/corrections as new master snapshots after an import.
Uploads are limited to 10 MB compressed and ZIP expansion to 50 MB/200 entries.

For local development only, extract the kit into ignored kit_data/ with
master_data/, contracts/, pr_batches/ and its README/source PDFs. The equivalent
CLI is `npm run seed -- ./kit_data`, optionally `--snapshot-date=YYYY-MM-DD`.
Hosted seeding is exclusively through the Import data screen.

## Use the app

- **Request an item:** describe the item and any known quantity, plant, need-by
  date and Normal/Emergency urgency. Clarify candidates/missing fields, review the
  summary, then confirm to create a PR. Vague items prompt a question; named
  unknown items become NEW and require an estimate/UOM. No key/provider failure
  uses local parsing and deterministic matching.
- **Upload batch:** choose CSV, as-of date, policy version and run1/run2 export
  label. Process, inspect route counts, and click the named CSV download. Identical
  content replaces that batch's current unapproved decisions, preserving history
  in audit. Download run 1 before reprocessing. Approved documents cannot be
  silently replaced; an identical replay remains idempotent.
- **Buyer workspace:** review requirement PR lines, values, supplier/rates or
  suggestions, clauses, policy/contract/history provenance and ranking factors.
  Buyer/Procurement approval creates durable PO/RFQ/RFP/sourcing records. A PO
  approval includes all pending members of its consolidated proposal. Overrides
  require comments and retain the original evidence. See Audit log for before/
  after, who and when.
- **Policy updates:** upload PDF/text or describe an amendment. Review the
  validated plain-language diff, rule restatements and impact preview before
  approval. Regenerate with feedback or edit JSON if needed. Approved versions
  apply from their effective dates; future versions stay scheduled.
- **Preferred suppliers:** choose a date, calculate, inspect factor contributions,
  then download top three per item. Blocked/Inactive suppliers are excluded.
- **Contracts:** compare stored terms to all source PDFs, select validity date,
  prepare an extraction/manual draft, then confirm fields and opening consumption
  with a review comment. Deterministic extraction precedes LLM fallback; scans
  require manual transcription.

Set **Export filename prefix** once (letters/digits/underscore/hyphen) for
yourname__run1.csv, yourname__run2.csv and yourname__preferred.csv. This browser
remembers the prefix; secrets stay in memory. See the exact click path in the
[Thursday checklist](docs/THURSDAY_CHECKLIST.md).

## Environment

| Variable | Purpose |
| --- | --- |
| DATABASE_URL | PostgreSQL URL; hosted Neon URL uses sslmode=verify-full |
| PORT | Node HTTP port, default 3000; Render guide sets 10000 |
| APP_PORT | Local Compose published port, default 3000 |
| NODE_ENV | production for Docker/hosting; missing ADMIN_TOKEN fails startup |
| ADMIN_TOKEN | Remote mutation bearer secret; replace the local example token |
| ALLOW_DEMO_RESET | false by default; true permits token-protected reset on a disposable demo |
| EXPORT_FILENAME_PREFIX | Default UI/download prefix, yourname; user can override in UI |
| LLM_BASE_URL | Optional OpenAI-compatible base, e.g. https://api.groq.com/openai/v1 |
| LLM_MODEL | Optional model; local acceptance used openai/gpt-oss-120b |
| LLM_API_KEY | Optional server-only secret |
| LLM_RESPONSE_FORMAT | json_schema by default; json_object if a provider requires it |
| SEED_ACTOR | Optional local CLI audit actor |
| TEST_DATABASE_URL | Disposable test database; tests create/drop random schemas |
| KIT_DATA_DIR | Optional location for kit-backed tests/inspection; default kit_data |

Read-only screens and requester/batch flows are public demo functions. Remote
import, policy edits/approval, buyer/contract changes and reset require the admin
token. Roles/actor names are demo identity, not production user authentication.

## Health and API

`GET /api/health` runs SELECT 1: 200 `{"status":"ok"}` or 503
`{"status":"unavailable"}`. `/api/status` lists the current import and policies.

`POST /api/process-batch` takes multipart `file` plus optional as_of_date,
policy_version, import_id (or a JSON `params` field). It returns decisions and
export_url. `GET /api/runs/:id/export?prefix=yourname&run=run1` downloads the
current run as yourname__run1.csv; run2 selects the other filename. Naming does not
select a policy or preserve an older result. Decision CSV headers are exactly:

```text
pr_no,pr_line,resolved_item_code,group_id,po_id,decision,route,supplier_id,unit_price,group_value_inr,suggested_supplier_ids,policy_version,reason
```

Preferred export: `GET /api/preferred-suppliers/export?as_of_date=YYYY-MM-DD&prefix=yourname`,
optionally policy_version/import_id. Headers: item_code,rank,supplier_id,reference_price.
It exports at most three eligible suppliers per item, omitting empty lists.

Admin endpoints take `Authorization: Bearer TOKEN` and `x-actor: NAME`. Import is
`POST /api/admin/import-master`, first preview then confirm_fingerprint. Policy
approval is `POST /api/admin/policies/:version/approve`, requiring the current
review_hash and saved preview_id. Remote reset is `POST /api/admin/reset-demo`:
default body `{}` previews; `{"confirm_reset":true}` deletes the reviewed class
of demo data when ALLOW_DEMO_RESET=true. It preserves imports, raw batches and
audit. Keep that flag false normally; never reset a real procurement DB.

## Development and tests

Without Docker: install Node 24+ and PostgreSQL, create an empty DB, set .env, then:

```sh
npm ci
npm run build
npm start
```

Startup handles migrations and v5.0 idempotently. For editing, use `npm run dev`
and `npm run dev:web` in separate terminals (Vite proxies /api to port 3000).
The pure engine has no DB, HTTP, filesystem or wall-clock access.

```sh
npm run typecheck
npm run build
npm run build:server
npm test
npm run test:worked
# Include integration tests:
TEST_DATABASE_URL=postgresql://USER:PASS@localhost/test npm test
```

In PowerShell set `$env:TEST_DATABASE_URL='postgresql://...'` before the test
command. Use a test database: integration tests create/drop their own random
schemas. Kit tests skip when the supplied kit is absent; put it in kit_data or set
KIT_DATA_DIR. Do not run integration tests or a reset against your hosted demo
database while it is in use. `npm run reset:demo` is a dry run; `-- --confirm-reset`
performs a local demo reset. Production mode also requires ALLOW_DEMO_RESET=true.

See [business decisions](DECISIONS.md), [approach/tools](APPROACH.md),
[14 worked cases](docs/WORKED_EXAMPLES.md), [acceptance results](docs/ACCEPTANCE_CHECK.md),
and [phase 8 verification](docs/PHASE_8.md). Older phase reports are historical
checkpoints. Current policy is server/policies/v5.0.json, not the design example.

kit_data/, .env, tmp/, build output and all CSV outputs are ignored. submission/
contains only .gitkeep in Git; put your downloaded submission files there locally.
