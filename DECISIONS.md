# Decisions

These are the implemented choices for imports, chat, the engine, supplier lists,
policy/contract review, buyer approval and exports. The hosted acceptance pass is
pending the deployment URL; older phase reports record historical checkpoints.

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
PO, supplier, and numeric decision fields empty. CSV rows with route NOT_PROCESSED
have empty decision, supplier_id, unit_price, po_id and suggested_supplier_ids,
while retaining any known resolved item code, policy version and rejection reason.
The CSV formatter also clears these fields on previously saved runs; internal JSON
may retain the legacy SOURCING_REQUEST reporting value, but rejected rows never
become requirements or create sourcing events.

I found two invalid PR rows in this kit: zero quantity and unknown plant. I did
not find duplicates, missing quantity, invalid dates, UOM mismatches, or unknown
nonempty codes. Synthetic regression tests cover those absent anomalies. Free-text suffix `urgent`
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
Do not round to whole rupees before comparing a limit. Internal decisions, saved
runs, and JSON API values keep paisa. Only the CSV group_value_inr column rounds
to the nearest whole rupee using decimal half-up rounding: .50 rounds up (for
example, 32,546.60 becomes 32,547 and 100.49 becomes 100). Empty values on rejected
rows stay empty. Unit prices keep their precision. CSV formatting never changes
the values used for route limits, contract ceilings, or audit evidence.

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
Equal-date latest-PO ties use PO number descending; PO numbers are unique per import.
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
otherwise require reprocessing. Preserve prior run inputs/results in the audit log; reprocessing explicitly
replaces the current result while retaining its old policy and result as evidence.

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
suppliers first, then unused Active category suppliers ordered
by the same weighted on-time and quality contributions used in the main score.
Break equal performance scores by on-time descending, quality descending, then
ID ascending. This uses both performance factors for top-up, consistently with
the worked examples. No item- or supplier-specific exceptions are used. If fewer suppliers exist than
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
checks or invalid quantities/plant. Supplier/route/rate changes are revalidated
and reconsolidated before approval. This override form cannot edit quantity or
plant: correct the CSV and reprocess an unapproved batch instead. Record actor, role,
timestamp, before/after, and source run. The simple role switch is demo identity,
not production authentication.

## Policy updates and unknown rules

Uploaded documents and chat changes generate drafts only. Validate against a
small typed condition language and known fact providers; never eval source text.
Reject unsupported semantics with an actionable error and manual JSON editing.
Show parameter, condition, order, outcome, and effective-date differences before
approval. A plain-language diff is derived from validated JSON, not an LLM's
claim that it made a change. No-key mode supports manual JSON updates.


## Export and verification

CSV columns use the exact required order. Formula-like text is prefixed with an
apostrophe by csv-stringify for spreadsheet safety; the JSON API retains original
values. Rejected rows create no PO or sourcing record. All outputs are proposals
until explicit buyer approval. Processing is repeatable and does not update
contract consumption in master data.

The fourteen worked scenarios match routes, exact source-data money, suppliers,
ordered suggestions, and illustrated grouping/consolidation relationships. The
PDF displays whole rupees; internal tests preserve paisa, and CSV group values
use the whole-rupee half-up rounding rule above. PO identifiers are run-
scoped labels, not answer-key constants. The sample has an eligible early servo
requirement at 08:10, so the oil example at 09:40 is PO-0002 here rather than the
PDF's PO-0001. Tests assert stable numbering and real consolidation membership.


## Phase-5 policy approval and future facts

The LLM returns an array of add/replace/remove data edits, plus any unresolved
questions. A strict JSON Schema constrains that envelope, and the full resulting
policy passes the engine schema and semantic validation before saving. JSON
pointer paths are limited to policy behavior sections; metadata, prototype paths,
JavaScript, SQL, and unknown fact sources cannot be supplied as executable edits.
If anything is unresolved, no draft is guessed and no active policy changes.

