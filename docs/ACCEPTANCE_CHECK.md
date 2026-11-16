# Local acceptance check

Executed against the running app on 16 November 2026. Production build and all
68 regression tests pass (zero failures or skips), including the 14 worked
examples. No phase 8 deployment work has started.

| Check | Result |
| --- | --- |
| Nitrile gloves, Chakan, next Friday | Clarifies the catalog specification, asks for urgency, then confirms 200 PAIR of ITM-1048 for CHK1 on 20 November. PAIR is the master UOM. |
| brg 6205 2rs, 50 pcs | Resolves ITM-1021, quantity 50, asks for plant, then date and urgency before confirmation. |
| Titanium flange | NEW; asks for estimated unit price before other missing fields. |
| Something for the machine | Asks for the item's name/model/specification; does not resolve an item or mark it NEW. |
| No Groq key | Blanked LLM_API_KEY in .env, restarted, and repeated all four cases successfully in degraded mode. Restored the original .env bytes and restarted; LLM configuration is enabled again. |
| Contract why | PR-26-00019 shows clause 5.2, policy version and RC-2025-011. |
| Exhausted ceiling | PR-26-00004/00026 has no PO, shows insufficient ceiling on RC-2026-002 and suggestions S014, S013, S016. |
| Approve / override / audit | Created local PO-000001; rejected an empty override comment with HTTP 400; saved an RFQ-to-RFP override with a comment. Both audit events contain actor, role, timestamp, before and after. |
| Contracts | All 12 reconcile; RC-2026-031 and RC-2026-033 are flagged pdf_only. |
| Reset | Ran npm run reset:demo first, reviewed the plan, then -- --confirm-reset. Removed two prior demo amendments, two runs and test approvals. Master data and audit history remain. |
| Run 1 | Processed all 186 rows under v5.0 as of 21 November; saved CSV before reprocessing. |
| Amendment | Uploaded fake-amendment.txt through the real Groq adapter. Diff adds only a CHK1 spot-limit parameter (100000) and a scoped RFQ restriction after Emergency/before Spot. |
| Impact / approve / run 2 | Preview: 22 SPOT_PO → RFQ lines, plus one PO membership change. Reviewed and approved the draft; reprocessing replaced the same run ID. |
| Preferred suppliers | Downloaded four-column CSV: 155 rows for 68 items with eligible preferred history, at most three per item, all suppliers Active. Five master items have no eligible preferred suppliers. |
| Decision headers | Both exports exactly match the brief's 13 columns and retain 186 rows. |

## Issues found and fixed first

Chat originally kept “50 pcs” in the bearing description, so 50 became an item
model token and prevented a confident match. Local parsing now separates stated
quantities from item specifications. The shared deterministic matcher is unchanged.
Generic descriptions such as “something” now ask what the item is. Named unknown
items ask for an estimated price first. Bare alphabetic catalog codes in ordinary
sentences require an explicit code label; an isolated code still selects that item.
These cases have a permanent regression test.

The nitrile phrase conservatively asks the requester to confirm the one candidate,
“Nitrile coated gloves,” rather than lowering the policy's matching threshold.

## Export comparison

Run 1 routes: CONTRACT_PO 33, SPOT_PO 72, EMERGENCY_PO 6, RFQ 53, RFP 8,
CAPEX_SOURCING 10, NEW_ITEM_SOURCING 2, NOT_PROCESSED 2.

Run 2 changes exactly 22 predicted CHK1 lines from SPOT_PO to RFQ, so SPOT_PO
becomes 50 and RFQ 75. Every other route count is unchanged. PR-26-00062 remains
SPOT_PO, but its previous consolidated partner PR-26-00002 becomes RFQ; this is
the impact preview's 23rd changed row. No unexpected business changes occurred.

A raw text diff also shows policy_version on all 186 rows, reason text on 184,
and proposal po_id on 109 rows. Sequential proposal IDs renumber when POs disappear;
the comparison checks actual PO membership, not only those labels. Item resolution,
group IDs and group values remain identical on every row. Routes, suppliers,
prices and suggestions on the unaffected rows also remain identical. Both bad
input rows remain NOT_PROCESSED.

The files are in ignored kit_data/acceptance/: run-1-v5.0.csv, run-2-v5.1.csv,
preferred-suppliers.csv, comparison.json, chat transcripts, reset logs and audit
evidence. The fake amendment is 5.1-acceptance, effective 20 November 2026; the
saved run uses 21 November. v5.0 remains the policy selected for 16 November.
Buyer test documents were removed by the requested reset, but their audit records
and saved evidence remain. The app is running locally with Groq restored.
