# 03 — Scoring System

This document describes how GEO scores are computed for different page families. It is an **architecture** document: GEO scoring is a multi-stage, branch-based pipeline—not a single universal percentage table. It explains why citation and extractability matter, how monthly configuration changes weights and rules, and how editorial, commerce, and video pages follow different scoring logic.

For **architecture and product philosophy** (monthly config, commerce/video branches, layered issues), see **`10-scoring-issue-philosophy.md`**.

## Scoring Philosophy

GEO scoring is designed to approximate how AI systems select, summarize, and cite content.

The system is driven by a **monthly AI-generated GEO configuration** stored in Supabase.
This configuration defines scoring weights, rule priorities, and page-type emphasis.

Important:  
**GEO scoring does not use one fixed universal formula.**  
The final score is computed through a branch-based pipeline depending on:

- page type (editorial / commerce / video)
- citation availability
- authority signals
- question coverage signals

The goal of GEO scoring is not traditional ranking,
but estimating **AI answer selection probability**.

Key principles:

- Citation likelihood is the primary signal  
- Structural and trust signals support extractability and credibility  
- Rule-based scoring and LLM-based scoring are combined  
- Page type influences scoring weights and overrides  

## Scoring Architecture Overview

The scoring pipeline follows this general flow:

1. Load active GEO scoring config from Supabase  
2. Detect page type (editorial / commerce / video)  
3. Compute partial scores:  
   - citation  
   - paragraph quality  
   - answerability  
   - structure  
   - trust  
   - question coverage / question match  
4. Apply page-type specific blending or overrides  
5. Apply caps / bonuses based on authority and AI citation evidence  
6. Produce `finalScore`  

Therefore, GEO scoring should be understood as a **multi-stage scoring system**, not a single equation.

## Hybrid Scoring Model (Monthly + Fixed Engine)

GEO **final score is not a single static formula**. For general web (non-commerce) paths, the system blends two scalar scores that both use the **same axis values** but **different weight vectors**:

- **MonthlyScore** — weights from the active `geo_scoring_config` profile (`profiles[pageType]` / `default`), normalized for the active axis set (7 axes when a citation path exists, otherwise 5 axes without citation/question coverage in the blend).
- **FixedScore** — weights from the **fixed engine** (`computeEngineFixedWeights7` / `computeEngineFixedWeights5` in `src/lib/geoScoreBlend.ts`), encoding stable product defaults.

**Blend alpha** (`scoreBlendAlpha` on `GeoScoringConfig`, clamped to `[0.05, 0.95]`; default constant when omitted) controls how much of the monthly profile vs. the fixed engine contributes:

```
FinalScore_preCap = round( alpha × MonthlyScore + (1 − alpha) × FixedScore )
```

Implementation: `blendMonthlyAndFixed` in `src/lib/geoScoreBlend.ts`. Alpha resolution: `resolveBlendAlpha`.

After this blend (and clamping to 0–100), **trust caps** apply (see below). **Commerce pages** then replace `finalScore` with a **commerce-specific** monthly/fixed blend over data-density–style signals (`computeCommerceMonthlyFinal` / `computeCommerceFixedFinal` in `geoScoreBlend.ts`). **Video** pages use a dedicated analysis path (metadata, Gemini, video profile weights) but follow the same architectural idea: config-driven emphasis + fixed behavior.

## Axis Score System

Axis scores are **partial scores (typically 0–100)** computed from features, rules, and (where applicable) LLM outputs. They are **combined with weights** only in the monthly/fixed blend step—not as a single global formula hardcoded in one place.

| Axis | Role |
|------|------|
| **citation** | Citation / chunk–level quality (Gemini where available); may be absent or bypassed when there is no citation path. |
| **paragraph** | Paragraph-level quality (length, density, patterns). |
| **density** | Information / data density (e.g. editorial data blocks); distinct from commerce **dataDensity** composite used in commerce branch. |
| **answerability** | Answer-oriented structure (first paragraph, quotable sentences, tables, etc.). |
| **structure** | Meta, headings, schema, canonical, OG, etc. |
| **trust** | Author, dates, contact, domain/search exposure, etc. |
| **questionMatch** | Alignment of page text with collected search questions. |
| **questionCoverage** | Coverage of search questions (where used in the 7-axis blend). |
| **Commerce dataDensity** (composite) | For `pageType === 'commerce'`, price/spec/card signals feed a **data density quality** score blended with structure and boosted trust—not always identical to editorial `density`. |
| **videoMetadata** | YouTube / video: title, description, chapters, metadata-oriented signals; used in the video pipeline and explainability (`axisScores.videoMetadata`). |

Axis scores are computed first; **weights** (monthly vs fixed) are applied second. See `runAnalysis.ts` and `geoScoreBlend.ts`.

