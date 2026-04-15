# 07 — Reference

This document provides a quick index of key files and modules used in the GEO Analyzer system.

---

## Core Pipeline

- `src/lib/runAnalysis.ts`  
  → main orchestration of the analysis pipeline

---

## Analysis

- `src/lib/paragraphAnalyzer.ts`  
  → paragraph-level rule-based analysis (definition, info density, duplication)

- `src/lib/citationEvaluator.ts`  
  → Gemini-based citation scoring (drives "golden paragraph" selection in UI)

- `src/lib/analysisTypes.ts`  
  → core types (AnalysisResult, GeoScores, ChunkCitation)

---

## Scoring

- `src/lib/defaultScoringConfig.ts`  
  → scoring weights and rules (default profiles)

- `src/lib/scoringConfigLoader.ts`  
  → dynamic loading of scoring profiles (runtime overrides)

---

## Recommendation

- `src/lib/recommendationEngine.ts`  
  → deterministic content guide (templates + optional monthly `guideRules`; no Gemini)

- `src/lib/recommendations/buildGeoRecommendations.ts`  
  → `buildGeoRecommendationsFromSignals`

- `src/lib/recommendations/guideRulesMerge.ts`  
  → merge monthly `guideRules` when triggers match issue/passed ids

---

## LLM / Error Handling

- `src/lib/geminiRetry.ts`  
  → retry / cooldown logic (429 handling, backoff)

- `src/lib/llmError.ts`  
  → LLM error handling and classification (cooldown state)

---

## API Layer

- `src/app/api/analyze/route.ts`  
  → API endpoint handling analysis requests (cache + persist)

---

## URL normalization & preview (supporting modules)

- `src/lib/normalizeUrl.ts` — canonical URL for cache keys; product-detail / search identity query handling  
- `src/lib/resolveFetchTargetUrl.ts` — network fetch target when it should differ from normalized identity  
- `src/lib/previewPolicy.ts` — apex host blocklist for live iframe (`LIVE_PREVIEW_BLOCKED_HOSTS`); static card + open in new tab (**not** gated on `pageType`)  
- `src/lib/previewRuntimeFallback.ts` — heuristics to switch from live iframe to static preview on runtime errors (**`/api/proxy` same-origin iframe only**)  
- `src/app/api/proxy/route.ts` — HTML proxy for preview; `X-GEO-Upstream-Final-Url` for server-side fetch; upstream fetch failures return **502** JSON (`ok: false`, `errorType` e.g. `REDIRECT_LIMIT` vs `FETCH_FAILED`); excessive redirects are logged at **warn**  
- `src/app/components/StaticSitePreviewCard.tsx` — static preview card; user vs debug explainer copy; `?debug=1` / `?debug=true` from the app page enables debug copy

---

## Cache / Database

- Supabase table: `analysis_history`  
  → stores cached analysis results (upserted per analysis)

---

## External Services

- **Google Gemini API**  
  → semantic evaluation (e.g. citation scoring, question filtering, video analysis). **Not** used to phrase the main audit-panel recommendation object; optional writing examples use `POST /api/ai-writing-examples`.

- **Tavily API**  
  → search question collection and filtering