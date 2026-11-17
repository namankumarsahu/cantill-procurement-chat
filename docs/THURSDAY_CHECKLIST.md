# Thursday checklist

Use the hosted HTTPS URL. Warm it up first and open `/api/health`; expect
`{"status":"ok"}`. The supplied sample defaults to **2026-11-20**, its latest
parsable PR creation date in Asia/Kolkata, even when you run it on 17 November.
Blank As of date uses batch data, never today's date. If all timestamps are
invalid, supply the date explicitly.

**Automatic for as-of date** selects the latest approved policy whose effective
date is on/before that comparison date. Approval alone does not make a later
amendment apply to older batch dates. Selecting its version explicitly also
requires a sufficiently late as-of date; otherwise processing rejects it.

For the blind test, choose a common comparison date at least the batch's latest
creation date and the amendment's effective date. Pin **v5.0 for run 1**, then
pin **the approved amendment for run 2**, using the same CSV. If the amendment's
date is learned later, redo/download run 1 under v5.0 on the later comparison
date first. For example, a 25 November amendment needs 25 November or later for
both runs; blank date would remain 20 November and not apply that amendment.

## Before the clock starts

1. **Working as → Procurement**. Open **Acting user and admin access**, enter your
   name and the admin token. Tokens stay in memory; enter again after a refresh.
2. Set **Export filename prefix** to your actual submission name, for example
   `yourname`. Letters, digits, `_` and `-` only. It is remembered in this browser.
3. If not seeded: **Import data → Task kit ZIP → choose original ZIP → Preview
   import → inspect counts/warnings/terms → Confirm and import**. Check Contracts
   shows 12 entries, including two pdf_only, for the supplied kit.
4. Start with v5.0 and no buyer-approved orders for this batch. If a disposable
   demo needs clearing, follow the authenticated dry-run/confirm reset instructions
   in [deployment guide](DEPLOY_RENDER_NEON.md). Do not reset a real database.

## Run 1: baseline

1. **Upload batch → PR CSV → choose sample_pr_batch.csv** (or the blind batch).
2. Set **As of date** to the common comparison date, choose **Policy version → 5.0** and **Export label → run1 —
   baseline**. Click **Process batch**.
   This processes the new batch under v5.0 even if Automatic would select another
   approved policy. The export label names the file; it does not choose v5.0.
3. Check the row count, policy/version and route counts. For the supplied sample:
   186 rows; 33 CONTRACT_PO, 72 SPOT_PO, 6 EMERGENCY_PO, 53 RFQ, 8 RFP, 10 Capex,
   2 NEW, 2 NOT_PROCESSED. A blind batch can have different counts.
4. Click **Download yourname__run1.csv** once. Keep that downloaded file before
   reprocessing: the server export URL always serves the current replacement run.

## Amendment

1. **Policy updates → Base approved policy → 5.0** (or the assessment's specified
   base). Set a new unique version and the amendment's **Effective from** date.
2. In **Draft input**, choose **Upload PDF or text** and select the amendment;
   alternatively choose **Describe a change in chat**. Click **Create draft for
   review**. Never approve a guessed or invalid interpretation.
3. Read the plain-language diff, rule restatements, comparison date and impact.
   Check old-route → new-route counts against the scope you expect. A scoped
   limit must not accidentally affect other plants/categories or bypass contract/
   Emergency precedence. Zero change can be valid, but investigate surprises.
4. If wrong: **Regenerate with feedback** and explain the scope correction. With
   no key or invalid model output, use the **Manual JSON editor**, validate, and
   refresh the impact. Click **Approve reviewed draft** only after reviewing the current
   saved preview. Keep the approval on the screen; run 2 uses this version.

## Run 2: same batch, approved amendment

1. Return to **Upload batch**, select the **same CSV** and the **same As of date**
   used in run 1. If the amendment is future-effective relative to that date,
   first use the impact's comparison date for both runs: rerun/download the v5.0
   baseline on that date before proceeding, so date changes cannot explain a diff.
2. Choose **Policy version → your approved amendment** and **Export label → run2 —
   amendment**. Click **Process batch**; status should say **Replaced existing
   results**. Do not approve buyer orders between the two blind runs.
   Check the result's displayed version is the amendment and its date matches the
   saved v5.0 baseline. Do not rely on Automatic or the run2 filename to choose it.
3. Click **Download yourname__run2.csv** once. Compare by PR/line. All rows must
   remain; policy/version and reasons change across runs, and sequential proposal
   PO IDs can renumber. Compare actual route, supplier, rate, suggestions, value
   and group/PO membership. Expect only amendment-related business changes.

## Preferred suppliers

1. **Preferred suppliers → As of date → same comparison date → Calculate
   preferred lists**. Verify the displayed policy version/date.
2. Click **Download yourname__preferred.csv** once. The downloaded set covers
   all items with eligible preferred suppliers, at most three per item; the UI
   Find an item filter does not narrow this full export.

Final files: yourname__run1.csv, yourname__run2.csv, yourname__preferred.csv.
Decision headers must be exactly:

```text
pr_no,pr_line,resolved_item_code,group_id,po_id,decision,route,supplier_id,unit_price,group_value_inr,suggested_supplier_ids,policy_version,reason
```

Preferred headers: `item_code,rank,supplier_id,reference_price`. Keep the actual
CSV downloads in submission/ locally if desired; all CSV outputs are Git-ignored.
