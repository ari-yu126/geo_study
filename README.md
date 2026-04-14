# GEO Analyzer

GEO Analyzer analyzes web pages to compute a GEO (Generative Engine Optimization) score and provide actionable recommendations to improve AI citation potential and user answerability.

## What this project contains

- **Analysis Engine** — extracts metadata, paragraphs, computes GEO scores (scoring system).  
- **Recommendation Engine** — generates prioritized, actionable content & metadata recommendations.  
- **UI** — interactive dashboard with left-side recommendations and right-side iframe preview.

## AI model, roles, and processing (course submission)

| Item | This project |
| --- | --- |
| **Model** | **Google Gemini** via `@google/generative-ai`. Default model name: `gemini-2.5-flash-lite` (override with `GENERATIVE_MODEL` in `.env.local`). Monthly GEO config research may use another Gemini model selected in-app / API. |
| **Why AI** | Semantic tasks that rules alone do not cover: e.g. judging citation-like quality of text chunks, filtering search questions for relevance, optional video analysis, and (when the user requests it) example prose via the AI Writing Assistant API. **Main audit-panel recommendations are not LLM-generated** — they come from deterministic rules, locale templates, and optional monthly `guideRules` in config. |
| **Roles** | **Scoring / analysis LLM:** chunk evaluation (`src/lib/citationEvaluator.ts`), question filtering (`src/lib/questionFilter.ts`), “actual AI citation” checks (`src/lib/actualAiCitation.ts`), video analysis (`src/lib/geminiVideoAnalysis.ts`). **Main content guide:** `src/lib/recommendationEngine.ts` — **no Gemini**; merges templates + optional `guideRules`. **Optional:** AI writing examples — `POST /api/ai-writing-examples` (`src/lib/generateAiWritingExamples.ts`). **Admin / research:** GEO config update (`src/app/api/geo-config/update/route.ts`). |
| **Processing style** | **Hybrid:** deterministic extraction, rule-based and config-driven scoring, and **targeted `generateContent` calls** with prompts defined in the source files above — not a single end-to-end prompt for the whole page. Retries / tracing: `src/lib/geminiRetry.ts`, `src/lib/geminiTraceContext.ts`. |

Non-AI parts include HTML parsing, paragraph extraction, caching, and much of the score pipeline (see `docs/geo-project-state/05-pipeline.md`).

## Documentation (entry point)

System docs live under `docs/geo-project-state/`.

- **`index.md`** — short entry: recommended reading order (overview → pipeline → scoring → recommendations).  
- **`docs-map.md`** — full map: every numbered doc, system-layer diagram, reading paths by role, and dependency notes.

File names in that folder follow the `NN-topic.md` pattern (e.g. `01-project-overview.md`).

## Getting started (development)

1. Create `.env.local` with required keys:

```env
# Gemini (analysis): GOOGLE_GENAI_API_KEY or GEMINI_API_KEY (see src/lib/geminiClient.ts, src/lib/geminiEnv.ts)
# Optional writing examples: GEMINI_WRITING_EXAMPLES_API_KEY / GEMINI_WRITING_EXAMPLES_MODEL (see src/lib/geminiEnv.ts)
GOOGLE_GENAI_API_KEY=your_key_here
TAVILY_API_KEY=optional_key
# Optional: add recent web “trend” snippets to monthly GEO scoring-config research (primary sources are official URLs + Semantic Scholar).
GEO_CONFIG_TAVILY_SUPPLEMENT=false
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
GENERATIVE_MODEL=gemini-2.5-flash-lite
```

2. Install dependencies and start dev server:

```bash
npm install
npm run dev
```

3. Open the app at http://localhost:3232 and use the UI to analyze pages. **After changing `.env.local`, restart `npm run dev`.**

## Core architecture

- `src/lib/runAnalysis.ts` — analysis orchestration  
- `src/lib/citationEvaluator.ts` — Gemini chunk scoring & LLM calls  
- `src/lib/recommendationEngine.ts` — deterministic recommendations (templates + optional monthly `guideRules`; no Gemini)  
- `src/app/*` — UI, API routes, and developer tools

## Two primary systems — keep them separate

1. Analysis (scoring): produces measurable signals (GeoScores, paragraphStats, trustSignals).  
2. Recommendation: consumes signals and produces human/actionable guidance.  

They are intentionally decoupled: scoring ≠ recommendations.

## Tech stack

- Next.js 16 (App Router)  
- React 19 + TypeScript  
- Tailwind CSS v4  
- @google/generative-ai (Gemini integration)  
- Supabase (cache & config)

## Project goals

- Reduce friction for publishers to improve pages for AI-first search.  
- Produce explainable recommendations grounded in measurable signals.  
- Keep LLM usage safe, minimal, and auditable.

## Optional npm scripts

Dataset / validation utilities (see `package.json` and `scripts/`):

- `npm run validate:editorial-subtype`
- `npm run summarize:editorial-subtype`
- `npm run evaluate:geo-ai-citations`
- `npm run evaluate:geo-ai-citations-paired`
