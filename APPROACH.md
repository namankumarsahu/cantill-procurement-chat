# Approach

I am using Codex as a coding assistant. I will review and keep the code small
enough to explain in an interview. The exact model identifier is not exposed in
this workspace, so I am not claiming a particular GPT model version.

For phase 1, I used Python's standard CSV, JSON, Decimal, datetime, and ZIP tools
to inspect all rows, and bundled pypdf layout extraction to read all 15 PDFs.
Poppler's pdftotext was not installed. Extracted text and the inspection report
remain in ignored kit_data. No source datasets or signed PDFs are committed.

Groq is now connected locally for policy drafting. The implemented integration accepts an
OpenAI-compatible base URL, model, and key through environment variables. It
parses policy text into validated edits and a full policy draft. Requester chat
parsing remains a later phase. The deterministic engine
will make procurement decisions. With no API key, deterministic intake and
manual policy JSON editing must remain available.

Phase 2 uses Express, React/Vite, node-postgres, Zod for boundary validation,
csv-parse/stringify for CSV handling, decimal.js for exact arithmetic, fflate
for in-memory ZIP imports, and pdf-parse for deterministic PDF text extraction.
Tests use Node's built-in test runner through tsx. Package versions are locked.
No runtime LLM is needed for imports or decisions.

I checked the official Express installation guidance and node-postgres
transaction documentation when setting up the backend. All transaction queries
use the same checked-out connection. I tested imports against the supplied kit
and database behavior against an isolated local PostgreSQL 18 cluster.

No third-party accounts, external messaging, public repo, or hosting deployment
have been created.


Phase 3 uses a pure TypeScript engine: it takes policy, master data and PR lines
and returns proposals without HTTP, database, filesystem or wall-clock access.
The server parses CSV, selects the effective approved policy, loads an immutable
import snapshot, then saves the run and audit event in one PostgreSQL transaction.

I verified the full kit through POST /api/process-batch and its CSV export, in
addition to synthetic boundary tests and the fourteen worked scenarios. Ranking
uses the documented weights consistently; category top-up uses the delivery and
quality components together. No sample PR, item or supplier identifiers occur
in engine source. Fixture references exist only in tests.


Phases 4/5 reuse the ranking engine for dated lists and exports. The policy parser
uses fetch against an OpenAI-compatible chat-completions endpoint with a strict
edit-envelope schema; all edited policies are validated locally. I consulted the
official structured-output documentation:
[Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)

I tested four fake amendments through real HTTP/PostgreSQL draft/approval and
reprocessing endpoints using a fake parser. The actual provider adapter is tested
with mocked HTTP responses (strict output, bad JSON, provider failure, no key).
At the phase-five commit, no live LLM call had been made; the later live check
is documented below. I smoke-checked the supplier
score breakdown and manual JSON fallback in the local browser.


A live check on 16 November used Groq openai/gpt-oss-120b with the user's key
stored only in ignored .env. I tested a plain-text upload and a messy chat-style
amendment. The first required manual semantic correction; the second produced
a correct draft after tightening the scope/fallback instructions. Both were
reviewed, approved and reprocessed. See docs/LIVE_LLM_CHECK.md. Earlier phase-five
notes describe the state before this live check.


For amendment hardening, I added impact simulation without saving proposals,
preview-bound approval, temperature-zero example prompting, rule restatements,
feedback regeneration and a dry-run-first demo reset. Automated tests use isolated
PostgreSQL schemas. A live Groq regeneration test also ran in a disposable schema:
the ineffective draft had zero route changes; CHK1 feedback produced the expected
one-row SPOT_PO-to-RFQ transition, with the other plant unchanged. Saved run data
was unchanged and the temporary schema was removed. No live reset was executed.

Groq documents determinism as best-effort:
[API reference](https://console.groq.com/docs/api-reference).
