# Phase 1: kit review and proposed design

Reviewed on 16 November 2026. This is a design checkpoint, not a working app.

## What I read

I read the four-page task brief, three-page policy, five-page worked examples,
all twelve signed contract PDFs, the kit README, and every CSV. The originals,
extracted text, and a machine-readable inspection report stay in ignored
`kit_data/`. Poppler was unavailable, so I used the bundled pypdf layout extractor.

The PDF brief allows a choice of stack. The supplied project specification narrows
that to TypeScript, Express, React, and PostgreSQL, which I will use. Instructions
inside source documents are reference material, not permission to publish a repo,
send a submission, or perform unrelated actions.

## Actual inventory

| Source | Actual count | Important detail |
| --- | ---: | --- |
| Items | 73 | Material, Service, and Capex |
| Suppliers | 48 | 43 Active, 3 Blocked, 2 Inactive |
| PO history | 468 | Not the brief's approximate 525; 1 Jun 2025 to 28 Oct 2026 |
| Plants | 2 | Both are present in the master |
| Contract register | 10 | Snapshot dated 31 Oct 2026 in the kit description |
| Registered contract lines | 26 | All reconcile with their signed PDFs |
| Signed PDFs | 12 | 31 total item-rate lines; two contracts missing from register |
| PR batch | 186 lines / 175 PRs | Created 2–20 Nov 2026; needs extend to 7 Mar 2027 |

## Policy pipeline

1. Validate each input row, retaining its original row number and raw fields.
2. Resolve an explicit item code, or confidently match a description. A genuinely
   unmatched item becomes NEW; an ambiguous match needs confirmation.
3. Sort valid lines by creation time, PR number, numeric PR line, then source row.
   Club against the FIRST line's dates and plant, joining the earliest eligible
   requirement. New items never join another requirement.
4. Process requirements in that order. Find applicable contracts, test the whole
   quantity against each ceiling at its own rate, then choose the lowest usable
   rate. An applicable but exhausted contract still supplies a valuation rate.
5. Otherwise value from the latest item PO within 365 days, then standard price.
   New items use the requester estimate. Track the valuation source separately
   from the supplier/reference price eventually used for a direct PO.
6. Evaluate ordered data rules: Capex; usable contract; eligible Emergency;
   eligible spot purchase; RFQ; RFP. NEW is a preceding policy rule under 1.2.
7. Consume a contract ceiling only for requirements actually routed CONTRACT_PO.
   Carry that simulated consumption forward across the batch, across its items.
8. Calculate date-specific preferred suppliers, retain score components, and
   select or suggest only Active suppliers.
9. Consolidate PO requirements by supplier, plant, route, and time from the FIRST
   requirement, not the most recently added one. Sourcing stays separate.
10. Persist the run, snapshots, reasons, and proposed documents. Buyer approval
    creates actual documents; a preview alone never places an order.

Policy limits are INR excluding GST. Emergency uses <= 500,000; spot uses
< 200,000; RFQ uses < 1,000,000. Exact limits, order, and windows belong in JSON.

## Data findings that affect the implementation

- PR-26-00172/1 has quantity zero. PR-26-00173/1 uses unknown plant PUN2.
  Both need NOT_PROCESSED output rows with reasons.
- There are no duplicate `(pr_no, pr_line)` keys, missing quantities, negative
  quantities, unknown nonempty item codes, explicit-code UOM mismatches, malformed
  PR dates, or need-by dates earlier than creation in this supplied batch.
- Missing estimates occur on 60 rows. That is valid for matched master items;
  both apparent new descriptions have positive estimates.
- There are 39 description-only rows, including case differences, brg/hyd/pneu,
  `monitor 24"`, and filler such as `as per sample`, `(repeat)`, and `- urgent`.
  Model numbers and dimensions must not be lost during normalization.
- `- urgent` also appears on rows whose structured urgency is Normal. The batch
  column is authoritative; prose must not silently upgrade it to Emergency.
- The last two PRs are four minutes apart for the same item, plant, and need-by
  date. They are separate requests to club, not duplicate rows to discard.
- 37 rows are dated after the review date, 16 November. The dataset deliberately
  includes the rest of November: the current machine clock is not a batch cutoff.
- PO history contains 58 rows belonging to currently Blocked/Inactive suppliers.
  Keep the historical evidence but exclude those suppliers from eligibility,
  preferred lists, direct orders, and sourcing suggestions.
- History has no unknown item/supplier/plant IDs, invalid UOMs, repeated PO
  numbers, or nonpositive quantities/prices in this kit.
- RC-2026-005 is with a Blocked supplier and cannot be applicable. This explains
  why an apparently contracted aluminium item can need RFQ.
- RC-2026-002 has only INR 38,000 remaining; RC-2026-015 has INR 12,000.
  Test the full requirement, not each PR line, and share ceilings across items.
- RC-2025-020 is expired at the sample requirement dates. It cannot produce a
  contract PO, but it still contributes contract history to preferred suppliers.
- PDF-only RC-2026-031 starts 15 Nov 2026 (three lines, INR 2,000,000 cap).
  PDF-only RC-2026-033 starts 20 Nov 2026 (two lines, INR 5,000,000 cap).
  They start with zero consumption and must be imported before processing.
