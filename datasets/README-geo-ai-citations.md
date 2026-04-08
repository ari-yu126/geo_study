# GEO validation dataset — AI-cited pages

## Purpose

Collect **real** examples where an AI system (ChatGPT, Perplexity, Google AI Overview, etc.) **cited** a URL, then run the GEO Analyzer on those URLs to see whether scores align with “should be citable” expectations.

This is **evidence collection only** — it does not change scoring.

## File format (`geo-ai-citations.template.csv`)

| Column | Required | Description |
|--------|----------|-------------|
| `query` | yes | User query or topic that led to the citation |
| `ai_system` | yes | e.g. `ChatGPT`, `Perplexity`, `Google AI Overview` |
| `cited_url` | yes | Full URL that appeared as a citation |
| `non_cited_url` | no* | Same-query page **not** cited by the AI (for paired research) |
| `domain` | no | Hostname; leave empty to derive from `cited_url` |
| `date` | no | When you observed the citation (ISO `YYYY-MM-DD` recommended) |
| `notes` | no | Free text (source screenshot, run id, caveats) |

\* **`non_cited_url`:** Omit or leave empty for **single-URL** runs (`evaluate:geo-ai-citations`). Required for **paired** runs (`evaluate:geo-ai-citations-paired`) — use a dedicated CSV with both URLs filled (see `geo-ai-citations-paired.example.csv`).

- Lines starting with `#` are ignored by the evaluator (comments).
- Use UTF-8.

## Workflow

1. Copy `geo-ai-citations.template.csv` to e.g. `my-citations.csv` and fill rows from real observations.
2. Ensure app env (Supabase, Gemini, Tavily, etc.) matches what you use for normal analysis.
3. Run:

   ```bash
   npm run evaluate:geo-ai-citations -- path/to/my-citations.csv
   ```

   Optional:

   - `GEO_VALIDATE_APP_ORIGIN` — e.g. `http://localhost:3232` to fetch HTML via `/api/proxy`
   - `GEO_AI_CITATION_DELAY_MS` — delay between URLs (default `800`)
   - `GEO_AI_CITATION_LOW_SCORE` — flag “unexpectedly low” below this `finalScore` (default `45`)

4. Open outputs under `tmp/geo-ai-citation-validation/`:

   - `results-*.jsonl` — one JSON object per row with scores + metadata
   - `summary-*.md` — averages, distributions, strong/weak axes, low-score cases

## Paired dataset (cited vs non-cited for the same query)

1. Build a CSV with columns **`query`, `ai_system`, `cited_url`, `non_cited_url`, `domain`, `date`, `notes`** (see `geo-ai-citations-paired.example.csv`). Each row runs GEO on **both** URLs.
2. Run:

   ```bash
   npm run evaluate:geo-ai-citations-paired -- path/to/paired.csv
   ```

   Same env vars as above (`GEO_VALIDATE_APP_ORIGIN`, `GEO_AI_CITATION_DELAY_MS`, optional `GEO_AI_CITATION_OUT_DIR`).

3. Outputs under `tmp/geo-ai-citation-paired-validation/` (unless overridden):

   - `paired-results-*.jsonl` — per row: cited + non-cited results, `axisDelta`, `finalScoreDelta`
   - `paired-summary-*.md` — mean axis scores (cited vs non-cited), mean Δ per axis, **Pearson r** (axis vs cited label on stacked observations), largest gaps

The summary explains how to read **mean Δ (cited − non-cited)** and **Pearson r** as exploratory signals of which axes align with “being the cited page” in your sample — not causal proof.

## Outputs captured per URL

- `finalScore`, `axisScores`, `pageType`, `editorialSubtype`
- Active `geo_scoring_config` **version** (or default config version if offline)
