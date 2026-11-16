# Deploy by hand: Render + Neon

The hosted URL is pending your deployment. This repository does not contain kit
files and does not create cloud accounts or paid resources. These instructions
were checked against the linked official documentation on 16 November 2026.

## 1. Create the database in Neon

1. Sign in to Neon and create a project using its Free plan. Pick a region close
   to the Render region you will use. Keep the default branch/database or create
   a dedicated `corvo` database. Use a disposable demo database for this exercise.
2. Click **Connect**, select that branch/database and its owner role. Turn off
   connection pooling for this small app and copy the direct PostgreSQL URL.
   The app uses at most five connections; startup runs transactional migrations.
3. Keep the URL secret. Set its TLS option to `sslmode=verify-full` (replace an
   existing `sslmode=require`, do not add a second sslmode). Retain other provider
   parameters, including `channel_binding=require` when supplied. The connection
   should resemble `postgresql://USER:PASSWORD@HOST/DB?sslmode=verify-full`.
   The installed node-postgres driver accepts that URL. Do not add
   `rejectUnauthorized=false`, `sslmode=no-verify` or NODE_TLS_REJECT_UNAUTHORIZED.

Neon's [connection guide](https://neon.com/docs/connect/connect-from-any-app)
describes the Connect modal, URL and optional pooler. The
[node-postgres TLS guide](https://node-postgres.com/features/ssl) explains URL
options and why an additional `ssl` object must not conflict with them.

## 2. Create a Render web service

1. Push the committed project to a GitHub repository you control. Ensure the
   selected branch includes Dockerfile, package-lock.json and web sources.
2. In Render choose **New → Web Service**, connect the repository, and select
   that branch. Use **Docker** runtime, repository root as Root Directory, and
   `./Dockerfile` as Dockerfile Path. Choose a nearby region and the **Free**
   instance type if it is available to your account. Do not create a Render DB;
   this deployment uses Neon. No build/start command override is needed.
3. Under **Environment**, set the variables in the table below. Generate a new
   admin secret locally with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`.
   Put the result in Render's secret field; do not use the Compose demo token.
4. Under **Advanced**, set Health Check Path to `/api/health`. Disable automatic
   deploys if you want to control assessment changes manually. Click **Deploy Web
   Service**. The Docker command compiles server/web, starts migrations and seeds
   only policy v5.0. It does not seed any master/task data.
5. Wait for **Live** and open the service's HTTPS URL. Check
   `https://YOUR-SERVICE.onrender.com/api/health`: HTTP 200 with `{"status":"ok"}`.
   Database errors return 503 with `{"status":"unavailable"}`. The root page
   should load before master import. `/api/status` should have `latest_import:null`.

| Variable | Value / purpose |
| --- | --- |
| NODE_ENV | `production` |
| PORT | `10000`; Render forwards to this port, and the app binds 0.0.0.0 |
| DATABASE_URL | Secret direct Neon URL with `sslmode=verify-full` |
| ADMIN_TOKEN | Required new random secret; startup fails if missing |
| ALLOW_DEMO_RESET | `false` normally; `true` only on a disposable demo when a reset is needed |
| EXPORT_FILENAME_PREFIX | `yourname`, or your actual submission-name prefix; editable in the app |
| LLM_BASE_URL | Optional `https://api.groq.com/openai/v1` |
| LLM_MODEL | Optional `openai/gpt-oss-120b`, the model used in local acceptance checks |
| LLM_API_KEY | Optional secret Groq key; never a VITE_ variable |
| LLM_RESPONSE_FORMAT | `json_schema`; `json_object` is a fallback for a provider lacking schema mode |

Leave all three LLM connection variables blank for no-key mode: local chat
parsing and the manual policy JSON editor remain available. APP_PORT and the
Compose database credentials are local-only and are not Render settings.

The optional render.yaml describes the same service for **New → Blueprint**;
the manual Web Service steps above are sufficient. Enter secret values in the
dashboard, never into render.yaml. See Render's
[web-service guide](https://render.com/docs/web-services),
[Docker guide](https://render.com/docs/docker) and
[health-check guide](https://render.com/docs/health-checks).

## 3. Seed through the app only

1. Open **Acting user and admin access**, enter your name and the ADMIN_TOKEN.
   Choose **Procurement** in Working as.
2. Open **Import data → Task kit ZIP**. Select the original kit ZIP from your own
   computer. Leave Register snapshot date empty when its README supplies the date.
3. Click **Preview import**, inspect counts, warnings and extracted contract
   terms, then **Confirm and import**. All source bytes and extracted/master data
   are saved in Neon. Nothing is written to Render's local filesystem.
4. Check **Contracts**: 12 PDFs and 12 contracts for the supplied kit, with two
   pdf_only entries. Open **Upload batch** to start the Thursday checklist.

The image has no task data and no seed CLI entry point. Do not mount/upload kit
files into the hosting filesystem or run a data seed in a Render build command.
An admin token is required for import, policy draft/approval, contract changes,
buyer approval/override and remote reset. The role selector alone is not access
control. Read-only screens and requester/batch processing are public demo flows.

## 4. Reset a disposable hosted demo, if needed

Reset is disabled by default. It deletes non-v5.0 policies, all runs/proposals,
buyer decisions, procurement documents and local contract allocations. Imports,
raw batches, source documents and audit history remain. Stop other batch/buyer
activity first. It does not erase task master data or audit evidence.

Temporarily set ALLOW_DEMO_RESET=true in Render and redeploy. Use PowerShell:

```powershell
$demoUrl = 'https://YOUR-SERVICE.onrender.com'
$demoSecret = Read-Host 'Admin token' -AsSecureString
$demoCredential = [pscredential]::new('admin', $demoSecret)
$demoHeaders = @{Authorization=('Bearer '+$demoCredential.GetNetworkCredential().Password); 'x-actor'='YOUR NAME'}
# Read the dry-run list first. This request does not delete anything.
Invoke-RestMethod "$demoUrl/api/admin/reset-demo" -Method Post -Headers $demoHeaders -ContentType 'application/json' -Body '{}'
# Run this separately only when you intend the displayed reset:
Invoke-RestMethod "$demoUrl/api/admin/reset-demo" -Method Post -Headers $demoHeaders -ContentType 'application/json' -Body '{"confirm_reset":true}'
```

Both requests require the admin token. Switch ALLOW_DEMO_RESET back to false and
redeploy after resetting. Never enable it on a real purchasing database. Local
`npm run reset:demo` retains the same dry-run/--confirm-reset workflow.

## 5. Verify and hand back the URL

Follow [Thursday checklist](THURSDAY_CHECKLIST.md). Keep the two batch CSVs and
preferred CSV outside Git. Send the live URL back in this chat for the requested
deployed acceptance pass. Unit/database regression tests run locally or against
an isolated test schema, not through the public URL or by resetting the hosted DB.
Full deployed verification remains pending until that URL is supplied.

Render Free services currently sleep after 15 minutes without inbound traffic
and may take about a minute to wake. Their filesystem is ephemeral; Neon keeps
the application data. Warm the app before the assessment and check account
quotas in both dashboards. See [Render Free limits](https://render.com/docs/free).
No paid upgrade is required by these instructions; stop if a dashboard proposes
a charge and choose an available free option instead.
