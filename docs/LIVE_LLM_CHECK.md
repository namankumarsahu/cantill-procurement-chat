# Live Groq check - 16 November 2026

The supplied key is configured only in ignored .env. Groq authentication and
model availability were verified. The local app uses openai/gpt-oss-120b with
strict JSON-schema output. No key is included in this report, source, or exports.

## What the live test found

The first request exposed a provider compatibility bug: Zod startsWith produced
a nonstandard starts_with string format rejected by Groq. A standard regex now
expresses the same JSON-pointer constraint. Local validation is unchanged.
Provider errors now include a bounded diagnostic with the API key redacted.

The first successful model response was structurally valid but semantically
wrong: narrower PO rules still fell through to the general rules, and a global
emergency change was incorrectly scoped to CHK1. I did not approve that output.
The manual JSON editor API corrected it, produced a fresh diff, and approval
used the new review hash. The prompt now explicitly explains independent
sentence scopes and how lower scoped limits must prevent global fallback.

## Approved demo amendments

| Version | Effective date | Change | Result |
| --- | --- | --- | --- |
| 5.1-groq-demo | 20 Nov 2026 | CHK1 spot below INR 100,000; global emergency at most INR 300,000 | Manual correction validated and approved; 23 PR rows changed |
| 5.2-groq-demo | 21 Nov 2026 | Messy chat: PUN1 spot below INR 150,000; preserve CHK1/emergency/contracts | Groq produced the correct draft without manual correction; 13 further rows changed |

The first amendment changed 22 CHK1 rows from SPOT_PO to RFQ and one CHK1 row
from EMERGENCY_PO to RFQ. The second changed 13 PUN1 rows from SPOT_PO to RFQ.
All 186 rows remain, including the same two NOT_PROCESSED rows.

| Route | v5.0 baseline | First amendment | Second amendment |
| --- | ---: | ---: | ---: |
| CONTRACT_PO | 33 | 33 | 33 |
| SPOT_PO | 72 | 50 | 37 |
| EMERGENCY_PO | 6 | 5 | 5 |
| RFQ | 53 | 76 | 89 |
| RFP | 8 | 8 | 8 |
| CAPEX_SOURCING | 10 | 10 | 10 |
| NEW_ITEM_SOURCING | 2 | 2 | 2 |
| NOT_PROCESSED | 2 | 2 | 2 |

As-of selection was verified: 19 Nov chooses v5.0, 20 Nov chooses the first
amendment, and 21 Nov chooses the second. Both are scheduled relative to today's
16 November date. Reprocessing kept the same batch/run IDs and replaced proposals.
Baseline and amended CSV/JSON evidence remains in ignored kit_data/live_llm/.
The app currently shows the second amended result for the sample batch.

Only the fictional exercise policy and amendment text were sent to Groq. PRs,
master data and the API key are not included in prompts. Review remains required:
JSON-schema validity does not prove a model interpreted policy meaning correctly.