## Axis Definitions

The following sections are **conceptual**: they describe what each axis is meant to capture and why it supports GEO. They are **not** exact formulas or implementation details.

### Citation

**What it measures:** How likely the page’s content is to be **selected, quoted, or cited** by an AI system when answering questions—based on chunk-level or semantic “citation-worthiness” (often LLM-assisted), not only keyword density.

**Why it matters:** Generative engines prioritize **extractable, attributable** passages. If citation is weak, the page may rank well for humans but still fail as a **source** in AI answers.

**Typical signals:** Semantically rich paragraph chunks; alignment with real questions; concrete facts and numbers; absence of thin or boilerplate-only blocks (when available, LLM-based evaluation).

**Examples of strong / weak pages:** Strong: long-form articles with quotable facts and clear topical focus. Weak: thin affiliate pages or generic category text with little unique, citable substance.

---

### Paragraph

**What it measures:** **Readability and paragraph-level quality** for extraction: length bands, definition patterns, density, duplication, and whether paragraphs look like “answer units” rather than noise.

**Why it matters:** Models often **segment or quote** at paragraph granularity. Poor paragraph structure makes extraction and summarization unreliable.

**Typical signals:** Ideal length ranges; presence of definitional or explanatory patterns; information density vs fluff; repetition across paragraphs.

**Examples of strong / weak pages:** Strong: well-scoped paragraphs with one clear idea each. Weak: walls of undifferentiated text or repeated boilerplate.

---

### Density

**What it measures:** **Information density** in editorial-style content: how much **signal per unit of text**—e.g. numeric facts, units, specs, or data-like blocks embedded in prose (distinct from the commerce **dataDensity** composite below).

**Why it matters:** Dense, factual content gives models **more to cite** in fewer tokens and reduces “empty” answers.

**Typical signals:** Counts of data-rich blocks; numeric patterns; structured lists or mini-specs inside the body (as rules define them).

**Examples of strong / weak pages:** Strong: reviews or guides with measurements, comparisons, and specifics. Weak: vague marketing copy with few concrete details.

---

### Answerability

**What it measures:** How well the page is structured **for direct answers**: first-screen value, quotable sentences, tables/lists, and patterns that match “question → answer” use cases.

**Why it matters:** AI systems favor pages that **answer user intent** in extractable form without heavy rewriting.

**Typical signals:** First paragraph quality; quotable sentences; tables/lists; step-by-step or FAQ-like patterns; minimum content depth where rules apply.

**Examples of strong / weak pages:** Strong: FAQ sections, How-to with clear steps, comparison tables. Weak: narrative-only pages with no scannable takeaways.

---

### Structure

**What it measures:** **Technical and semantic structure** of the page: titles, meta, heading hierarchy, canonical/OG, and structured data that help machines **understand scope and boundaries**.

**Why it matters:** Structure improves **parsing, chunking, and entity understanding**—without it, even good prose may be under-indexed for AI.

**Typical signals:** Title and meta description; H1/H2/H3 usage; canonical and OG tags; JSON-LD / FAQ schema where relevant.

**Examples of strong / weak pages:** Strong: clear H1, logical H2s, valid meta and schema. Weak: missing or duplicate titles, flat headings, no machine-readable hints.

---

### Trust

**What it measures:** **Credibility and accountability signals**: authorship, dates, contact/about, domain reputation proxies, and (where available) evidence **that the domain is trusted or cited in real AI/search contexts**.

**Why it matters:** Models and users both avoid citing **unverified** or **unattributable** sources; trust is a separate axis from “good writing.”

**Typical signals:** Author bylines; publish/modify dates; contact and about links; domain authority / search exposure / AI-citation evidence as implemented in the pipeline.

**Examples of strong / weak pages:** Strong: named authors, visible dates, institutional pages. Weak: anonymous posts, no dates, no way to verify the source.

---

### Question match

**What it measures:** How well the **page text aligns** with **real search questions** collected for the topic (wording and intent overlap), not just keyword presence.

**Why it matters:** GEO targets **questions people actually ask**; mismatch means the page is less likely to be retrieved or cited for those questions.

**Typical signals:** Similarity or coverage between page content and question strings; relevance filtering outputs from the question pipeline.

**Examples of strong / weak pages:** Strong: a page that answers the exact angles of collected questions. Weak: on-topic but off-angle content that misses the question phrasing.

---

### Question coverage

**What it measures:** How many of the **collected questions** are **addressed** by the page (breadth of coverage), not only how well one question matches.

**Why it matters:** Broad coverage increases the chance of being selected for **multiple** user queries in the same topic cluster.

