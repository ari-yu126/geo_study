# 04 — Recommendation System

This document describes the **main audit-panel content guide**: inputs, deterministic rule logic, optional monthly `guideRules` from config, and the `GeoRecommendations` output shape.

**Not in scope here:** `POST /api/ai-writing-examples` (Gemini, user-triggered prose examples) — that API is separate from scoring and from `generateGeoRecommendations`.

## Overview

- **Purpose:** Produce actionable, prioritized **content improvement guidance** (trend line, gap summary, suggested headings/blocks, priority to-dos, optional predicted questions) to improve AI citation potential and answerability.  
- **Distinct from scoring:** scoring measures; this layer prescribes **editor-style** guidance (no numeric score copy in user strings).  
- **Implementation:** **Deterministic** — rules + locale templates (`src/lib/recommendations/templates/`), axis/page-type rules (`src/lib/recommendations/rules/`), then optional **guideRules** merge from active `geo_scoring_config` (`src/lib/scoringConfigLoader.ts`, `src/lib/recommendations/guideRulesMerge.ts`). **No Gemini** in `src/lib/recommendationEngine.ts`.

## Inputs

The rule engine consumes a `RecommendationContext` (see `src/lib/recommendations/recommendationContext.ts`), including:

- **pageType** — `editorial` | `commerce` | `video`  
- **locale** — `ko` | `en` (from page text/meta sample)  
- **editorialSubtype** — `blog` | `site_info` | `mixed` (editorial only; tones trend summary wording)  
- **axisScores** — `GeoAxisScores | null`  
- **geoIssues**, **geoOpportunities** — from the explain layer  
- **uncoveredQuestions**, **searchQuestions** — `SearchQuestion[]`  
- **contentQuality** — `ContentQuality | null` (lists, headings, editorial blog signals, etc.)  
- **reviewSignals** — `reviewLike`, `hasReviewSchema` (editorial/commerce surface)  
- **limitedAnalysis** — shorter trend copy when extraction was limited  
- **questionRules** — optional `QuestionDisplayRules` from profile config (predicted-question caps / ordering)

`generateGeoRecommendations` (`src/lib/recommendationEngine.ts`) also accepts **LegacyRecommendationInput** fields (meta, textSample, etc.) via `toRecommendationContext` for locale detection, and optionally **activeScoringConfig** so guide-rule resolution matches the same config snapshot as analysis.

### Example signal bundle (illustrative)

Structured scores and content features feed the rules indirectly (e.g. via `contentQuality`, `axisScores`, issues). A conceptual bundle might include:

```json
{
  "structureScore": 72,
  "descriptionLength": 120,
  "commerceScore": 35,
  "dataDensity": 0.42,
  "hasReviewSchema": true,
  "reviewLike": true,
  "repeatedProductCardCount": 1,
  "listCount": 2,
  "tableCount": 0,
  "hasPriceInfo": true,
  "detectedTopic": "Travel Hair Dryer"
}
```

Exact fields used per rule live in `axisRules.ts` and page-type builders — the above is **not** a single typed `pageSignals` object in code.

## Decision logic

- **Branch by `pageType`:**
  - **video** — `buildVideoHeadingsAndBlocks` (`videoRules.ts`)  
  - **commerce** — `buildCommerceHeadingsAndBlocks` (`commerceRules.ts`)  
  - **editorial** — `buildEditorialHeadingsAndBlocks` → axis-driven headings/blocks (`editorialRules.ts` + `axisRules.ts`), with **review** surface influenced by `reviewSignals.reviewLike` / schema flags where rules apply  

- **Trend summary** — Template-selected by signals (`uncoveredQuestions`, opportunities, issues, `limitedAnalysis`); editorial subtype may refine wording (`editorialSubtypeWording.ts` — string helpers, **not** LLM).

- **Content gap summary** — From low-axis gaps and concrete issue `fix`/`label` lines (capped), plus trace.

- **Priority notes** — Axis-ordered actionable lines (`collectAxisPriorityNotes`), capped (see `MAX_PRIORITY_ACTIONS` in `axisRules.ts`).

- **Predicted questions** — Derived from uncovered question text and optional `questionRules` (`questionDisplaySelection.ts`).

## Monthly `guideRules` (config)

