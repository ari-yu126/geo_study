# GEO Analyzer Project — System Philosophy and Architecture Rules

This project is a GEO (Generative Engine Optimization) analyzer. It evaluates how likely a page is to be cited, summarized, or recommended by AI systems.

This system is **not** a traditional SEO audit tool. It is an **AI citation / recommendation optimization** analyzer.

When modifying scoring, issue detection, or UI logic, follow the architecture and philosophy below.

---

## 1. Monthly GEO Configuration

The system uses a monthly AI-generated GEO configuration stored in **Supabase** (`geo_scoring_config`).

**Scope (important):** Monthly config **does not** define the **entire** scoring algorithm. It **tunes emphasis and strategy**—profile weights, issue/passed/opportunity seeds, query templates, optional blend alpha—while a **fixed engine** in code handles extraction, axis calculations, trust caps, commerce overrides, and citation fallbacks. See **`09-geo-research-policy.md`** → **Role of Monthly GEO Config** for the full split and summary table.

This configuration is the **primary source of truth** for:

- scoring weights (per-page-type profiles)  
- evaluation priorities  
- structure / answerability / trust rules (legacy + profile issue rules)  
- page-type profile weights  
- monthly GEO issue rules  
- optional **passed rules** and **opportunity templates** (GEO Explain seeds) when present in stored JSON  

Always load scoring configuration using the **active** `geo_scoring_config`. Fallback to `DEFAULT_SCORING_CONFIG` when missing.

Monthly GEO config drives **emphasis and explainability configuration**, but the system must remain **stable** if the config is incomplete.

---

## 2. Scoring Architecture (Important)

GEO scoring does **not** use one fixed formula.

The final score is computed through a **branch-based pipeline**:

**General flow:**

1. Load scoring config  
2. Detect page type (editorial / commerce / video)  
3. Compute partial scores: citation, paragraph quality, answerability, structure, trust, question coverage / match  
4. Apply page-type scoring branch: general web blend, commerce override, or YouTube/video pipeline  
5. Apply authority / AI citation caps or boosts  
6. Produce `finalScore`  

Do **not** implement scoring as a single static equation. Always respect page-type branching logic.

**Central idea:** GEO scoring is **not** a single formula. It is a **layered evaluation system** with **scoring**, **explanation**, and **strategy** layers: numeric blend and caps produce `finalScore`; the Explain layer turns signals into issues, strengths, and opportunities; recommendations add narrative guidance.

---

## 3. Page Type Scoring Logic

**General web pages:**  
Weighted blend of citation, paragraph, answerability, structure, trust, question coverage.

**Commerce pages:**  
Final score may override the general blend and prioritize:

- data density  
- structure  
- trust  
- product information quality  

**YouTube / video:**  
Use the dedicated video pipeline:

- description quality  
- chapters  
- video semantic analysis  
- question coverage  
- video profile weights  

---

## 4. Issue Detection Philosophy

Issues must be **explainable** and **stable**. Do **not** rely only on monthly AI-generated issue rules.

Issue rules follow a **layered model**:

```
finalIssueRules =
    coreMinimumRules
  + pageTypeBaseRules
  + monthlyGeoIssueRules
```

Where:

- **coreMinimumRules** — always present rules  
- **pageTypeBaseRules** — editorial / video / commerce base rules  
- **monthlyGeoIssueRules** — AI-generated monthly rules  

Monthly GEO rules should **extend** the system, not replace all issue rules.

If monthly config is missing `issueRules`, fallback to `DEFAULT_SCORING_CONFIG.issueRules`.

---

## 5. Product Philosophy

This tool is **not** an SEO error checker.

The system should explain:

- strengths  
- missing signals  
- weak signals  
- improvement opportunities  
- explainable issues  

The goal is to increase **AI citation and recommendation probability**, not just fix technical errors.

UI and analysis logic should focus on: **AI answerability**, **extractability**, **trust**, and **citation likelihood**.

**Terminology (Explain vs recommendations):**

- **Issues** — missing signals, weak signals, structural gaps, trust gaps (rule- and config-driven; categories such as missing_signals, weak_signals, structural, trust).  
- **Strengths** — strong GEO signals **already present** (passed checks / `geoExplain.passed`).  
- **Opportunities** — highest-impact, prioritized improvements (issue-linked, weak-axis, optional monthly templates).  
- **Recommendations** — narrative **strategy** guidance (action plans, headings, blocks) built on analysis, often LLM-generated with template fallback.