The manual editor uses exactly the same policy validation. Creator, approval,
version and effective-date metadata are server-owned. The reviewer sees each
parameter and rule change with before/after conditions, rule order, route, and
registry/config changes. Approval checks a content hash and the base version
inside a transaction; editing or changing that base invalidates prior approval.
All approval and status changes record actor, time, and before/after values.

Approved future versions are scheduled. The active version for any as-of date
is derived from approved effective dates, with approval timestamp and version as
deterministic tie breakers. No timer or browser session is required to make a
version effective. Older versions remain approved historical replay candidates.
Stored active status also represents an approved future version; the API exposes
its date-aware lifecycle as scheduled until it becomes effective.

A new named fact can bind to an existing safe source without code changes. The
capability catalog includes quantity, line count, date, first-line department and
requester, item UOM/description/standard price, existing requirement facts, and
parameterized active-supplier purchase existence. Quantity is the full clubbed
quantity; department/requester come from the group's first line. The v5 policy
does not declare quantity, but the fourth amendment adds total_quantity and a
new BULK_REVIEW route entirely as JSON. New condition trees use the existing
all/any/not and typed operators. A genuinely new algorithm or external fact source
is rejected for clarification; a JSON registry cannot invent data the app lacks.

Reprocessing uses a hash of canonical parsed input rows, excluding filename and
actor. The same content has one current run even if policy/date/master snapshot
changes. Requests lock that batch, preserve the previous result/policy in audit,
and replace current PO proposals. No live contract consumption or actual order
records are created by processing. Legacy duplicate uploads are linked to one
canonical batch; earlier legacy runs are retained as non-current history.


## Impact previews and feedback hardening

Before approval, simulate the latest current batch under both its saved approved
policy and the candidate draft, using the same raw input/master snapshot and
comparison date. If the draft is future-effective, advance both comparisons to
that date so cutoff differences are not mistaken for policy differences. The
UI shows original and comparison dates. Draft simulation is an explicit engine
preview mode; process-batch still refuses unapproved drafts.

Changed rows include routing, supplier, rate, exact value, suggestions, and actual
clubbing/PO membership changes. Stable membership is compared rather than opaque
IDs, so shifting PO numbers does not create spurious impact counts. Unchanged
routes with other decision changes appear as same-route transitions. Metadata,
policy-version stamps, and reason text alone do not count as decision changes.

A stored preview binds the draft review hash to the current run, policy snapshot
and results. Approval rejects missing or stale previews, and batch replacement
serializes with preview/approval. If there is no current batch, the reviewer must
explicitly acknowledge that impact cannot be measured. A zero-change warning is
not an automatic rejection: some valid amendments may affect no rows in a batch.

Regeneration preserves the original source, passes cumulative reviewer feedback
and the current draft to the model, and replaces the draft only after schema and
restatement validation. Feedback is repeated in the final user message to avoid
the original text overriding corrections. Changes during an in-flight request
cause rejection instead of overwriting newer work. Manual edits clear model
restatements so stale explanations cannot be shown for changed JSON.

Temperature 0, a constant v5.0 reference, and three illustrative text/JSON pairs
reduce model variability. They do not guarantee byte-identical hosted-model
responses or correct interpretation. Examples are prompt data, never active
procurement rules. Every new rule must have a unique, nonempty, single-line model
restatement, shown beside the engine-derived diff and impact.

The reset script is explicitly for a demo database. It previews by default and
requires --confirm-reset for deletion. It deletes non-v5.0 policies and all runs/
impact previews, restores the hand-authored v5.0 seed, and retains master data, raw
batches, source evidence and prior audit history. It appends a reset audit event
and refuses production mode unless ALLOW_DEMO_RESET=true explicitly permits a
disposable demo reset. The authenticated remote reset endpoint additionally
requires ADMIN_TOKEN and the enable flag for preview and confirmation. A local
acceptance reset was executed after a dry run, preserving master/audit evidence.

## Requester and buyer workflow

