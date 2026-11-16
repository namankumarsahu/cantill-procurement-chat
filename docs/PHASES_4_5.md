# Phases 4 and 5

Phase 4 commit: 2043109. Dated per-item preferred suppliers, visible factor
contributions/reference evidence, policy-configured weights and windows, and
exact-column top-three CSV export are implemented. The live sample provides
73 item lists and 155 CSV supplier rows as of 1 November 2026.

Phase 5 adds PDF/text/chat-source drafting through an optional LLM, full schema
validation, persistent drafts, deterministic before/after diff, manual JSON
editing, content-bound approval, and effective-date version selection. Source
documents and audit evidence stay in PostgreSQL.

## Fake amendment results

| Amendment | Before | After approval/effective date | Result |
| --- | --- | --- | --- |
| Raise spot limit | RFQ | SPOT_PO | PASS |
| CHK1-only lower spot limit | SPOT_PO | RFQ at CHK1; other plant unchanged | PASS |
| Parts category lower spot limit | SPOT_PO | RFQ for Parts; other category unchanged | PASS |
| New total_quantity fact + BULK_REVIEW route | SPOT_PO | BULK_REVIEW | PASS |

Tests exercise draft creation through a fake LLM parser, PDF/text extraction,
plain-language changes, approval, not-effective-yet rejection/selection, and
processing under both versions. They also cover manual editing without a key,
stale content hashes, changed bases, immutable approvals, unknown fact sources,
unsafe edit paths, provider errors and concurrent repeat processing.

Reprocessing identical CSV content keeps its batch and current run IDs, replaces
proposals atomically, and retains the old full result in the audit log. The live
186-line sample was reprocessed twice with stable IDs and 82 PO proposals, with
all fourteen worked scenarios still passing. No actual orders are created yet.

## How to use

Run the app using README.md. Select Preferred suppliers, Policy updates, or
Process batch in the workspace navigation. Use the acting-user/admin-access
section for audit identity and remote admin tokens. Policy updates support a
manual JSON editor immediately. Configure LLM_BASE_URL, LLM_MODEL and LLM_API_KEY
to enable provider-based drafting. Batch controls expose as-of and policy version.

## Limits and remaining work

No live LLM provider was connected; provider responses were mocked in tests.
Strict JSON schema mode is default, with explicitly configured JSON mode for
compatible endpoints that lack schema support; local validation always applies.
Unknown algorithms/data sources are rejected rather than guessed. New rules,
routes, limits, conditions and named facts using the safe catalog need JSON only.

Requester intake chat, buyer approval/override and full audit UI, manual contract
conflict resolution, Docker and public hosting remain later phases. Stop here
after the phase-five commit.

Subsequent live Groq verification is documented in [LIVE_LLM_CHECK.md](LIVE_LLM_CHECK.md).