**Relationship (concise):** Issues **explain problems**; Strengths **explain what is already good**; Opportunities **explain what to do next**; Recommendations **explain how to do it**. Full diagram and definitions: **`10-scoring-issue-philosophy.md`** → section **Issues, Strengths, Opportunities, Recommendations**.

---

## 6. GEO Score Definition

GEO Score represents:

> The likelihood that an AI system will select, summarize, or cite this page as an answer source.

Scoring should reflect:

- extractable answers  
- structured information  
- trustworthy signals  
- question coverage  
- citation-worthy paragraphs  
- page-type specific signals  

---

## 7. Architecture Reminder

Do **not** describe GEO scoring as a single formula. It is a **pipeline**:

`config` → feature extraction → partial scores → page-type branch → monthly/fixed blend → trust cap / commerce override → `finalScore` → Explain engine (issues / strengths / opportunities) → recommendations → `AnalysisResult` → UI → persistence

Maintain this architecture when modifying code.

---

## 8. GEO System Architecture Layers

GEO is composed of **multiple layers**. Each layer has a distinct responsibility; together they approximate **AI citation and recommendation likelihood** plus **actionable guidance**.

1. **Monthly GEO config layer (Supabase)** — Active `geo_scoring_config`: profile weights, issue rules, optional passed rules and opportunity templates, query templates, blend alpha, etc. Extends but should not destabilize the product when incomplete.  
2. **Fixed scoring engine layer** — Stable weighting and rules in code (`DEFAULT_SCORING_CONFIG`, `geoScoreBlend` fixed weights) so behavior is predictable when monthly config is missing.  
3. **Axis score layer** — Partial scores (citation, paragraph, answerability, structure, trust, question match/coverage, video/commerce-specific signals) computed from extraction + rules + LLM.  
4. **Score blending layer** — `alpha × monthly + (1 − alpha) × fixed` on comparable axis scores; then trust caps; commerce/video branches as implemented in `runAnalysis.ts`.  
5. **Explain layer** — Issues, strengths (`passed`), opportunities; bridges numbers to human-readable diagnostics (`geoExplain.*`). Issues vs strengths vs opportunities vs recommendations: see **`10-scoring-issue-philosophy.md`** (Issues, Strengths, Opportunities, Recommendations).  
6. **Recommendation layer** — Narrative action plans (`generateGeoRecommendations` and templates).  
7. **UI layer** — Panel, overlay, exports; consumes `AnalysisResult` and derived audit state.

**Text flow diagram:**

```
URL input
  → Extraction
  → Axis scores
  → Monthly + fixed score blend (alpha)
  → Trust cap / commerce (or video path)
  → Final GEO score
  → Explain engine (issues / strengths / opportunities)
  → Recommendations
  → UI (panel + overlay)
```

---

## Quick reference — GEO Analyzer rules

- Monthly `geo_scoring_config` is the main scoring configuration.  
- Scoring is **branch-based** (general / commerce / video), not a single formula; monthly and fixed scores are **blended** with `scoreBlendAlpha`.  
- `finalScore` is computed after partial scores, hybrid blend, and trust caps (then commerce override when applicable).  
- The **Explain layer** surfaces issues, strengths, and opportunities after scoring.  
- Issues must use **layered rules**: core + page-type + monthly.  
- This is **not** an SEO audit tool; it is an **AI citation optimization** analyzer.  
- Focus on strengths, missing signals, weak signals, and explainable issues.  
- GEO score represents **AI citation / recommendation likelihood**.  

**Summary:** This system evaluates AI citation and recommendation likelihood, not traditional SEO ranking. Scoring is pipeline-based and page-type dependent, not a single universal formula; explanation and recommendations sit on top of that scoring stack.

GEO Analyzer is a layered evaluation system consisting of:
1. Monthly GEO strategy configuration
2. Fixed scoring engine
3. Axis score computation
4. Monthly vs fixed score blending
5. Explain layer (issues, strengths, opportunities)
6. Recommendation layer
7. UI visualization layer