Chat never receives authority to invent catalog entries: only deterministic
matching or an explicit existing code can resolve an item. Low-confidence item
families ask for a specification; genuinely unknown descriptions become NEW.
The requester's estimated price and UOM are required for NEW, with no supplier
suggestions and no automatic master creation. Urgent wording does not silently
choose Emergency. Confirmation creates a PR and runs the same engine as CSV.

Approvals are durable procurement documents, separate from engine proposals.
A consolidated PO is approved as a whole. Replays return the same document;
approved batches cannot be replaced with different results. Reprocessing an
unapproved batch clears overrides and records them in its before audit snapshot.
Buyer exceptions can change routing with a mandatory comment, but cannot bypass
active-supplier checks, signed contract terms or ceilings, or turn NEW into a PO.
The group value remains the policy's valuation; the order's negotiated unit
price is shown separately. Contract allocations are recorded transactionally
across approved runs, on top of imported opening consumption. Imports should
exclude these local allocations from their opening balance to avoid counting
them twice; this conservatively blocks an order if such a balance is uncertain.

Roles and actor names are explicit demo UI inputs, not authenticated identities.
Audit records persist before/after values and role where available. Remote
buyer changes use the existing admin-token control. Demo reset also removes
approval documents and allocations so runs can be deleted consistently.

## Contract register and PDF review

Contract extraction is a draft, never authority to activate terms. Parse the
known signed-PDF format deterministically first; use a strict nullable LLM
extractor only for readable text that this parser cannot interpret. Empty/scanned
PDFs go straight to manual entry, without asking a model to invent unseen terms.
Every field remains editable and requires buyer acknowledgement and a review
comment. Reconciliation lists actual signed-field differences against the stored
master, including full item/rate/UOM coverage; decimal formatting alone is not a
discrepancy. Opening consumption is not printed as a signed ceiling and cannot
be inferred from it. Retain the existing balance when editing; require a stated
balance/date for new older contracts. A new contract starting after the imported
snapshot may propose zero at start, still subject to confirmation.

Contract confirmation copies master data and evidence into a new immutable
import snapshot so historical run evidence remains reproducible. It refuses
stale drafts when another master update has already become current. Identical
confirmation replay does not create another import. Both manual and extracted
contracts use the engine's existing contract selection; no routing thresholds
or windows are added to the UI or extractor. Historical expired/nonactive
contracts remain visible and unusable, rather than being deleted.

Chat separates a stated quantity/UOM (for example “50 pcs”) from the description
before matching, so quantities cannot masquerade as item model numbers. Generic
requests such as “something for the machine” ask for the item name/specification;
named unknown items ask for a price estimate first. A word-only catalog code in
an ordinary sentence requires an explicit item/code label to avoid treating “I”
as a code; an isolated code remains a valid selection. No matching threshold or
procurement parameter changed for these acceptance fixes.

## Packaging, exports and hosting

Compose runs PostgreSQL and a single compiled Node service that serves both API
and React assets. Database state uses a named volume; hosted state, raw batches,
source PDFs and audit live in Neon rather than ephemeral local disk. Startup
applies transactional/idempotent migrations and seeds only the policy. Hosted
master data is supplied through the token-protected import screen.

The filename prefix and run1/run2 label change Content-Disposition only, never
the decision schema or selected policy. Prefixes allow 1-60 letters, digits,
underscores or hyphens, beginning with a letter/digit; paths, dots and header
control characters are rejected. A download serves the run's current results,
so save the baseline before replacement. Policy stamps/reasons and sequential
proposal PO IDs can change across versions; compare actual decisions and PO
membership before calling a blind-test difference a business change.

Production startup requires an admin token. Remote import, policy changes,
buyer/contract changes and reset are token-protected; reset also needs explicit
demo enablement and a confirm_reset boolean. Read-only, requester and batch
processing flows remain public demo functions. A role switch records identity
claims but does not establish authenticated user identity. Health checks run a
database query and return no connection secrets. Hosted TLS uses verified server
certificates; there is no certificate-validation bypass.
