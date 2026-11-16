# Approach

I am using Codex as a coding assistant. I will review and keep the code small
enough to explain in an interview. The exact model identifier is not exposed in
this workspace, so I am not claiming a particular GPT model version.

For phase 1, I used Python's standard CSV, JSON, Decimal, datetime, and ZIP tools
to inspect all rows, and bundled pypdf layout extraction to read all 15 PDFs.
Poppler's pdftotext was not installed. Extracted text and the inspection report
remain in ignored kit_data. No source datasets or signed PDFs are committed.

No runtime LLM provider is connected yet. The planned integration accepts an
OpenAI-compatible base URL, model, and key through environment variables. It
will parse chat and policy text into validated JSON. The deterministic engine
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
