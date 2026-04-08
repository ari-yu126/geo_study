# 04 — Recommendation System

This document describes the Recommendation Engine: inputs, decision logic, rules, Gemini usage, fallback, and output schema.

## Overview
- Purpose: Produce actionable, prioritized content and metadata recommendations that improve AI citation likelihood and user answerability.  
- Distinct from scoring: scoring analyzes & measures; recommendation prescribes actions.

## Inputs
- pageType (editorial | video | commerce)  
- pageSignals (structureScore, descriptionLength, commerceScore, dataDensity, authority signals, detectedTopic, etc.)  
- uncoveredQuestions (SearchQuestion[])  
- currentIssues (AuditIssue[])  
- detectedTopic (string)

## PageSignals Definition

pageSignals is a structured summary of the analyzed page used for decision-making in the recommendation engine.

### Example pageSignals

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

## Decision logic
- Branch by pageType:
  - commerce → Conversion via Trust
  - video → Knowledge Base Formation
  - editorial → further subtype (listicle vs single review)
- Editorial subtype handling:
  - listicle → recommend comparison tables, ranked lists, "best-for" categories
  - single review → recommend pros/cons, verdict; avoid full comparison tables

## Editorial subtype detection

Subtype is determined using pageSignals:

- singleReview:
  - repeatedProductCardCount <= 1
  - reviewLike = true
  - hasReviewSchema = true

- listicle:
  - repeatedProductCardCount >= 3
  - listCount >= 3 (or configurable threshold)
  - contains "best / top / 추천" patterns

## Strategy rules
- commerce: price transparency, structured spec tables, FAQ (shipping/returns/AS), policy clarity  
- video: chapters, pinned summary, FAQ in description, excerpt blocks for AI citation  
- editorial/listicle: structured comparisons, category recommendations, extraction tables  
- editorial/single review: pros/cons, best-for, final verdict, pseudo-comparisons vs category averages

### Topic Injection Rule

All recommended headings must include detectedTopic when applicable.

Example:
- ❌ "Pros and Cons"
- ✅ "Bellissima Travel Dryer Pros and Cons"

## Special rule (single product review)
- DO NOT recommend full product-comparison tables. Prioritize pros/cons, best-for, verdict, and a short pseudo-comparison contextualized to category averages.

## Gemini usage
- Single API call per analysis: Gemini used only to phrase/prioritize the local recommendation skeleton.  
- Gemini must return strict JSON only (no markdown).  
- The engine builds the skeleton locally then sends structured CONTEXT + internal policy note. Gemini outputs final phrasing/prioritization.

## Fallback logic
- If Gemini is skipped (cooldown, limitedAnalysis, weak signals) or fails, return template-based recommendations (localRecommendation.isTemplateFallback = true).

## Rate limit handling
- 429/quota errors: do not retry; set short cooldown and return template fallback.  
- Non-429 transient errors: retry with limited backoff.

## Output JSON schema
```json
{
  "strategySummary": "string",
  "contentGap": "string",
  "recommendedHeadings": ["string"],
  "copyPasteTemplates": ["string"],
  "recommendations": [
    {
      "title": "string",
      "reason": "string",
      "impact": "High|Medium|Low",
      "relatedSignals": ["signalName"]
    }
  ]
}
```

Implementation: `src/lib/recommendationEngine.ts`.

## Operational notes
- 429 / quota: Gemini 429 responses trigger immediate fallback (no retry) and set a short cooldown; recommendations should use template fallback until cooldown expires. See `src/lib/geminiRetry.ts` and `src/lib/llmError.ts`.  
- limitedAnalysis / short_html: when analysis is limited (bot protection or very short HTML), the engine may skip Gemini and return template-based recommendations. (`isTemplateFallback` flag)  
- persistence: analysis results (and recommendations) are stored/upserted to Supabase for caching/audit; see pipeline docs and `src/lib/runAnalysis.ts`.
