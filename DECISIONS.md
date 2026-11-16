# Decisions

These are design choices from the kit review. They become implementation promises
only as the corresponding phase is built and tested.

## Dates and policy selection

I use Asia/Kolkata for timestamps without an offset. Calendar-day windows use
local dates; the PO consolidation window uses elapsed hours. Inputs with explicit
offsets retain their instant. Business dates are not parsed through a browser's
local timezone.

A batch uses one approved policy version. Without `policy_version`, select the
latest approved version effective on or before `as_of_date`. Default as-of is
the latest valid PR creation date in the batch, shown explicitly in the UI.
An explicit as-of date is a cutoff: later rows remain in the export as
NOT_PROCESSED. This allows the complete supplied November batch to run even
when the computer date is earlier than its final requests.

An explicitly pinned version supports historical replay, including superseded
versions, provided it was approved and its effective date is no later than as-of.
Drafts cannot drive production processing. Historical rows in an amendment run
use that run's chosen policy, while contract/history facts use each requirement's
creation date. This makes the two blind-test runs directly comparable.

Future-approved versions are scheduled rather than replacing today's effective
version immediately. Retain approval and supersession history so old runs remain
reproducible. Before any approved version exists for a date, return a clear error
instead of silently choosing a future policy.

## Input validation and rows I cannot process

I retain every input row using `(batch_id, source_row_number)`. A PR number can
have several lines. Exact duplicate business keys keep the first row and flag
later identical copies NOT_PROCESSED. Conflicting copies of the same key all
need correction; I do not choose one silently. Repeat file imports do not place
duplicate orders.

Unknown/missing plant, invalid/missing/nonpositive quantity, invalid dates, a
need-by date before creation, unknown explicit item code, and incompatible UOM
produce NOT_PROCESSED with field-specific reasons. I do not convert PUN2 to PUN1,
turn zero into one, or infer a conversion between NOS and PAIR. Past need-by means
before creation, not before today's date; these are historical requests.

A new item needs a positive estimated unit price and a nonempty description.
Existing items do not need requester estimates: policy valuation has other
sources. An unrecognized explicit code needs correction rather than silently
rematching its description. An ambiguous description needs buyer confirmation;
a clearly unmatched description can become NEW. Unknown is not permission to
invent an item master entry.

For rejected rows, retain input identity and any known resolved code; leave group,
PO, supplier, and numeric decision fields empty. Use route NOT_PROCESSED and
decision SOURCING_REQUEST to respect the required two-value decision column.
That value is a reporting convention: no sourcing event is created for rejected
rows. The API exposes processing status separately.

I found two invalid PR rows in this kit: zero quantity and unknown plant. I did
not find duplicates, missing quantity, invalid dates, UOM mismatches, or unknown
nonempty codes. These still need future-input tests. Free-text suffix `urgent`
does not override Normal in the batch urgency column. Chat asks the requester
to confirm urgency rather than assuming Emergency from that word alone.

## Item matching

Explicit valid codes win. Otherwise normalize case, punctuation, model separators,
dimension separators, common abbreviations, and harmless request filler. Keep
numeric/model tokens: a bearing 6308 is not a 6205. Score normalized token and
character similarity with a configurable minimum score and winner margin.
Mismatched critical specifications prevent an automatic match. Borderline
results show candidates; the LLM cannot force a match or manufacture a code.

## Clubbing and ordering

Sort by timestamp, lexical PR number, numeric PR line, and original source row.
The final tie breaker prevents sort-engine differences. Compare creation dates
to the first line's date with inclusive 14 calendar days, and absolute need-by
date distance to the first line with inclusive 7 days. Both checks are against
the anchor, never the latest member. Same item and same plant are mandatory.
If several groups qualify, use the earliest by this same ordering. New items
always have separate requirements. Any structured Emergency member makes the
whole group Emergency.

## Valuation and ceilings

Use exact decimal arithmetic; PostgreSQL stores NUMERIC and engine money uses
decimal-safe arithmetic. Keep precision through quantity multiplication and round
monetary amounts half-up to two decimal places at the requirement boundary.
Do not round to whole rupees before comparing a limit. CSV rates/totals preserve
paisa; the worked examples use rounded display values.

An applicable contract needs a matching item/UOM, inclusive valid dates, and an
Active supplier. Check the whole group quantity at each candidate's own rate.
Choose the cheapest candidate with sufficient ceiling; tie by contract ID, then
supplier ID. If all applicable contracts lack ceiling, use the lowest applicable
rate for valuation but continue through the sourcing/spot/emergency rules.

No Emergency exception overrides a contract ceiling. Emergency can still win
its own rule after a contract is unusable, if all emergency conditions hold.
Capex precedes contracts and does not reserve contract consumption. Increment
the batch's simulated ceiling only for actual CONTRACT_PO outcomes.

