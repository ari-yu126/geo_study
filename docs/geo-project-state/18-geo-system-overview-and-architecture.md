# 18 — GEO System Overview & Architecture

This document provides a **complete system-level view** of the GEO Analyzer: **architecture layers**, **data flow**, and **component responsibilities** at product and platform scale.

It is an **umbrella** document that ties together scoring, explanation, comparison, interpretation, and reporting. For a shorter entry point, see **`00-system-overview.md`**. For non-negotiable rules, see **`11-system-philosophy-and-architecture-rules.md`** and **`13-system-invariants.md`**.

**No code or formulas** appear here—only architecture and responsibilities.

---

## 1. What GEO Analyzer is

**GEO Analyzer** is a system for evaluating how likely a **web page** is to be **selected, summarized, or cited as a source** by **AI search and answer engines** (generative search, assistants, and similar surfaces)—not for ranking pages the way traditional SEO tools optimize for blue links alone.

The system combines:

- **Measurement** — partial scores and a headline GEO score aligned with citation-oriented signals.  
- **Diagnosis** — issues, strengths, and opportunities.  
- **Strategy** — recommendations and action plans.  
- **Context** — optional comparison to peers and AI-cited references, plus human-readable interpretation and structured reports.

---

## 2. High-level system flow

End-to-end, conceptual order:

```text
URL
  → Analysis (extraction + signals)
  → Axis scores
  → Score blending
  → GEO score (headline)
  → Explain layer (issues, strengths, opportunities)
  → Recommendation layer
  → [Optional] Competitor comparison (multi-URL aggregation)
  → Score interpretation (semantic framing for users)
  → GEO report (structured synthesis)
  → Presentation layer (UI / exports such as PPT / API)
```

**Notes:**

- **Single-URL** runs execute through **Analysis → … → Recommendations** for that URL.  
- **Competitor comparison** requires **multiple URLs** analyzed with the **same pipeline**; it **aggregates** results and produces relative deltas. It may run **after** per-URL recommendations are available, or in parallel once all analyses complete—product choice.  
- **Interpretation** and **GEO report** are **semantic and packaging layers**: they do not replace scoring logic; they **translate** outputs for decisions.

---

## 3. System layers

| Layer | Responsibility |
|--------|----------------|
| **Monthly GEO configuration** | Active **`geo_scoring_config`** (e.g. Supabase): weights, blend emphasis, issue/passed/opportunity templates, query seeds, monthly strategy. **Tunes** behavior without replacing the whole pipeline. |
| **Analysis / extraction** | Fetch and parse HTML (or video/commerce paths); extract paragraphs, metadata, chunks, trust and search signals; page-type detection. **Feeds** all downstream scoring. |
| **Axis scoring** | Computes **partial scores** (citation, paragraph, answerability, structure, trust, question match/coverage, density; commerce/video composites when applicable). **Raw material** for blending. |
| **Score blending** | Combines **monthly profile** and **fixed engine** behavior per page type; applies **trust caps** and **branch rules** (editorial/commerce/video). **Produces** headline **GEO score**. |
| **Explain layer** | Emits **issues** (gaps), **strengths** (passed), **opportunities** from rules and axis context. **Diagnoses** why scores look the way they do. |
| **Recommendation layer** | Turns signals and opportunities into **narrative strategy** (templates, LLM where policy allows). **Prioritizes** direction of travel. |
| **Competitor comparison layer** | Optional **multi-URL** layer: aligns **scores** and **explain outputs** across a set; **relative** deltas, rankings, and contrast views. See **`15-geo-competitor-comparison-system.md`**. |
| **Score interpretation layer** | Maps numbers to **bands**, **categories**, and **language** (citation likelihood framing, competitiveness). See **`16-geo-score-interpretation-model.md`**. Does **not** replace numeric scores. |
| **GEO report layer** | **Structured synthesis**: summary, axes, issues/strengths/opportunities, comparison (if any), recommendations, action plan. See **`17-geo-report-system.md`**. |
| **Presentation layer** | **UI** (audit panel, dashboard), **exports** (e.g. presentations), **API** responses—**delivery** of the same analysis/report model to different channels. |

