# 10 — GEO Analyzer Scoring & Issue System Philosophy

## Monthly configuration as source of truth

This project uses a **monthly AI-generated GEO configuration** stored in Supabase (`geo_scoring_config`). That monthly config is the **primary source of truth** for:

- scoring profiles  
- weights  
- structure / answerability / trust rule sets  
- issue rule priorities  
- page-type emphasis for editorial / commerce / video  

See also: `09-geo-research-policy.md` (how that config is researched), `03-scoring-system.md` (mechanics), `12-issue-system-page-type-rules.md` (issues vs score axes and impact rules).

---

## Branch-specific scoring (not a single static formula)

**Final GEO scoring is not one fixed formula.** The application uses **branch-specific** scoring logic depending on **page type** and **signal availability** (citation present, chunk quality, commerce, video, etc.).

### 1. Shared config loading

- Always load the **active** `geo_scoring_config` from Supabase.  
- **Fallback** to `DEFAULT_SCORING_CONFIG` when missing or incomplete.  
- This config provides `structureRules`, `answerabilityRules`, `trustRules`, and **profile weights** (`profiles`).

Implementation: `src/lib/scoringConfigLoader.ts`, `src/lib/defaultScoringConfig.ts`.

### 2. General web analysis

`runAnalysis` computes partial scores for:

- **citation** — Gemini chunk evaluation (plus documented floors/bonuses for data/authority/FAQ, etc.)  
- **paragraph quality** — paragraph stats → score  
- **structure** — rule-based from config  
- **answerability** — rule-based from config  
- **trust** — rule-based from config  
- **question coverage / question match** — Tavily search questions vs page content  

**`finalScore`** is a **weighted blend** of these signals. Weighting **changes** depending on:

- whether **`citationScore` is available / meaningful**  
- **strong citation chunk quality** (dynamic adjustment of citation vs structure/trust weights)  
- **commerce**, **FAQ-like**, and **trust caps** as implemented in `runAnalysis.ts`  

### 3. Commerce override

If `pageType === 'commerce'`, **`finalScore` is overridden** by a **commerce-specific** blend. Commerce scoring is primarily driven by:

- **data density** (price/spec/card signals)  
- **structure**  
- **trust** (including schema/OG boosts as coded)  

### 4. YouTube / video pipeline

- YouTube uses a **dedicated pipeline** (not the same path as generic HTML).  
- **`finalScore`** is derived from description quality, video analysis, search question coverage, and **video profile weights**.  
- Use **`profiles.video.weights`** when present; otherwise **fallback defaults** in code (`geminiVideoAnalysis.ts` / related).

---

## Issue detection philosophy

Monthly GEO config should influence **both scores and issues**. However, **issues must remain explainable and stable** even if the monthly config is incomplete.

### Layered issue model (target architecture)

Issue detection should follow this **layered** model:

1. **Core minimum issue rules** — safety net for explainability  
2. **Page-type base issue rules** — structural relevance (editorial vs commerce vs video)  
3. **Monthly GEO issue rules** — emphasis from `geo_scoring_config`  

Conceptually:

```text
finalIssueRules =
    coreMinimumRules
  + pageTypeBaseRules
  + monthlyGeoIssueRules
```

**Important:**

- **Monthly config** drives the main GEO logic.  
- **Core rules** are a **safety net** so the analyzer always has explainable findings.  
- **Page-type base rules** ensure **structural relevance**.  
- **Monthly rules** extend or shift emphasis; they should **not** leave the analyzer with **near-zero explainable issues** when the page is weak.  

Current implementation merges config-driven `issueRules` with defaults in `issueDetector.ts`; evolving toward explicit core + page-type + monthly layers is a **product direction** aligned with this document.

---

## Product philosophy

This is **not only an SEO audit tool**. It is an **AI citation / recommendation optimization** analyzer.

The UI and logic should emphasize:

- **strengths**  
- **missing signals**  
- **weak signals**  
- **improvement opportunities**  
- **explainable issues**  

—not only raw “errors”.

Passed checks, recommendations, and issue copy should reinforce **actionable GEO improvement**, not checklist-only scoring.

---

## Issues, Strengths, Opportunities, Recommendations

These four concepts form a **chain of explanation** from raw signals to user-facing strategy. They are **not** interchangeable: each answers a different question.

### Roles

**Issues**

- **Missing or weak GEO signals** — gaps that hurt answerability, extractability, trust, or citation likelihood.  
- Things that **reduce GEO score** or **reduce the chance** an AI will select or cite the page.  
- **Explain problems** — what is wrong, thin, or risky from a GEO perspective.

**Strengths (Passed)**

- **Strong GEO signals already present** — what the page is doing well *today*.  
- **Positive signals** that support AI citation (clear structure, quotable content, trust markers, etc., as detected by rules and engines).  
- **Explain what is already good** — balance for the user; avoids an “only errors” mindset.

**Opportunities**

- **Highest-impact improvements** — prioritized, usually **derived from issues**, weak axis scores, and (optionally) monthly **opportunity templates**.  
- **Action-oriented** — concrete levers (e.g. add a table, clarify the opening, add schema).  
- **Explain what to do next** — not full prose strategy, but **what** to change first.

**Recommendations**

- **Narrative strategy** — human-readable guidance: suggested headings, blocks, tone, sequencing.  
- **Built on top of** opportunities, axis analysis, and page context using **deterministic** rules, locale templates, and optional monthly **`guideRules`** (no LLM in `generateGeoRecommendations`).  
- **Explain how to do it** — turning opportunities into a **coherent plan** the user can follow.

### Relationship diagram

Conceptual flow (architecture, not a single function call):

```text
Axis scores  →  Issues & Strengths  →  Opportunities  →  Recommendations
     │                    │                    │                    │
     │                    │                    │                    └─ How (strategy, wording, structure)
     │                    │                    └─ What next (prioritized actions)
     │                    └─ Diagnosis: bad vs good (problems vs passed signals)
     └─ Numeric / rule inputs from extraction + scoring
```

- **Issues** and **Strengths** both interpret the same underlying axes and rules: one highlights **deficits**, the other **surpluses**.  
- **Opportunities** sit **after** diagnosis: they synthesize **where to invest** for maximum GEO lift.  
- **Recommendations** sit **last**: they add **narrative** and **ordering** so the user knows how to implement opportunities in practice.

### One-line distinction

| Concept | Answers |
|--------|---------|
| Issues | **What’s wrong?** |
| Strengths (Passed) | **What’s already working?** |
| Opportunities | **What should we do next?** |
| Recommendations | **How should we do it?** |

### Implementation note (philosophy only)

In code, issues and strengths surface through the **Explain layer** (`geoExplain.issues`, `geoExplain.passed`); opportunities through **`geoExplain.opportunities`** and related engines; recommendations through **`generateGeoRecommendations`** and templates. The **logical** relationship above holds even when payloads are merged or derived on client vs server—see also `05-pipeline.md` and `11-system-philosophy-and-architecture-rules.md`.
