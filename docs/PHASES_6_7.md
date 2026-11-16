# Phases 6 and 7

## Phase 6

Start in Request an item as Requester. Chat collects description, quantity,
plant, need-by date and explicit Normal/Emergency urgency, then asks for final
confirmation. Existing item codes and descriptions are matched in code against
the immutable master snapshot. The LLM extracts nullable fields from text only;
it cannot select items, suppliers or routes. Vague families such as “the red
bolts” offer actual candidates and ask for a specification. Unknown descriptions
become NEW and require a buyer-provided estimate and UOM. No key or provider
failure uses local parsing, including ISO dates, tomorrow and next weekday.

Upload batch retains CSV import, as-of date, policy choice and decision export.
Buyer workspace shows PR lines, route, exact group value, supplier/rate or
suggestions, clause, version, contract, history POs, valuation source and ranking
factors. Choose Buyer or Procurement to approve. Approval of a PO creates one
document for every pending requirement in its consolidated proposal; RFQ/RFP
and other sourcing decisions create sourcing records. The server rechecks active
suppliers and signed contract terms, and serializes consumption across runs.
Repeated approval returns the same document. Export includes approved PO numbers.

Overrides require a comment and retain the original decision and evidence. Audit
log shows actor, role, timestamp and before/after snapshots. Role selection and
acting-user session ownership are demo controls, not production authentication;
remote mutations retain the admin-token guard.

Tests cover vague descriptions, missing fields, NEW valuation, provider/no-key
fallback, chat confirmation/replay/ownership, consolidated approval, sourcing,
mandatory override comments, blocked suppliers, exports, audit and cross-run
contract ceilings. Existing worked examples remain regression tests.

## Phase 7

Contracts shows the register origin, term dates and chosen-date validity,
supplier status, signed ceiling, opening consumption and local approval ledger.
All source PDFs are retained in PostgreSQL and can be opened from the screen.
Reconciliation compares supplier, dates, ceiling and all item/UOM/rate lines,
using exact decimals. The supplied kit has 12 matches: 10 register contracts and
PDF-only RC-2026-031 and RC-2026-033. Those two were already included in the
confirmed kit import; the screen makes their origin visible.

Upload a PDF, prepare from a stored PDF, or choose Prepare manual contract.
The kit-format deterministic parser runs first. Readable irregular PDFs may use
the configured strict LLM extractor; provider failures, missing keys, and unreadable
PDFs retain a manual field editor. Scanned PDFs need manual transcription; OCR
is not implemented. No extraction activates a contract. The buyer reviews all
header fields and item rates, supplies opening consumption/baseline if unknown,
checks the review acknowledgement and supplies a comment before confirming.

Confirmation is transactional and creates a new immutable master snapshot,
including the same master data and original PDFs. It audits old/new contract,
actor/role, method, source hash and comment. Existing runs keep their original
master snapshot. A stale draft cannot overwrite newer imports; repeated
confirmation returns its already-saved snapshot. Unknown item/supplier, incorrect
UOM, duplicate item lines, invalid dates and nonpositive rates/caps are rejected.
Blocked suppliers and expired contracts can be retained as evidence; the engine
continues excluding them from applicability.

Verification includes deterministic-first extraction, strict LLM fallback,
no-key/manual completion, opening balance rules, mismatches, PDF-only discovery,
reference checks, immutable snapshots, stale draft protection, idempotence,
document download, audit, and regression comparison of all 12 actual kit PDFs.

Final verification: 67 tests passed, zero failed/skipped; typecheck and production
build passed. Browser checks used the configured live Groq chat parser to clarify
“the red bolts”, then confirmed the summary's real item, quantity, plant, date
and urgency. Buyer workspace showed the saved sample batch and its evidence.
Contracts showed 10 register + 2 PDF-only contracts, all 12 matching; preparing
RC-2026-031 used deterministic extraction and left confirmation disabled until
review. One unconfirmed contract draft remains in the local demo; no signed
terms or sample-batch approvals were changed by these browser checks. Confirmation
and PO/RFQ creation were tested in disposable database schemas.