**Axis importance** (how strongly each signal family should matter in product reasoning) is documented in **`14-axis-importance-and-weight-philosophy.md`**; it **informs** interpretation and reporting, not a separate runtime engine.

---

## 4. Data flow

Conceptual path from **input** to **final output**:

1. **Input** — URL (+ optional query, market, comparison list).  
2. **Extraction** — Structured content and signals.  
3. **Axis scores** — Partial metrics per dimension.  
4. **Blending** — Headline GEO score + branch-specific outcomes.  
5. **Explain artifacts** — Issues, passed, opportunities linked to axes and rules.  
6. **Recommendations** — Strategy text / structured next steps tied to opportunities.  
7. **If multi-URL** — **Comparison** merges **per-URL** results into **deltas** and **relative** summaries.  
8. **Interpretation** — Bands, categories, and copy-safe framing for stakeholders.  
9. **GEO report** — Single document or payload combining the above for **human consumption**.  
10. **Presentation** — Rendered in UI, returned via API, or exported.

Data is **immutable** at each stage in the sense that **scores and explain outputs** are **source facts**; interpretation and report **reference** them rather than recompute hidden logic.

---

## 5. Relationship between scoring, explanation, and strategy

| Concern | Role |
|---------|------|
| **Scoring** | **Computes** “how strong is this page on citation-oriented signals?” — numbers and partials. |
| **Explanation** | **Diagnoses** “what is helping or hurting?” — issues, strengths, opportunities. |
| **Strategy (recommendations)** | **Proposes actions** — what to change in content, structure, schema, etc. |

**Rule of thumb:** scoring **does not** prescribe edits by itself; explanation **names** gaps; recommendations **prioritize** change. The **GEO report** **bundles** all three for decisions.

---

## 6. Role of monthly GEO configuration vs fixed engine

- **Monthly** **`geo_scoring_config`** adjusts **weights**, **rule emphasis**, **templates**, and **blend alpha** within the architecture—**strategy** and **tuning** for the current month or campaign.  
- The **fixed engine** and **branch structure** provide **stability**: predictable defaults, guardrails, and behavior when the monthly profile is incomplete.  
- Together they implement the philosophy in **`09-geo-research-policy.md`** and **`10-scoring-issue-philosophy.md`**: monthly config **extends** and **tunes**, not **replaces**, the core pipeline (`13-system-invariants.md`).

---

## 7. GEO Analyzer as a platform

The same **layered architecture** supports multiple product shapes:

| Product shape | Emphasis |
|-------------|----------|
| **GEO audit tool** | One-off or periodic **URL analysis** with report and recommendations. |
| **GEO monitoring system** | **Scheduled** re-analysis, trend views, **regressions** on score or issues over time. |
| **GEO optimization platform** | **Workflows**, ownership, **action plans** tied to issues and opportunities; comparison across pages or competitors. |
| **GEO API** | **Headless** access to the same pipeline outputs for **integrations**, CMS hooks, or internal tools. |

Presentation differs; **core pipeline** and **invariants** stay aligned so results remain **comparable** across surfaces.

---

## Where to read next

| Topic | Document |
|--------|-----------|
| Short system overview | `00-system-overview.md` |
| Scoring detail | `03-scoring-system.md` |
| Pipeline steps | `05-pipeline.md` |
| Monthly vs fixed | `09-geo-research-policy.md` |
| Issues / passed / opportunities / recommendations | `10-scoring-issue-philosophy.md` |
| Authoritative rules | `11-system-philosophy-and-architecture-rules.md` |
| Invariants | `13-system-invariants.md` |
| Axis importance | `14-axis-importance-and-weight-philosophy.md` |
| Competitor comparison | `15-geo-competitor-comparison-system.md` |
| Score interpretation | `16-geo-score-interpretation-model.md` |
| GEO report | `17-geo-report-system.md` |

---

## Summary

GEO Analyzer is a **layered system** from **configuration** and **extraction** through **scoring** and **explanation** to **strategy**, optionally **comparison**, then **interpretation** and **reporting**, and finally **presentation**. **Scoring computes**, **explanation diagnoses**, **recommendations act**, and the **report** unifies outcomes for users and platforms—without changing the core definition of GEO as **AI citation / recommendation likelihood**, not traditional SEO rank alone.
