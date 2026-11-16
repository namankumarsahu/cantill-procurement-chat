# Amendment hardening verification

- Impact previews show meaningful changed rows grouped by old route -> new route.
- Preview evaluation uses identical data/date for both policies and changes no
  saved result, PO proposal or contract balance.
- Approval requires a fresh preview for the exact draft/current batch. A changed
  draft, changed current run or missing preview is rejected.
- No-batch approval explicitly acknowledges unavailable impact.
- LLM calls use temperature 0, v5.0 JSON and three text/JSON examples. Every new
  rule requires a single-line restatement. Invalid/missing notes are rejected.
- Regenerate with feedback updates draft JSON, diff, notes and impact together;
  unresolved output and concurrent edits preserve the last valid draft.
- The demo reset defaults to a dry run; confirmed reset preserves master data and
  restores v5.0. Production mode is refused.

## Regression and live checks

All 54 regression tests, TypeScript checks and the web build pass.

The integration test deliberately starts with the earlier faulty pattern: a
narrower PO rule that falls through to the global rule. Its impact is zero rows.
Feedback regenerates a real scoped RFQ restriction: exactly one of two fixture
rows changes from SPOT_PO to RFQ, and the other plant stays unchanged. Tests
check stale/missing previews, no mutation of saved results, feedback errors,
restatement coverage, and reset/dry-run preservation.

A live Groq check in a disposable schema caught that feedback buried in the
system context could still be ignored. After moving corrections into the final
user message, the model returned a CHK1-only restriction, preserved the global
spot/emergency limits, and supplied its rule restatement. The impact changed
from zero to the expected one-row SPOT_PO -> RFQ transition. The saved baseline
was unchanged and the test schema was cleaned up. No live policies were approved
or removed in this check.

Only a dry run was executed against the user's local app: it listed
5.1-groq-demo, 5.2-groq-demo and two runs for potential removal. Existing live
state was retained. The CLI command to actually clear the demo is:

```sh
npm run reset:demo -- --confirm-reset
```

Model output remains best-effort despite temperature 0. Impact previews expose
actual engine behavior; restatements are explanations to review, not authority.
