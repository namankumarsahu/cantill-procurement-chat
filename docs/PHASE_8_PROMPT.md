# Phase 8 prompt

Continue with phase 8 only: Docker Compose, deployment, documentation and final
cleanup. The local acceptance check is in docs/ACCEPTANCE_CHECK.md; all 68 tests
and 14 worked examples pass. Preserve that behavior.

Make docker compose up build and run the React/Express app and PostgreSQL from a
clean checkout, with health checks and persistent database storage. Migrations
and the v5.0 policy seed should run safely and idempotently. Kit data must remain
optional at startup and enter through the admin import screen or seed CLI. Do not
require files from this workstation in the container or hosted runtime.

Deploy to a currently available free host with hosted PostgreSQL. Verify current
free-tier constraints before choosing a provider. Prepare and validate deployment
configuration before requesting any account access that is actually missing.
Configure secrets through environment variables, preserve the admin-token guard
for remote changes, and never commit the Groq key, .env, database files or kit data.

Finish README.md, DECISIONS.md and APPROACH.md in plain English, including the
real public URL, local/hosted setup, seeding, test commands, LLM/no-key behavior,
policy approval/effective dates, ranking formula, rounding and known limitations.
Check that kit_data and secrets are ignored and no data CSVs/PDFs are tracked.

Run the regression suite and repeat the acceptance workflow against the deployed
app: chat and follow-ups, batch upload/export, buyer approval/override/audit,
contracts, policy text upload/diff/impact/approval/reprocess, and supplier export.
Check the exact CSV headers and only the predicted amendment changes. Do not run
the demo reset against a production database.

Commit the phase separately. Stop and summarize the public URL, commit, test
results and any concrete remaining limitations. If hosting is blocked by missing
account access, finish all independently testable work and state exactly what
access is needed; do not claim deployment succeeded without verifying the URL.
