# GEO Research Source Policy

## Overview

The GEO (Generative Engine Optimization) scoring model must be based on reliable and explainable research sources. To ensure consistency and credibility, GEO criteria are generated using a weighted mix of academic research, official documentation, and industry/trend sources.

This policy defines how research sources are prioritized when generating GEO scoring configurations.

## Research Source Priority

The GEO model should follow an academic-first research strategy:

1. Academic Research (primary foundation)
2. Official Documentation and Standards
3. Authority Industry Sources
4. Trend and Web Research (supplement only)

## Recommended Weight Distribution

The GEO research input should approximately follow this weighting:

| Source Type | Purpose | Weight |
|-------------|---------|--------|
| Academic Papers | Core ranking and citation theory, IR, RAG, semantic search | 60% |
| Official Docs / Standards | Structured data, search engine guidelines, platform docs | 30% |
| Industry / Trend / Web Research | Emerging GEO trends, SEO practices, user search behavior | 10% |

This distribution is not strict but should guide how research sources are selected and summarized.

## Per-page-type weighting (monthly `geo_scoring_config`)

When generating scoring **profiles** (editorial / video / commerce), the same raw sources are allocated with **profile-specific** mixes. Implementation: `GEO_CRITERIA_PAGE_TYPE_RESEARCH_WEIGHTS` in `src/lib/geoCriteriaResearch/pageTypeResearchWeights.ts`; Gemini receives **separate truncated corpora** per profile via `formatPageTypeWeightedResearchForGemini` (academic-first; official and industry share the “official+authority” budget by relative length).

| Profile | Academic | Official + authority industry | Trend |
|---------|----------|----------------------------------|-------|
| editorial | 60% | 30% | 10% |
| commerce | 50% | 40% | 10% |
| video | 50% | 40% | 10% |

The **default** profile uses the same mix as **editorial** unless the model justifies a neutral blend.

## Source Type Definitions

### Academic Sources

Examples:

- Information Retrieval papers
- Search engine ranking research
- Citation analysis papers
- Semantic search / RAG papers
- arXiv / Semantic Scholar / OpenAlex papers
- HCI / QA / Knowledge retrieval research

These sources define the theoretical foundation of GEO scoring.

### Official Documentation

Examples:

- Google Search Central
- Schema.org
- W3C
- Platform developer documentation
- Official AI platform documentation

These sources define technical implementation and structured data best practices.

### Authority Industry Sources

Examples:

- Search Engine Journal
- Ahrefs
- Moz
- Semrush
- McKinsey
- Bain
- Nielsen
- Large research reports

These sources define industry practices and applied SEO/GEO strategies.

### Trend / Web Research

Examples:

- Tavily search results
- Blog posts
- Recent GEO discussions
- AI search changes
- Emerging practices

These sources should be used only as trend signals, not as primary GEO criteria.

## GEO Criteria Generation Philosophy

When generating GEO scoring criteria:

- Academic research defines **why** ranking and citation happen.
- Official documentation defines **how** content should be structured.
- Industry sources define **what** works in practice.
- Trend research defines **what is changing** recently.

In short:

- Academic → Foundation
- Official → Implementation
- Industry → Practical Strategy
- Trend → Adjustment

## GEO System Knowledge Pipeline

The GEO system should follow this knowledge pipeline:

```text
Research Sources
    ↓
reference_sources (database)
    ↓
LLM generates GEO scoring model
    ↓
geo_scoring_config
    ↓
Page analysis
    ↓
geo_analysis_results
```

This ensures the GEO scoring system is research-based, explainable, and version-controlled.

## Role of Monthly GEO Config

The **monthly GEO configuration** (`geo_scoring_config` in Supabase, produced from research + LLM generation) is **not** a complete definition of the scoring algorithm. The application **always** runs a **fixed engine** in code: extraction, axis math, caps, and branch logic. Monthly config **adjusts evaluation emphasis and strategy**—what to weight more, which rules to surface, and which explainability seeds to prefer—without replacing that engine.

**In practice, monthly config typically controls:**

- **Profile weights** — per page-type emphasis (`profiles.editorial` / `commerce` / `video` / `default`)  
- **`issueRules`** — declarative issue definitions merged with defaults (layered model)  
- **`passedRules`** — optional declarative “strength” checks (GEO Explain)  
- **`opportunityTemplates`** — optional seeds for the opportunity engine  
- **`queryTemplates`** — Tavily / search-question collection phrasing (`{keyword}` patterns)  
- **`scoreBlendAlpha`** — optional blend between **monthly** weighted score and **fixed** engine weighted score (clamped in code when present)  

Missing or incomplete monthly rows still work: the loader falls back to `DEFAULT_SCORING_CONFIG` so behavior stays **stable**.

### Separation: Fixed engine vs monthly config

**Fixed engine (code):**

- HTML/metadata **extraction** and headless fallbacks  
- **Axis score calculations** (citation, paragraph, answerability, structure, trust, question match/coverage, video/commerce-specific signals)  
- **Trust cap** bands (`max_79` / `max_70` / none)  
- **Commerce** final-score override path and commerce composites  
- **Citation** fallback / quota / degraded paths when LLM output is unavailable  
- Default weighting used when monthly weights are absent; normalization and blend mechanics  

**Monthly config:**

- **What to emphasize** — relative importance of axes via profile weights and blend alpha  
- **Which issues matter more** — issue rule sets and priorities for the Explain layer  
- **What strengths to highlight** — optional `passedRules` aligned with monthly strategy  
- **Which opportunities to prioritize** — optional `opportunityTemplates`  
- **How to phrase discovery** — `queryTemplates` for question harvesting  

Think of monthly config as **strategy and tuning** layered on a **deterministic + fixed-default** runtime—not as a script that reimplements scoring from scratch.

### Component ownership (summary)

| Component | Monthly / Fixed / Hybrid |
|-----------|---------------------------|
| Profile weights (`profiles.*.weights`) | **Monthly** (with defaults when omitted) |
| `issueRules` / `passedRules` / `opportunityTemplates` | **Hybrid** — monthly extends; **fixed** defaults in `DEFAULT_SCORING_CONFIG` |
| `queryTemplates` | **Monthly** (per profile; empty fallbacks in code paths) |
| `scoreBlendAlpha` | **Hybrid** — optional in monthly config; **fixed** default constant if unset |
| Extraction, chunking, paragraph/trust rules execution | **Fixed** |
| Axis score formulas (per-axis computation) | **Fixed** |
| Trust cap policy | **Fixed** |
| Commerce override structure | **Fixed** (weights inside commerce blend can be **monthly**-informed) |
| Monthly vs fixed **scalar blend** of scores | **Hybrid** — uses monthly profile + fixed engine weights + optional alpha |

For blend mechanics and trust caps, see **`03-scoring-system.md`**. For pipeline order, see **`05-pipeline.md`**.

## Summary

The GEO scoring model must follow an academic-first, documentation-supported, trend-adjusted research strategy.

**Priority order:**

```text
Academic Research
    → Official Documentation
        → Authority Industry Sources
            → Trend / Web Research
```

This policy ensures the GEO system remains stable, explainable, and aligned with real AI search behavior.
