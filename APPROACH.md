# Approach

Coding assistance: **Codex GPT-6.1 Sol/Terra**. I use the coding assistant for
implementation, tests, debugging and documentation, and keep the choices small
enough to explain in Round 2. This coding tooling is separate from the model
called by the running procurement app.

## Inside the app

Groq supplies an OpenAI-compatible chat-completions endpoint. Local acceptance
used openai/gpt-oss-120b, with the key stored only in ignored .env. The server takes
the endpoint/model/key from environment variables; no key reaches the web bundle.

The LLM extracts explicitly stated requester fields into a strict nullable JSON
schema. Item resolution is deterministic against the imported catalog. A vague
description asks a question; an actual unknown description becomes NEW and needs
an estimate. The model cannot output an authoritative item code, select a
supplier, choose a route, approve an order, or create a catalog entry.

For amendments, the LLM returns schema-checked JSON edit operations and one-line
rule restatements. Temperature is zero, and the prompt includes the stored v5.0
reference, current approved base, and three example amendments. Feedback generates
a complete replacement edit set. Zod validates the result; the UI's plain-language
diff comes from the validated policy, not from the model's claim. A deterministic
impact run and explicit approval are required before a version can become effective.
Hosted output is still best-effort, so temperature zero is not a correctness proof.

For contracts, try deterministic PDF text/field parsing first. An irregular readable
PDF can use LLM fallback. Unreadable/scanned PDFs need manual transcription, with
no invented extraction. Every field and opening balance needs buyer confirmation.

The LLM never evaluates PR routes or executes source text as code/SQL. Limits,
windows, fact/route registries, rule order and ranking weights are policy data.
Unsupported conditions need validation/manual resolution, not model improvisation.
No-key or provider-failure mode retains local intake parsing and manual policy/
contract editing. Decisions, ranking and exports never need an LLM call.

## Implementation and verification

The engine is a pure TypeScript library: policy + immutable master snapshot + PR
lines yields deterministic requirements, decisions and PO proposals. Express owns
transactions, policy selection, import snapshots, actual approvals and audit.
React uses the same endpoints as batch clients. All persistent data, including
PDF bytes and raw PR lines, lives in PostgreSQL. Hosted runtime never reads kit_data.

Zod validates trust boundaries, decimal.js handles money, node-postgres handles
transactions, csv-parse/stringify preserves CSV structure and escapes formulas,
fflate imports ZIPs, and pdf-parse extracts document text. The Node test runner
through tsx checks engine behavior and HTTP/PostgreSQL workflows. Production Docker
compiles TypeScript and serves web/API from one unprivileged Node process.

I read all kit PDFs/data before implementing the policy. Initial inspection used
Python CSV/Decimal/ZIP helpers and pypdf because pdftotext was unavailable. Runtime
imports use the TypeScript implementation. Source data and extracted text stay
out of Git and container images.

Tests cover all 14 supplied worked examples, clubbing/ceilings/date/rounding
boundaries, supplier ranking, data anomalies, API/exports, chat follow-ups and
degraded mode, approvals/overrides/audit, contract review, and fake amendments
changing limits, plant/category scope and a newly registered quantity fact.
The live local acceptance pass reset the demo, processed v5.0, uploaded a Groq
amendment, reviewed impact, approved, reprocessed, and compared both saved CSVs.
It found/fixed chat shorthand and vagueness issues and verified no unexpected
amendment business changes. See docs/ACCEPTANCE_CHECK.md and docs/PHASE_8.md.

Docker was checked using an isolated local database volume. The local network's
TLS proxy required existing public CA certificates as a temporary BuildKit secret;
TLS verification stayed enabled, and the CA bundle was not copied into the image.
Deployment instructions were checked against official Render and Neon docs.
Cloud accounts/resources are created by the user by hand; deployed acceptance
checks remain pending the live URL, with no claim of public deployment yet.

## Limits I would explain

This is a demo with explicit roles/actor names and one shared admin mutation token,
not full user authentication. Supplier status/ratings are snapshot data because
the kit has no historical status timeline. Scans have no OCR. Free hosting can
sleep, and hosted LLM parsing can fail; manual fallbacks are part of the workflow.
The safe fact registry cannot express arbitrary new external data sources without
a provider implementation. Real rollout would also need authenticated identities
and operational controls beyond this take-home's scope.
