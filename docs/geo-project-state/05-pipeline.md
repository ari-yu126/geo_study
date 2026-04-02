# 05 — Analysis Pipeline (runAnalysis)

This document describes the end-to-end analysis pipeline executed by `runAnalysis`.

---

## Overview

The analysis pipeline transforms a raw URL into a structured GEO evaluation.

It combines:

- rule-based content analysis  
- LLM-based semantic evaluation (Gemini)  
- external search data (Tavily)  

to compute GEO scores and generate actionable recommendations.

### End-to-end flow (conceptual)

```
URL input
  → Extraction (HTML, meta, content, optional headless)
  → Content / signals (paragraphs, chunks, trust, questions)
  → Axis score calculation (citation, paragraph, answerability, structure, trust, question match/coverage, …)
  → Monthly vs fixed score blending (alpha) + trust cap + commerce/video branches as applicable
  → Final GEO score
  → Explain Engine (issues, strengths, opportunities)
  → Recommendation generation (LLM or template fallback)
  → AnalysisResult assembly (scores, geoExplain, recommendations, audit payloads)
  → UI (panel + overlay)
```

The **Explain layer** is **downstream of scoring**: it turns axis scores and rules into human-readable diagnostics; it does not replace the scoring pipeline.

---

## Function Contract

runAnalysis(url: string): Promise<AnalysisResult>

### Input
- `url`: target page URL

### Output
- `AnalysisResult`
  - scores (GEO score breakdown)
  - `geoExplain` (axis scores, issues, passed strengths, opportunities) when assembled
  - issues / passed checks (for audit UI; derived in client or bundled)
  - recommendations (actionable improvements)
  - metadata (page info, topic, etc.)

---

## Pipeline Steps

1. **Fetch HTML**  
   - `fetchHtml(url)`  
   - retrieves raw HTML content

2. **Extract metadata and content**  
   - `extractMetaAndContent(html)`  
   - extracts title, description, headings, main content

3. **Detect topic and seed keywords**  
   - `extractSeedKeywords(meta, content)`  
   - determines primary topic and keyword signals

4. **Collect search questions (Tavily)**  
   - `fetchSearchQuestions(primaryTopic)`  
   - collects real-world user/search questions  
   - applies topic filtering and relevance filtering

5. **Parallel execution**

   - **Paragraph analysis**  
     - `analyzeParagraphs(html, headings, searchQuestions)`  
     - rule-based evaluation:
       - definition patterns  
       - information density  
       - duplication  
       - paragraph length  

   - **Citation evaluation (Gemini)**  
     - `evaluateCitations(chunks, searchQuestions)`  
     - semantic evaluation:
       - citation likelihood (0–10)  
       - community fit (0–10)  
       - reasoning  

6. **Compute structural scores**  
   - structureScore  
   - answerabilityScore  
   - trustScore  
   - based on rule-based signals (meta tags, schema, content layout, etc.)

7. **Aggregate final GEO score**  
   - compute partial axis scores (citation where applicable, paragraph, answerability, structure, trust, question match/coverage, …)  
   - **hybrid blend**: monthly profile weights vs. fixed engine weights (`scoreBlendAlpha`) via `geoScoreBlend` / `runAnalysis`  
   - apply **trust caps** and **page-type branches** (e.g. commerce final score override, video pipeline)

8. **Explain Engine (GEO Explain layer)**  
   - builds structured explainability:  
     - **Issues** — rule-based / monthly issue rules → `geoExplain.issues` (and audit issues)  
     - **Strengths** — passed checks / `geoExplain.passed` (strong signals already present)  
     - **Opportunities** — opportunity engine merges issue-linked and template-based opportunities → `geoExplain.opportunities`  
   - runs after core scores are known; uses `loadActiveScoringConfig()` for monthly rules and templates  
   - see **Explain Layer** below

9. **Generate recommendations**  
   - `generateGeoRecommendations(...)`  
   - narrative / strategy guidance (headings, FAQ blocks, comparison tables, structure) — often LLM-backed with template fallback  

10. **Return result**  
   - returns `AnalysisResult` (scores, `geoExplain` when set, recommendations, etc.)  
   - used for UI rendering and report generation  
   - persist: analysis is upserted to Supabase (`analysis_history`) as part of the pipeline (or immediately after) for caching and audit.

---

## Parallel Execution

Paragraph analysis and citation evaluation are executed in parallel:

- `analyzeParagraphs` → deterministic, rule-based  
- `evaluateCitations` → LLM-based (Gemini)  

This separation:
- reduces latency  
- isolates AI dependency  
- improves system stability  

---

## Explain Layer

The **Explain layer** converts numeric axis scores and configured rules into **human-readable** diagnostics. It is the bridge between **scoring** and **product UI** (audit panel, overlays, exports).