The latest PO used for valuation is item-wide, regardless of plant or present
supplier status: clause 3.1 does not restrict it. Historical purchases from a
nonactive supplier cannot establish active-supplier eligibility or put that
supplier on a PO or suggestion list. A price observation is not permission to
purchase from its source.

History windows include the day at the lower bound and exclude requirement day:
`requirement_date - N <= po_date < requirement_date`. Dates in history do not
have time-of-day, so including same-day entries could leak a later purchase.
Equal-date latest-PO ties use PO number descending with a stable row-ID fallback.
Contract reference-price ties use most recent start, then contract ID.

Requirement valuation and PO ordering price are separate. For spot/emergency,
policy 3.1 supplies the value used to choose the route, while 5.3/5.4 supplies the
top preferred supplier's reference price for the PO. Record both sources; never
silently recompute the route because the selected supplier has a different rate.

All registered signed PDFs reconcile in this kit. A future conflicting PDF import
must show the discrepancy and require confirmation before using changed terms;
retain both sources in the audit trail. Invalid date ranges or negative values
quarantine the contract. Baseline consumption above cap is an explicit warning
and makes it unusable, not a reason to erase its valuation/history evidence.

Use the register's 31 October snapshot, not reconstructed PO totals, as baseline.
The two later PDF-only contracts start with zero consumed. Refuse historical
ceiling reconstruction before the baseline date unless a matching earlier
snapshot is supplied. Do not subtract the history again from registered totals.

Simulation and approval are separate. Each replay starts from its recorded
baseline and does not consume live ceilings. Actual approval transactionally
rechecks the contract using its current approved consumption and locks it;
otherwise require reprocessing. Preserve completed run inputs/results to avoid
changing yesterday's answer after a new import.

## Preferred suppliers

Eligibility is Active status plus at least one item PO within 548 days, or an
item contract whose start is on/before the requirement date. An expired contract
still counts; a future contract does not. Supplier status/ratings are the imported
snapshot because the kit contains no historical status changes. Say so in traces.

My score is a weighted sum of five normalized factors:

| Factor | Normalization | Weight |
| --- | --- | ---: |
| Frequency | Supplier item-PO count / highest eligible count; zero when no POs | 30% |
| Recency | 1 within 90 days, 0.5 within 365 days, otherwise 0 | 30% |
| Contract history | 1 if an item contract has started, otherwise 0 | 20% |
| On-time delivery | Supplier master percentage / 100 | 10% |
| Quality | Supplier master rating / 5 | 10% |

Weights, history windows, recency bands, and normalization scales live in policy
JSON. This favors proven item-specific relationships while still considering
service quality. Use supplier-master on-time percentage consistently; the
individual delivery booleans remain evidence, not a competing second metric.
Break equal unrounded scores by supplier ID ascending. Display each raw factor,
normalized factor, weighted contribution, total, and reference-price source.

For the glove example as of 1 November, the first eligible supplier has 7 POs,
recent history, a contract, 81% on-time, and quality 3.1/5. Its contributions are
30 + 30 + 20 + 8.1 + 6.2 = 94.3 out of 100. The next has 4 POs, recent history,
no contract, 72% on-time, and 3.4/5: 17.142857 + 30 + 0 + 7.2 + 6.8 = 61.142857.
The inactive supplier is excluded. The same formula also gives the three
published cylinder suppliers in order and the two MIG-wire suppliers in order.

Reference price uses the supplier's latest item PO in 548 days, else its most
recent started item contract, including expired ones. Sourcing takes preferred
suppliers first, then unused Active category suppliers ordered by on-time
descending, quality descending, ID ascending. If fewer suppliers exist than
requested, return all eligible ones with a shortage flag; never fill with blocked
or unrelated suppliers. NEW items get no suggestions.

## PO consolidation and buyer actions

Same supplier, same plant, same route, within inclusive 24 elapsed hours of the
first requirement's creation instant. The first requirement's timestamp never
moves. Always join the earliest eligible PO, and never combine sourcing requests.
Stable proposal IDs are scoped to a run; persisted approved documents use unique
database identities. A replay can have the same proposal labels without creating
duplicate actual orders.

Buyer approval materializes the proposal. Override requires a nonempty comment
and preserves original and changed values. Override cannot bypass Active-supplier
checks or invalid quantities/plant. Any change to supplier, route, or quantity
requires revalidation and reconsolidation before approval. Record actor, role,
timestamp, before/after, and source run. The simple role switch is demo identity,
not production authentication.

## Policy updates and unknown rules

Uploaded documents and chat changes generate drafts only. Validate against a
small typed condition language and known fact providers; never eval source text.
Reject unsupported semantics with an actionable error and manual JSON editing.
Show parameter, condition, order, outcome, and effective-date differences before
approval. A plain-language diff is derived from validated JSON, not an LLM's
claim that it made a change. No-key mode supports manual JSON updates.