- Resolved per page type: `resolveGuideRulesForPageType(config, pageType)` (`scoringConfigLoader.ts`) — merges root / `profiles.default` / `profiles[pageType]` guide lists when present in JSON.  
- **Triggers:** Each rule’s `basedOn` / `based_on` (or alternate keys such as `triggers`, `issue_ids` — see `guideRuleBasedOnRefs`) is matched against **current issue ids** and optional **passed (strength) ids**.  
- **Merge:** When rules match, config-first lines are merged into `actionPlan.priorityNotes` and, when present on rules, `suggestedHeadings` / `suggestedBlocks`, with engine output filling remaining slots (deduped, capped) — see `mergeGuideRulesIntoRecommendations`.  
- **Deterministic** — No LLM; `guideGenerationDebug` records `source`, `matchedRuleIds`, optional `matchedGuideRules`, and `appliedFields` (which action-plan fields received config-driven content).

## Gemini usage (main recommendation path)

- **`generateGeoRecommendations` / `buildGeoRecommendationsFromSignals` do not call Gemini.**  
- **Gemini** is used only in **other** features (e.g. citation evaluation, question filtering, video analysis — see pipeline docs) and in **`POST /api/ai-writing-examples`** for optional **AI writing examples**, which is **not** part of the main recommendation object returned by analysis.

## Fallback logic

- **Primary path:** Every successful build produces **deterministic** `GeoRecommendations` from signals + templates (+ `guideRules` when configured). There is **no** “Gemini failed → fallback” branch for the main panel.  
- **`isTemplateFallback`:** The deterministic builder sets `isTemplateFallback: false` (`buildGeoRecommendations.ts`). The legacy helper `generateTemplateRecommendations` (`src/lib/recommendationFallback.ts`) may set **`isTemplateFallback: true`** when used as a **quota/template-only** path for template callers — this is **optional** and separate from the normal `runAnalysis` recommendation path.

## Rate limits and LLM errors

Quota / 429 handling for **Gemini elsewhere** in the app does **not** switch the main recommendation engine to a different mode — the content guide remains rule-driven. See `src/lib/geminiRetry.ts`, `src/lib/llmError.ts` for analysis-time LLM behavior.

## Output shape (`GeoRecommendations`)

Aligned with `src/lib/analysisTypes.ts` — user-facing strings must stay non-diagnostic (product rules). Approximate JSON shape:

```json
{
  "trendSummary": "string",
  "contentGapSummary": "string",
  "actionPlan": {
    "suggestedHeadings": ["string"],
    "suggestedBlocks": ["string"],
    "priorityNotes": ["string"]
  },
  "predictedQuestions": [
    {
      "question": "string",
      "importanceReason": "string",
      "coveredByPage": false,
      "isTopGap": true
    }
  ],
  "predictedUncoveredTop3": [],
  "isTemplateFallback": false,
  "trace": {
    "locale": "ko",
    "reviewCategory": "none",
    "reviewCategoryConfidence": "low",
    "entries": [
      {
        "target": "trendSummary | contentGapSummary | heading | block | priorityNote | predictedQuestions | guideRule",
        "sources": ["issue:id", "opportunity:id", "guide:ruleId"],
        "index": 0
      }
    ]
  },
  "guideGenerationDebug": {
    "source": "config | fallback | mixed",
    "matchedRuleIds": ["string"],
    "matchedGuideRules": [
      { "id": "string", "message": "string", "priority": "high" }
    ],
    "appliedFields": {
      "priorityNotes": true,
      "suggestedHeadings": false,
      "suggestedBlocks": false
    }
  }
}
```

Optional fields may be omitted when empty. `guideGenerationDebug` is optional.

## Implementation map

- **Orchestration:** `src/lib/recommendationEngine.ts` — `generateGeoRecommendations`  
- **Core builder:** `src/lib/recommendations/buildGeoRecommendations.ts` — `buildGeoRecommendationsFromSignals`  
- **Guide merge:** `src/lib/recommendations/guideRulesMerge.ts` — `mergeGuideRulesIntoRecommendations`  
- **Surface filter:** `src/lib/recommendations/filterRecommendationsByPageType.ts`  
- **Context bridge:** `src/lib/recommendations/legacyAdapter.ts` — `toRecommendationContext`  
- **Config:** `src/lib/scoringConfigLoader.ts` — `resolveGuideRulesForPageType`, `loadActiveScoringConfig`  
- **Legacy template entry:** `src/lib/recommendationFallback.ts` — `generateTemplateRecommendations`  

## Operational notes

- **Persistence:** Full `AnalysisResult` (including `recommendations`) may be cached or stored via `runAnalysis` / API — see pipeline docs and `src/lib/runAnalysis.ts`.  
- **Limited analysis:** Shorter trend template when `limitedAnalysis` is true; still deterministic.
