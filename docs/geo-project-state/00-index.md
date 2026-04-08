# GEO Analyzer — Documentation Index

This folder contains the system-level documentation for the GEO Analyzer.

Quick entry: [`index.md`](./index.md) links here.

---

## 📂 Structure Overview

### 01 — Project Overview
`01-project-overview.md`
- High-level introduction of the GEO Analyzer
- Purpose, goals, and system architecture

---

### 00 — System Overview
`00-system-overview.md`
- High-level architecture of GEO Analyzer
- System layers and data flow (summary)
- Relationship between monthly config, scoring engine, Explain layer, and recommendation layer

---

### 02 — Analysis System
`02-analysis-system.md`
- Core concepts of GEO analysis
- Paragraph analysis logic
- LLM (Gemini) citation evaluation
- Key data types

---

### 03 — Scoring System
`03-scoring-system.md`
- GEO score calculation logic
- Weighting system
- Rule-based scoring (structure, trust, answerability)

---

### 04 — Recommendation System ⭐️
`04-recommendation-system.md`
- AI strategy generation logic
- pageSignals definition
- Decision logic (page type & subtype)
- Recommendation rules
- Gemini usage, fallback, rate limit handling
- Output schema

---

### 05 — Analysis Pipeline
`05-pipeline.md`
- End-to-end flow (runAnalysis)
- Data flow from HTML → scoring → result

---

### 06 — UI and Cache
`06-ui-and-cache.md`
- UI structure (AuditPanel, Dashboard, iframe overlay)
- Supabase caching strategy (24h TTL)
- Environment variables

---

### 07 — Reference
`07-reference.md`
- External references
- Config files
- Related implementation notes

---

### 09 — GEO Research Policy
`09-geo-research-policy.md`
- Research source priority (academic-first)
- Recommended weight distribution for GEO criteria generation
- How academic, official, industry, and trend inputs relate to `reference_sources` and `geo_scoring_config`

---

### 10 — Scoring & Issue Philosophy
`10-scoring-issue-philosophy.md`
- Monthly `geo_scoring_config` as source of truth vs branch-specific scoring (web / commerce / video)
- Layered issue model (core + page-type + monthly) and product focus on citation optimization, not SEO-only errors

---

### 11 — System Philosophy & Architecture Rules
`11-system-philosophy-and-architecture-rules.md`
- Authoritative project rules: monthly config, branch-based scoring pipeline, page-type logic, layered issue model, product philosophy, GEO score definition, end-to-end architecture reminder
- Companion Cursor rule: `.cursor/rules/geo-analyzer-architecture.mdc` (always apply)

---

### 12 — Issue System & Score Impact Rules
`12-issue-system-page-type-rules.md`
- Layered issues (core + page-type + monthly); categories; issue→axis impact mapping; severity vs score impact
- Page-type focus (editorial / video / commerce); principle: scoring computes, issues explain
- §7 quick reference: composition, axes, severity shorthand, canonical framing

---

### 13 — System Invariants
`13-system-invariants.md`
- Core architectural rules that should not change without a deliberate redesign: score structure, monthly vs fixed separation, axis scores as core layer, issues vs scoring, opportunities, recommendations, layered architecture

---

### 14 — Axis Importance & Weight Philosophy
`14-axis-importance-and-weight-philosophy.md`
- Purpose of the GEO axis system (AI citation probability vs traditional SEO)
- Conceptual axis list (including commerce data density and video metadata)
- Evidence from AI-citation validation; initial importance ranking table
- Weight philosophy (tiers, not numeric weights); relationship to monthly config; future validation

---

### 15 — Competitor & SERP Comparison System
`15-geo-competitor-comparison-system.md`
- Purpose: relative evaluation vs AI-cited and SERP competitors, not score alone
- Comparison types (AI-cited, SERP, multi-page, axis-level, issue/opportunity)
- Metrics: score/axis deltas; issue, passed, opportunity differences
- Typical workflow and conceptual report outputs; position after scoring and explain layers

---

### 16 — GEO Score Interpretation Model
`16-geo-score-interpretation-model.md`
- Purpose: translate numeric scores into citation likelihood framing, competitiveness, and priority (not calculation)
- Conceptual score bands; page strength categories; proxy vs literal probability
- Absolute vs relative interpretation; future calibration via citation datasets and paired experiments

---

### 17 — GEO Report / Audit Report System
`17-geo-report-system.md`
- Final structured output: scoring + explanation + recommendations + competitor comparison
- Report sections (summary, interpretation, axes, issues/passed/opportunities, comparison, recommendations, action plan)
- Product logic for each section; position at end of pipeline after analysis and comparison

---

### 18 — System Overview & Architecture (complete)
`18-geo-system-overview-and-architecture.md`
- Full system-level GEO Analyzer overview: layers, data flow, responsibilities
- End-to-end flow including comparison, interpretation, report, UI/API/presentation
- Scoring vs explanation vs strategy; monthly config vs fixed engine; platform evolution (audit, monitoring, optimization, API)

---

### 19 — Product & Platform Roadmap
`19-geo-product-and-platform-roadmap.md`
- Current capabilities vs platform vision (monitoring, crawler, workflow, dashboards, API, SaaS)
- Product faces: audit, strategy, comparison, report
- Phased roadmap (single URL → comparison/report → monitoring → crawl scale → optimization platform → API)
- Long-term vision: GEO as a category alongside SEO for AI search and answer engines

---

### 20 — GEO Philosophy & Principles
`20-geo-philosophy-and-principles.md`
- What GEO is; GEO score as proxy for citation and answer usefulness
- Scoring vs explanation vs recommendations; absolute vs relative evaluation; axes and explain model
- Monthly config vs fixed engine; platform stance; guiding principles (evidence, axis balance, traceability, comparison, citation reality)

---

### 21 — Documentation Map & Reading Order
`21-geo-documentation-map-and-reading-order.md`
- How GEO docs relate; conceptual layers; recommended paths by audience
- Dependency map and document hierarchy; maintenance guidelines for new docs

---

## 🧠 System Layers

The GEO Analyzer system is structured as **layered architecture**:

1. **Monthly GEO Configuration Layer**
   → Defines strategy, weights, issue rules, passed rules, opportunity templates (Supabase `geo_scoring_config`; extends fixed defaults—see `09-geo-research-policy.md`)

2. **Signal & Extraction Layer**
   → Extracts HTML, metadata, paragraphs, and content signals

3. **Axis Scoring Layer**
   → Computes axis scores (citation, paragraph, density, structure, trust, question match/coverage, commerce/video variants as applicable)

4. **Score Blending Layer**
   → Combines monthly profile weights and fixed engine weights (blend alpha) into headline GEO score; trust caps; commerce/video branches

5. **Explain Layer**
   → Generates issues, strengths (passed), and opportunities from axis scores and rules (`geoExplain`)

6. **Recommendation Layer**
   → Generates strategic recommendations from opportunities and signals (LLM + templates)

7. **UI Layer**
   → Displays score, issues, strengths, opportunities, and overlay markers (panel, dashboard, report)

**Flow (conceptual):**

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

---

## 📌 Notes

- This structure is designed to reduce fragmentation and improve clarity
- Each document follows a single-responsibility principle
- Recommendation system is separated from scoring for flexibility and scalability