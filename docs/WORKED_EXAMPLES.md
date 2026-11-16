# Worked-example verification

Generated with npm run report:worked, using the entire local kit, all twelve
contracts, and the hand-authored v5.0 seed. 14/14 scenarios pass.

Checks include route, exact source-data valuation, PO supplier/rate or ordered
sourcing suggestions, supporting contract, provenance, and the grouping or
consolidation relationships illustrated by each scenario. PDF display values
round to whole rupees; CSV group values round half-up to whole rupees while
internal values and JSON retain paisa.

| # | Scenario | Result | Route | Exact INR value (PDF display) | Detail |
| --- | --- | --- | --- | --- | --- |
| 1 | Contract PO | PASS | CONTRACT_PO | 137530.65 (137531 rounded) | Matches |
| 2 | PDF-only contract | PASS | CONTRACT_PO | 26829.11 (26829 rounded) | Matches |
| 3 | Exhausted contract ceiling | PASS | RFQ | 220255.60 (220256 rounded) | Matches |
| 4 | Lowest contract with sufficient ceiling | PASS | CONTRACT_PO | 32546.60 (32547 rounded) | Matches |
| 5 | Split requests clubbed | PASS | SPOT_PO | 126471.60 (126472 rounded) | Matches |
| 6 | Different plants remain separate | PASS | SPOT_PO | 156170.30 (156170 rounded) | Matches |
| 7 | Free-text hydraulic hose | PASS | SPOT_PO | 97955.00 (97955 rounded) | Matches |
| 8 | Emergency PO | PASS | EMERGENCY_PO | 253184.40 (253184 rounded) | Matches |
| 9 | RFQ above spot limit | PASS | RFQ | 336562.15 (336562 rounded) | Matches |
| 10 | RFQ without active purchase history | PASS | RFQ | 80300.00 (80300 rounded) | Matches |
| 11 | RFP with supplier shortage | PASS | RFP | 2070780.00 (2070780 rounded) | Matches |
| 12 | Capex before other rules | PASS | CAPEX_SOURCING | 6036704.08 (6036704 rounded) | Matches |
| 13 | New item sourcing | PASS | NEW_ITEM_SOURCING | 141100.00 (141100 rounded) | Matches |
| 14 | Multiple requirements on one PO | PASS | CONTRACT_PO | 23227.40 (23227 rounded) | Matches |

PO labels are generated in chronological order from the complete batch and are
not compared to the PDF's illustrative labels. For example, the earliest sample
requirement starts at 08:10 on 2 November, before the oil example at 09:40. The
oil PO is PO-0002 in this run; the PDF calls it PO-0001. Stable IDs and actual
consolidation membership are tested.

All 186 input rows remain in output. The two invalid rows are NOT_PROCESSED
with reasons. Tests also check the three published preferred-list examples.

This verifies deterministic proposals; buyer approval and actual PO/event
creation belong to later phases.
