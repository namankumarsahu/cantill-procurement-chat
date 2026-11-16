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
