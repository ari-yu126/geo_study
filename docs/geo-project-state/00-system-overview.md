# 00 — System Overview

High-level architecture of the GEO Analyzer: how **monthly configuration**, the **fixed scoring engine**, the **Explain layer**, and **recommendations** fit together. For authoritative rules, see **`11-system-philosophy-and-architecture-rules.md`**.

## Purpose

GEO Analyzer estimates **AI citation / recommendation likelihood** for a URL—not traditional SEO rank alone. It combines:

- **Numeric scoring** (axis scores, hybrid monthly/fixed blend, trust caps, page-type branches)  
- **Explainability** (issues, strengths, opportunities)  
- **Strategy** (narrative recommendations)

## System layers (conceptual)

1. **Monthly GEO configuration** — Supabase `geo_scoring_config`: strategy, profile weights, issue/passed/opportunity seeds, query templates, optional blend alpha. Does **not** replace the whole algorithm; see **`09-geo-research-policy.md`** (Role of Monthly GEO Config).  
2. **Signal & extraction** — HTML, metadata, paragraphs, chunks, trust/search signals.  
3. **Axis scoring** — Partial scores (citation, paragraph, answerability, structure, trust, question match/coverage, commerce/video variants).  
4. **Score blending** — Monthly profile weights vs fixed engine weights → headline GEO score; then trust caps; commerce/video branches as applicable.  
5. **Explain layer** — Issues, strengths (`passed`), opportunities from rules + axes.  
6. **Recommendation layer** — Action plans and narrative guidance (LLM + templates).  
7. **UI** — Panel, overlay, reports.

## End-to-end data flow

```text
URL
  → Extraction
  → Signals
  → Axis scores
  → Monthly + fixed score blending
  → Final GEO score
  → Explain engine
  → Recommendation engine
  → UI
```

## Where to read next

| Topic | Document |
|--------|-----------|
| Blend, trust cap, axes | `03-scoring-system.md` |
| `runAnalysis` steps & GEO system flow | `05-pipeline.md` |
| Monthly vs fixed engine | `09-geo-research-policy.md` |
| Issues vs strengths vs opportunities vs recommendations | `10-scoring-issue-philosophy.md` |
| Rules for contributors | `11-system-philosophy-and-architecture-rules.md` |
| Non-negotiable architectural invariants | `13-system-invariants.md` |
