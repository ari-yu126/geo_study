# Editorial subtype validation — review notes

## Workflow (validation evidence → tuning)

1. **Run validation** — produce machine-labeled CSV:

   `npm run validate:editorial-subtype -- scripts/your-urls.txt`

2. **Review in Sheets** — open the generated CSV under `tmp/editorial-subtype-validation/`, then fill:
   - **`manual_expected`:** `blog` | `site_info` | `mixed` (your ground truth)
   - **`manual_note`** — free text
   - **`fp_or_fn`** — optional: `fp` (false positive), `fn` (false negative), or `fp, fn` if you use both tags

3. **Save the reviewed CSV** (e.g. `my-review.csv`) — keep the header row intact.

4. **Run summary** — aggregate evidence for rule tuning:

   `npm run summarize:editorial-subtype -- path/to/my-review.csv`

   Outputs Markdown + JSON in `tmp/editorial-subtype-validation/` (`summary-<name>-<timestamp>.md` and `.json`).

5. **Use the report** — read confusion pairs (`blog` vs `site_info`), high-confidence mismatches, and reason-token counts on mismatches before changing `editorialSubtype` heuristics.

See also: `scripts/examples/editorial-subtype-validation-summary.example.md` for the expected report shape.

---

## Batch export only

`npm run validate:editorial-subtype -- scripts/your-urls.txt`

Optional env:

- `GEO_VALIDATE_APP_ORIGIN` — e.g. `http://localhost:3232` to load pages via your app’s `/api/proxy` (bot/WAF bypass).
- `GEO_VALIDATE_DELAY_MS` — pause between requests (default 400).
- `GEO_PAGE_TYPE_LOG=1` — verbose page-type detection log (off by default for cleaner batch output).

## Outputs

- `tmp/editorial-subtype-validation/validation-*.csv` — open in Sheets/Excel; fill **manual_expected** (`blog` | `site_info` | `mixed`), **manual_note**, **fp_or_fn** (`fp` = false positive, `fn` = false negative, blank if OK).
- `validation-*.jsonl` — same data, one JSON object per line (good for scripts).

## How to summarize (20–30 URLs)

1. Sort or filter rows where **fp_or_fn** is not empty.
2. **False positive (fp):** model said `blog` or `site_info` but you disagree — note actual intent.
3. **False negative (fn):** model said `mixed` or wrong class — note what it should be.
4. Group notes into 2–4 bullets:
   - Common FP patterns (e.g. marketing blog on corporate domain classified as site_info).
   - Common FN patterns (e.g. help center with Article JSON-LD classified as blog).

## Reminder

This step does **not** change scoring or detection rules — validation only.
