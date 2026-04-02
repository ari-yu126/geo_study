# Example: editorial subtype validation summary (illustrative)

This is a **fake** report shape. Real numbers come from `npm run summarize:editorial-subtype -- your-reviewed.csv`.

---

## Totals

| Metric | Value |
|--------|-------|
| Rows in file | 24 |
| Editorial (predictable subtype) | 22 |
| Rows with manual_expected filled | 20 |
| Labeled editorial (for agreement) | 20 |

## Counts by predicted subtype (editorial rows)

| Subtype | Count |
|---------|-------|
| site_info | 10 |
| blog | 8 |
| mixed | 4 |

## Counts by manual_expected (labeled editorial)

| Subtype | Count |
|---------|-------|
| site_info | 9 |
| blog | 8 |
| mixed | 3 |

## Agreement (labeled editorial only)

- **Match:** 16
- **Mismatch:** 4
- **Match rate:** 80.0%

## fp_or_fn column (optional labels)

- **Rows tagged fp:** 2
- **Rows tagged fn:** 2

## Confusion pairs (mismatches)

- **Predicted blog · manual site_info:** 1
- **Predicted site_info · manual blog:** 2
- **Predicted mixed (all editorial):** 4

## Slices for tuning

- **High-confidence mismatches** (confidence ≥ 0.65): 1
- **Low-confidence mixed** (predicted mixed & confidence < 0.45): 2
- **Low-confidence but agreed with manual** (correct & confidence < 0.45): 3

### Common reason tokens (mismatch rows only)

| Token | Count |
|-------|-------|
| `reason: path: help/docs` | 2 |
| `resolution: scores too close → mixed` | 2 |

### URLs worth another look (priority)

| URL | Predicted | Manual | Conf | Note |
|-----|-----------|--------|------|------|
| https://example.com/help/a | site_info | blog | 0.72 | high-confidence mismatch |

---

*Evidence-only report — use to adjust heuristics in a follow-up change.*