**Typical signals:** Fraction or count of questions with evidence in the body; overlap with headings and paragraphs.

**Examples of strong / weak pages:** Strong: pillar pages covering many sub-questions. Weak: narrow pages that only answer one angle.

---

### Commerce dataDensity (commerce pages)

**What it measures:** A **commerce-specific** composite of **product-data quality**: price confidence, spec richness, list/card consistency, and related signals—used in the **commerce branch** to score how well a page supports **shopping and comparison** answers.

**Why it matters:** For commerce, AI systems need **comparable, verifiable product facts** (price, specs, shipping) more than long-form narrative citation.

**Typical signals:** Price visibility; product schema; spec tables; repeated product cards on listing pages; OG product hints; trust boosts from commerce-oriented rules.

**Examples of strong / weak pages:** Strong: PDP with clear price, specs, and policy snippets. Weak: vague listings without price or structured attributes.

---

### Video metadata (video pages)

**What it measures:** **Video-side surfaces** models actually use: title, description, chapters/timestamps, and semantic quality of metadata—**not** full HTML page SEO alone.

**Why it matters:** For YouTube-style URLs, **description and metadata** are the primary extractable surface for citation; weak metadata limits AI usefulness even if the video is good.

**Typical signals:** Title clarity and keyword relevance; description length and information density; **chapters** or timestamps; alignment with search questions and (where used) Gemini-style video evaluation.

**Examples of strong / weak pages:** Strong: keyword-rich title, dense description, chapter markers. Weak: title-only or empty description, no navigable structure for models.

---

## Final Score Calculation Flow

Order of operations for the **general web** branch (conceptual; commerce/video branches replace or extend steps as in code):

1. **Axis scores calculated** — citation (if path), paragraph, answerability, structure, trust, question match, question coverage; plus any adjustments (e.g. structure mitigation, FAQ boosts).
2. **Monthly weighted score** — same axes × **monthly** normalized weights from the active profile.
3. **Fixed weighted score** — same axes × **engine** normalized weights.
4. **Blend with alpha** — `FinalScore_preCap = blendMonthlyAndFixed(monthlyScore, fixedScore, alpha)`.
5. **Trust cap** — upper bound on `finalScore` unless strong trust/citation evidence (see next section).
6. **Commerce override** (if `pageType === 'commerce'`) — `finalScore` overwritten by commerce monthly/fixed blend over data density + structure + commerce trust.
7. **Final GEO score** — value exposed as `scores.finalScore` (and related debug: `scoreBlendDebug`).

Video runs its own pipeline but still feeds **profiles.video** weights and produces scores consumed by the UI and Explain layer.

## Trust Cap

High scores should not imply “AI-trustworthy” without evidence. After the monthly/fixed blend, a **trust cap** can limit `finalScore`:

- **No cap** — `hasDomainAuthority` **or** `hasActualAiCitation`: evidence supports high scores entering the 80+ range.
- **`max_79`** — only **search exposure** (`hasSearchExposure`) without domain authority or proven AI citation: cap at **79** (distinguishes SEO visibility from AI-citation-grade trust).
- **`max_70`** — neither search exposure nor the above: cap at **70**.

This keeps the headline GEO score aligned with **explainable trust**, not only on-page quality. Implemented in `runAnalysis.ts` (trust cap band: `none` | `max_79` | `max_70`).

## Monthly vs Fixed vs Hybrid Components

| Component | Monthly-driven | Fixed / engine | Hybrid |
|-----------|----------------|----------------|--------|
| Profile weights (`profiles.*.weights`) | Primary | — | Blended with fixed weights via `alpha` |
| `scoreBlendAlpha` | Optional in config | Default constant if omitted | Defines hybrid mix |
| Axis **values** (citation, paragraph, …) | — | Computed by deterministic + LLM rules in code | Same axes feed both blends |
| Issue rules (`issueRules`) | Supabase / monthly extends defaults | `DEFAULT_SCORING_CONFIG.issueRules` | Layered: monthly + defaults |
| Passed rules / opportunity templates (`passedRules`, `opportunityTemplates`) | Optional in `geo_scoring_config` | Code engines + defaults when missing | Seeds merged into Explain |
| Commerce `finalScore` | Commerce profile weights in `computeCommerceMonthlyFinal` | Fixed commerce mix in `computeCommerceFixedFinal` | `blendMonthlyAndFixed` on commerce scalars |
| Trust cap thresholds | — | Fixed policy in code | Applied after blend |
| YouTube passed-check rules | Optional in config | `youtubePassedCheckRules` defaults | Video UI / passed engine |

## A. General web pages