- All ten registered PDFs match register supplier, dates, ceiling, item coverage,
  UOM, and rates. No reversed dates or already-exceeded ceilings were found.
  Validation must still cover those cases for future imports.

## Proposed code boundaries

```text
engine/   pure types, policy validation/evaluation, matching, grouping,
          valuation, contract allocation, ranking, consolidation, CSV projection
server/   Express API, PostgreSQL migrations/repository, imports, PDF extraction,
          LLM parsing, chat state, buyer approval, audit, export
web/      React requester chat, batch upload, buyer workspace, procurement screens
scripts/  seed CLI calling the same import service as the admin screen
```

The engine receives explicit data and dates and returns results without DB,
network, filesystem, UI, or wall-clock access. The server owns side effects.
The LLM parses text into validated candidate data; it never evaluates a route.

## Proposed PostgreSQL schema

| Table | Purpose / key constraints |
| --- | --- |
| `imports` | Actor, source names/hashes, snapshot date, validation report; reimport is reviewable |
| `items`, `suppliers`, `plants` | Stable business keys; supplier categories as text array; validated prices/ratings |
| `po_history` | PO/line identity, date, item, supplier, quantity, UOM, price, plant, delivery result, import |
| `contracts` | ID, supplier, validity, cap, baseline consumption and as-of date, source provenance, confirmation status |
| `contract_lines` | Contract + item unique; UOM, exact decimal rate |
| `source_documents` | Filename, MIME, hash, extracted text and PDF bytes in PostgreSQL; no production local disk dependency |
| `policy_versions` | Unique version, effective date, status, JSON document, source text, creator, approval actor/time, superseded-by |
| `chat_sessions`, `chat_messages` | Role/actor, proposed PR fields, confirmation state, message history |
| `batches`, `pr_lines` | Immutable input row identity and raw JSON; validation issues; business key is not the primary key |
| `processing_runs` | Batch, as-of date, policy ID, master-data snapshot, baseline contract state, content hash |
| `requirements`, `requirement_lines` | Group facts, ordered membership, quantities, dates, chosen rule and policy, decision trace |
| `supplier_rankings` | Run/requirement, supplier, rank, reference source, factor values and weighted contributions |
| `purchase_orders`, `purchase_order_lines` | Actual approval-created orders, source requirements, supplier, plant, route, timestamp |
| `sourcing_requests` | Actual approval-created RFQ/RFP/capex/new-item requests, suggestions and flags |
| `buyer_actions`, `audit_events` | Original decision, override comment, actor/time, before/after; append-only through application API |

Use PostgreSQL NUMERIC for money/quantity, timestamps with time zone for instants,
and DATE for business dates. Approval locks affected contract rows and rechecks
ceiling before consuming it. A unique run/requirement action key prevents double
approval. A single policy activation transaction protects version lifecycle.

## Policy document contract

`docs/policy-format.example.json` is the proposed shape, not a deployed policy or
a schema validator. It includes all v5 route rules, parameter references, fact
definitions, route definitions, ranking settings, and matching settings.

The evaluator supports `all`, `any`, `not`, and typed leaves using eq/ne/in/gt/gte/
lt/lte/between. Operands can reference parameters. Rules use explicit numeric
order; duplicate order/ID, unknown facts/parameters/routes, incompatible operand
types, unsafe PO supplier strategies, and missing fallback are validation errors.

Facts come from a small set of engine capabilities: direct item/plant/urgency
fields, computed values, contract eligibility, and parameterized history queries.
A new plant rule or category limit needs only JSON. Arbitrary new algorithms or
new external data sources still need implementation: a registry is not executable
JavaScript, SQL, or a promise that every future fact can be invented at runtime.

Routes use data-defined decision, supplier strategy, suggestion count, and flags.
A new sourcing route can be added as data and displayed generically. Safety
invariants (Active suppliers only, confirmed imports, valid quantities) cannot be
disabled by uploaded text. Unknown LLM output is rejected, never executed.

## Worked-example checks to build in phase 3

Use the whole imported batch: earlier requirements can exhaust shared ceilings.
Assert all 14 scenarios by row membership, route, applicable contract, and exact
decimal valuation. Do not hard-code sample IDs into production code. Derive
expected precise rates from source contracts/history; examples display rounded
rupee prices and totals. Supplier rankings and resulting PO numbers may differ
because the policy explicitly delegates scoring design; assert explainable,
consistent behavior and consolidation membership rather than copying IDs.

Example 14 demonstrates two requirements on one PO: their FIRST lines are
2 Nov 14:05 and 3 Nov 10:30, less than 24 hours apart. Their later member lines
on 8/9 Nov do not change either requirement's original timestamp.

The three preferred-list examples are consistent with the proposed weights in
DECISIONS.md. Also test absent kit data (skip only fixture-backed tests), exact
date/value boundaries, exhausted lower-rate contracts, emergency clubbing,
nonactive suppliers, stable ties, duplicate inputs, and repeat processing.

## Implementation order and open work

Phase 2 will add the monorepo, database migrations, imports, and validated v5.0
seed. Later phases add the engine/API, ranking, policy updates, UI/audit,
contracts, and deployment. No app code, dependencies, database, or hosting has
been created in this checkpoint. No external service credentials are needed for
local design or development. Hosting will need an account and database access
when the deployment is concrete.
