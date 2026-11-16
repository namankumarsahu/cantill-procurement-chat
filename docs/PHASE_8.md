# Phase 8 checklist and verification

Prepared locally on 16 November 2026. **Public deployment and acceptance checks
against its URL remain pending the user's manual deployment and URL.** No cloud
account/resource or public URL was created or claimed.

- [x] Multi-stage Dockerfile compiles server and web, prunes development
  dependencies and runs as the unprivileged node user. Compose starts PostgreSQL
  18 and one app service serving both server and React. Database readiness gates
  startup; a named volume persists state.
- [x] A fresh isolated Compose volume started using .env.example, with only v5.0
  policy seeded and latest_import=null. Both services became healthy and the
  React root page loaded. Test port 3100 avoided the existing local app on 3000.
- [x] The production image contained no kit_data, .env, test datasets or BuildKit
  CA secret; the running app's uid was 1000. No host files were mounted into the
  production smoke app.
- [x] Import preview/confirmation via the same multipart endpoint used by the
  Import screen loaded the original ZIP: 12 contracts/PDFs, including two
  PDF-only contracts. The hosted guide permits seeding only through the screen.
- [x] Container acceptance processed 186 sample rows under v5.0, generated a
  manual JSON amendment, reviewed impact, approved it, and reprocessed the same
  run ID. Exactly 22 predicted CHK1 lines changed SPOT_PO to RFQ. No-key bearing
  intake asked for a plant. Restart preserved the master import snapshot.
- [x] Download responses produced yourname__run1.csv, yourname__run2.csv and
  yourname__preferred.csv with the original exact header schemas. Prefix inputs
  reject path separators, periods, control characters and excessive length.
- [x] Render Docker blueprint and exact manual Neon/Render instructions include
  environment variables, verified database TLS, health path /api/health, import
  clicks and an authenticated opt-in demo reset. No automatic hosted data seed.
- [x] Production startup requires ADMIN_TOKEN. Tests verify missing/incorrect
  tokens cannot import/approve/reset, reset is disabled by default, production
  reset needs explicit enablement, and confirmation is a strict boolean. Health
  failure returns 503 without database details.
- [x] Thursday checklist gives the click path for prefix, run1, amendment review/
  impact/approval, run2, and preferred export. The baseline must be downloaded
  before its run is replaced. Labels never select a policy.
- [x] README, DECISIONS and APPROACH reflect implemented behavior, exact dates,
  money rounding, ranking formula/example, data-quality choices, model boundaries,
  no-key/manual fallbacks and deployment limits. Coding disclosure is Codex
  GPT-6.1 Sol/Terra; app parsing uses Groq.
- [x] Git excludes kit_data, .env, tmp, generated builds and every CSV output.
  tmp/acceptance-chat.mjs was never tracked; no deletion from Git was necessary.
  submission/.gitkeep is tracked and submission CSVs are ignored.
- [ ] Run public deployed acceptance checks after the URL is supplied, including
  actual browser download clicks, configured hosted Groq and persisted state.
  The attempted packaged browser automation timed out; container HTTP download/
  workflow checks completed. This is not a claim of a hosted browser pass.

## Test results

Final Linux Docker regression: **72/72 pass, zero failures or skips**, including
all 14 worked examples and actual kit/PDF tests. Source kit was mounted read-only
only into the separate test image, never built into the production image.
Typecheck, Vite production build and compiled server build pass.

The first Windows full run had 71/72 pass: one amendment HTTP test hit ECONNRESET
during local resource contention. The same case passed alone afterward; the
complete Linux run then passed all 72. No assertions were removed or weakened to
hide that failure. Focused export/production-reset tests also passed.

The local TLS proxy prevented npm downloads in a plain Linux build until the
machine's existing public CA certificates were supplied through the optional
npm_ca BuildKit secret. Certificate verification remained enabled; the bundle
was not copied into runtime. On that network use docker-compose.ca.yml and an
existing trusted PEM bundle as documented in README. Standard public-network
builds use the main Compose file and copied .env.example only.

Container logs/reports and the complete tracked-file inventory are in ignored
tmp/: docker-smoke.log, docker-acceptance.json, phase8-linux-regression.log and
tracked-files.txt. The normal localhost:3000 app was restarted with the new
backend/export UI; the isolated Compose stack was stopped, retaining its volume.

## Git evidence

Executed `git ls-files` and saved its full inventory. This targeted command
returned no paths:

```sh
git ls-files '*.csv' '*.CSV' '*.tsv' '*.xlsx' '*.pdf' '*.zip' '.env' 'tmp/*' 'kit_data/*'
```

`git ls-files 'tmp/acceptance-chat.mjs'` also returned nothing.
`git check-ignore kit_data/check.txt .env tmp/acceptance-chat.mjs submission/check.csv`
confirmed all four are excluded. Mixed-case submission/check.CSV is excluded too.
Tracked policy JSON files are hand-authored configuration, not task datasets.

## Remaining handoff

Follow [deployment steps](DEPLOY_RENDER_NEON.md), seed through Import data, and
use [Thursday checklist](THURSDAY_CHECKLIST.md). Send the live HTTPS URL back here.
Hosted regression/acceptance verification waits for that URL. No production DB
reset or cloud deployment was performed as part of local verification.