| Axis | How it's computed | Typical weight |
|---|---|---|
| citationScore | Gemini chunk scoring + authority/data adjustments | ~45% |
| paragraphScore | paragraphStats: definition ratio, ideal length, infoDensity | ~10% |
| answerabilityScore | Rule-based: first paragraph, quotable sentences, tables | ~15% |
| structureScore | Title / Description / H1/H2 / OG / Canonical / Schema | 5–15% |
| trustScore | author, publish/modified dates, contact/about links | 5–15% |
| questionCoverage / match | Tavily question coverage and text matching | varies |

### Notes

- `citationScore` is the dominant signal.  
- If citation signals are weak or unavailable, weights shift toward structure, answerability, and trust.  
- Authority signals and real AI citations may increase score ceilings.  

## B. YouTube (video)

YouTube pages use a dedicated pipeline aligned with how models use **video metadata** (not full page HTML) as a source:

- metadata-based analysis (title, description, chapters)  
- Gemini-based semantic scoring  
- information density from description  
- search question coverage  
- recommendation / comparison signals in description  

This pipeline differs from standard HTML-based analysis and uses **video-specific weights** from the active GEO profile when present (`profiles.video` / `profiles.video.weights` in `GeoScoringConfig`, typically from Supabase `geo_scoring_config`). The emphasis is still on **what an AI can extract and cite** from title and description, not on classic on-page SEO alone.

## C. Commerce / e-commerce

Commerce pages prioritize **data density, structure, and trust** over editorial-style citation signals.

Key signals:

- product schema (JSON-LD)  
- price visibility  
- spec tables  
- shipping / returns / warranty information  
- review summaries  
- comparison information  

Typical weighting:

- dataDensity / commerceScore: ~40%  
- structureScore: ~30%  
- trustScore: ~20%  
- answerabilityScore: ~10–15%  

Note:

Commerce pages may override the general scoring blend and use a commerce-specific formula.  
`citationScore` is still considered, but usually has lower influence than product data quality.

## Scoring Components

- **LLM-based scoring**  
  - `citationScore` (Gemini-based evaluation)  

- **Rule-based scoring**  
  - `paragraphScore`  
  - `answerabilityScore`  
  - `structureScore`  
  - `trustScore`  

## Final Score Calculation

The final GEO score is **not computed using one fixed formula**.

At a high level, partial axis scores feed a **hybrid** monthly vs. fixed blend (`alpha`), then **trust caps**, then optional **commerce** replacement of `finalScore`. See **Hybrid Scoring Model**, **Axis Score System**, and **Final Score Calculation Flow** above.

Legacy intuition still holds: blends vary by page type, citation availability, authority / AI citation evidence, commerce override, and video pipeline.

In shorthand (editorial-like path before caps):

```
FinalScore_preCap ≈ alpha × MonthlyScore(axes) + (1 − alpha) × FixedScore(axes)
```

Weights and blending logic are defined in:

- `src/lib/geoScoreBlend.ts` (blend, monthly/fixed weights, commerce finals)  
- `src/lib/defaultScoringConfig.ts`  
- Supabase `geo_scoring_config` (loaded via `src/lib/scoringConfigLoader.ts`)  
- `src/lib/runAnalysis.ts`  

### Example (illustrative only)

The numeric blend below shows **one possible** editorial-style weighting. Actual `finalScore` depends on the active profile, branch, and config—it is **not** guaranteed to be a single weighted sum in every path.

- citationScore = 70 (weight ~45%)  
- paragraphScore = 60 (weight ~10%)  
- answerabilityScore = 50 (weight ~15%)  
- structureScore = 80 (weight ~15%)  
- trustScore = 70 (weight ~15%)  

Example blend:  
70×0.45 + 60×0.10 + 50×0.15 + 80×0.15 + 70×0.15  
= 31.5 + 6 + 7.5 + 12 + 10.5 = 67.5 → ~68  

(Weights and values are illustrative; see `defaultScoringConfig.ts`, `geo_scoring_config`, and `runAnalysis.ts` for real behavior.)

## Operational notes

- **Persistence:** analysis outputs (scores/results) are persisted/upserted to Supabase (`analysis_history`) as part of the pipeline for caching and audit.  
- **LLM/quota handling:** LLM errors and quota (429) are handled by the retry layer; 429/quota cases cause immediate fallback and cooldown (see `src/lib/geminiRetry.ts` and `src/lib/llmError.ts`).  
- **Related files:** scoring defaults (`src/lib/defaultScoringConfig.ts`), runtime loader (`src/lib/scoringConfigLoader.ts`).

## Key Principle

GEO Score represents:

> The likelihood that an AI system will select, summarize, or cite this page as an answer source.

Therefore, GEO scoring emphasizes:

- extractable answers  
- structured information  
- trustworthy signals  
- coverage of real search questions  
- citation-worthy paragraphs  
