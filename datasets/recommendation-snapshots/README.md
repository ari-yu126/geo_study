# Recommendation engine snapshots (Phase A)

These are **not** live URL dumps. They are **static fixtures** that approximate classes of pages (Korean blog, English help, PDP, YouTube, review-like editorial) so we can verify:

- Output is **signal-grounded** (uncovered questions → trend + FAQ trace; low axes → gap text + headings).
- **No generic LLM prose** — copy comes from `recommendations/templates/*` and `rules/*` only.

## How to verify

From the repo root:

```bash
npx tsx scripts/verify-recommendation-snapshots.ts
```

This runs `buildGeoRecommendationsFromSignals` on each fixture (user-facing copy, no internal axis names in gap text) and checks:

- Expected substrings in `trendSummary` / `contentGapSummary`
- At least one suggested heading (when specified)
- Trace entries reference expected `issue:`, `opportunity:`, `axis:`, or `signal:` prefixes

## Fixture list

| ID | Approximates |
|----|----------------|
| `editorial-ko-uncovered-questions` | KO article with uncovered community questions |
| `editorial-en-low-citation-trust` | EN site-info with low citation + trust |
| `commerce-ko-trust-signal` | KO PDP with trust/geo issue |
| `video-en-metadata-faq` | EN YouTube with weak video metadata + uncovered Q |
| `editorial-ko-review-like-no-uncovered` | KO review-like (`reviewLike`) with opportunities only |

## Main vs legacy path

- **Main analyze path:** `geoIssues`, `geoOpportunities`, `axisScores`, `uncoveredQuestions` (and related context). `AuditIssue` is **not** merged here yet.
- **Legacy `generateTemplateRecommendations`:** If `geoIssues` is **omitted**, `AuditIssue[]` is converted to synthetic `GeoIssue` rows. If `geoIssues` is **passed** (including `[]`), that array is used as-is — no audit merge.

## Optional: capture output after a real analyze

To eyeball a real URL, run analyze in the app and copy `result.recommendations` (and `result.geoExplain`) from the API JSON. Do not commit API keys or private URLs without redaction.