| Field | Meaning |
|-------|---------|
| `geoExplain.axisScores` | Normalized axis scores for charts and copy (aligned with scoring axes). |
| `geoExplain.issues` | Structured issues (categories, severity, labels, fixes) — **missing / weak / structural / trust** style signals. Prefer this when present in API payloads; client may merge with engine-derived issues. |
| `geoExplain.passed` | **Strengths** — passed checks / strong GEO signals already present on the page. |
| `geoExplain.opportunities` | High-impact improvement seeds (issue-linked, weak-axis, optional monthly templates). |

**Strengths** highlight what already works for AI citation. **Issues** highlight gaps and risks. **Opportunities** prioritize what to do next; **recommendations** (separate step) add narrative strategy and action plans.

Orchestration lives in `src/lib/geoExplain/` (issue/passed/opportunity engines, rule layer) and `src/lib/issueDetector.ts` (audit derivation). Monthly config can supply `issueRules`, `passedRules`, and `opportunityTemplates` when stored in `geo_scoring_config`.

---

## Gemini Usage

Gemini is used only for semantic evaluation:

- evaluates citation likelihood per paragraph  
- outputs structured scores and reasoning  
- does not control pipeline flow  

All orchestration remains deterministic.

**Operational notes (LLM errors & quota)**  
- 429 / quota errors: do not retry — set a short cooldown and immediately fall back to template recommendations.  
- Non-429 transient errors: may be retried with limited backoff (see retry policy).

---

## Caching

Before executing the pipeline:

- check Supabase for existing analysis results  
- if a recent result exists (within TTL):
  - return cached result  
  - skip Gemini calls to reduce cost  

**Limited-analysis / short HTML**  
- If analysis is limited (bot protection, very short HTML, etc.), Gemini calls can be skipped and template-based recommendations (isTemplateFallback) used instead.

---

## GEO System Flow (URL → Score → Explain → UI)

This is a **conceptual** end-to-end map of the GEO system: how a URL becomes scores, diagnostics, strategy, and UI. It complements the **numbered pipeline steps** above (which are closer to implementation order). Use it onboarding: see **what** each stage is for, not every function name.

```
URL Input
  → HTML / Metadata Extraction
  → Content Signals
  → Axis Score Calculation
  → Monthly + Fixed Score Blending
  → Final GEO Score
  → Explain Engine
       · Issues
       · Strengths
       · Opportunities
  → Recommendation Engine
  → AnalysisResult Assembly
  → UI (Panel + Overlay + Report)
```

| Stage | What it does |
|-------|----------------|
| **URL Input** | User-supplied target; drives fetch, page-type detection, and downstream branch (editorial / commerce / video). |
| **HTML / Metadata Extraction** | Load raw HTML (and optional headless fetch if needed); parse meta, headings, body, schema, structured data. |
| **Content Signals** | Derive features from content: paragraphs, chunks, trust heuristics, search questions, commerce signals, video metadata—inputs for both rules and LLM. |
| **Axis Score Calculation** | Produce partial scores (citation, paragraph, answerability, structure, trust, question match/coverage, etc.) from signals + config + optional Gemini. |
| **Monthly + Fixed Score Blending** | Combine **profile weights** from Supabase with **fixed engine weights** using blend alpha (`scoreBlendAlpha`); same axes, two weighting views—then trust caps and page-type branches (e.g. commerce override). |
| **Final GEO Score** | Single headline score (`scores.finalScore`) and breakdown fields for UI and persistence—aligned with GEO “AI citation likelihood.” |
| **Explain Engine** | Turn numbers and rules into **diagnostics**: **Issues** (gaps), **Strengths** (`passed`), **Opportunities** (prioritized next steps). Uses `geoExplain.*` and audit derivation. |
| **Recommendation Engine** | Narrative **strategy**: suggested headings, blocks, action plans—often LLM-backed, template fallback on quota/errors. |
| **AnalysisResult Assembly** | Bundle scores, `geoExplain`, recommendations, metadata, and audit-friendly payloads into one `AnalysisResult` for clients. |
| **UI (Panel + Overlay + Report)** | Present scores, issues, strengths, opportunities, and recommendations in the product surface (and exports). |

For scoring mechanics (blend alpha, trust caps, commerce), see **`03-scoring-system.md`**. For issues vs strengths vs opportunities vs recommendations, see **`10-scoring-issue-philosophy.md`**.

---

## Related Files

- Pipeline orchestration:  
  - `src/lib/runAnalysis.ts`

- Score blending (monthly vs fixed, commerce):  
  - `src/lib/geoScoreBlend.ts`

- Paragraph analysis:  
  - `src/lib/paragraphAnalyzer.ts`

- Citation evaluation (Gemini):  
  - `src/lib/citationEvaluator.ts`

- Scoring logic:  
  - `src/lib/defaultScoringConfig.ts`  
  - `src/lib/scoringConfigLoader.ts`

- Explain layer (issues / passed / opportunities):  
  - `src/lib/geoExplain/`  
  - `src/lib/issueDetector.ts`

- Recommendation engine:  
  - `src/lib/recommendationEngine.ts`
 - Gemini retry & error handling:
   - `src/lib/geminiRetry.ts`
   - `src/lib/llmError.ts`