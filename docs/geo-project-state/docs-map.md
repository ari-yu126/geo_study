# GEO Analyzer — Documentation map

This file is the **full** system documentation map for the GEO Analyzer: numbered doc list, layer diagram, and reading order by role. For a **short** recommended path, start at [`index.md`](./index.md).

**Documentation map & reading order** (by audience, dependencies, maintenance) are in [**§ Documentation map & reading order**](#documentation-map--reading-order) below.

---

## 📂 Structure Overview

### 01 — Project Overview
`01-project-overview.md`
- High-level introduction of the GEO Analyzer
- Purpose, goals, and system architecture

---

### 00 — System Overview & Architecture
`00-system-overview.md`
- **Quick reference:** layers, summary data flow, monthly config vs fixed engine, Explain vs recommendation layer
- **Full umbrella:** complete system flow (comparison, interpretation, report, presentation), platform shapes

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
- Deterministic content guide: rules, locale templates, optional monthly `guideRules` from `geo_scoring_config`
- Inputs (`RecommendationContext`), merge behavior, `GeoRecommendations` output shape
- No Gemini in the main recommendation path; optional AI writing examples are documented separately (`POST /api/ai-writing-examples`)

---

### 05 — Analysis Pipeline
`05-pipeline.md`
- End-to-end flow (runAnalysis)
- Data flow from HTML → scoring → result

---

### 06 — UI and Cache
`06-ui-and-cache.md`
- UI structure (AuditPanel, Dashboard, iframe overlay); **AuditPanel** main block order after the score: issues → question coverage → strengths → content improvement guide (see file for rationale and issue-based final-score note)
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
- **§9 — System invariants** (non-negotiable architectural rules)
- Companion Cursor rule: `.cursor/rules/geo-analyzer-architecture.mdc` (always apply)

---

### 12 — Issue System & Score Impact Rules
`12-issue-system-page-type-rules.md`
- Layered issues (core + page-type + monthly); categories; issue→axis impact mapping; severity vs score impact
- Page-type focus (editorial / video / commerce); principle: scoring computes, issues explain
- §7 quick reference: composition, axes, severity shorthand, canonical framing

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
   → Generates strategic recommendations from signals and opportunities using deterministic rules, templates, and optional guideRules (no LLM in the main path)

7. **UI Layer**
   → Displays headline score, then audit content in panel order (issues → question coverage → strengths → guide; see `06-ui-and-cache.md`), plus overlay markers (panel, dashboard, report)

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

---

## Documentation map & reading order

The GEO documentation set is **large**, **numbered**, and **layered**. This section is a **map** and **reading guide**: how files **relate**, **depend** on each other, and **in what order** to read them by role.

**Canonical file list:** the **Structure Overview** section above. **Quick links:** [`index.md`](./index.md).

### 1. Purpose of this section

- **Orientation** — New readers can find **where to start** without scanning every file.
- **Consistency** — Teams share a **mental model** of philosophy → architecture → engines → product.
- **Maintenance** — Contributors know **where new docs belong** and how to avoid duplication.

Use this **map** for **navigation**; use **`11`** (including **§9 — System invariants**) and the rest of **`11`** for **authoritative rules** when architecture conflicts arise.

### 2. Documentation layers

Documents are grouped into **conceptual layers**. A file may touch several topics; the layer is its **primary** home.

#### Philosophy and principles

| Doc | File | Role |
|-----|------|------|
| **20** | `20-geo-philosophy-and-principles.md` | Core values: what GEO is, scoring vs explain vs strategy, guiding principles. |
| **11** | `11-system-philosophy-and-architecture-rules.md` | Authoritative architecture and product rules (read with Cursor rule). Includes **§9 — System invariants**. |
| **10** | `10-scoring-issue-philosophy.md` | Monthly config vs branches; layered issues; citation focus vs SEO-only. |

#### System architecture

| Doc | File | Role |
|-----|------|------|
| **00** | `00-system-overview.md` | Quick reference + **full** umbrella: layers, flow, comparison/report/presentation. |
| **11** | `11-system-philosophy-and-architecture-rules.md` | Same as philosophy row; **§9** lists non-negotiable invariants. |

#### Core engines (analysis, scoring, pipeline)

| Doc | File | Role |
|-----|------|------|
| **02** | `02-analysis-system.md` | Analysis concepts, paragraph logic, citation evaluation, types. |
| **03** | `03-scoring-system.md` | Axis scores, blending, monthly vs fixed, branches (architecture). |
| **05** | `05-pipeline.md` | `runAnalysis`-style end-to-end flow. |
| **12** | `12-issue-system-page-type-rules.md` | Issue system, page types, issue↔axis framing. |

#### Explanation and recommendation

| Doc | File | Role |
|-----|------|------|
| **04** | `04-recommendation-system.md` | Deterministic recommendation engine, signals, optional `guideRules`, `GeoRecommendations` schema (no Gemini on main path). |
| **10** | `10-scoring-issue-philosophy.md` | Issues / passed / opportunities philosophy (overlaps philosophy layer). |

#### Comparison, interpretation, reporting

| Doc | File | Role |
|-----|------|------|
| **14** | `14-axis-importance-and-weight-philosophy.md` | Axis meanings, importance tiers, weight philosophy. |
| **15** | `15-geo-competitor-comparison-system.md` | Competitive sets, metrics, workflow (vs AI-cited / SERP). |
| **16** | `16-geo-score-interpretation-model.md` | Score bands, categories, absolute vs relative meaning. |
| **17** | `17-geo-report-system.md` | GEO report sections, synthesis, action plan. |

#### Research and configuration

| Doc | File | Role |
|-----|------|------|
| **09** | `09-geo-research-policy.md` | Research inputs, monthly config generation, reference sources. |
| **07** | `07-reference.md` | External refs, config pointers. |
| **08** | `08-evaluator-guidelines.md` | Evaluator / quality guidelines (when reviewing outputs). |

#### Product, platform, and project context

| Doc | File | Role |
|-----|------|------|
| **01** | `01-project-overview.md` | Project introduction and goals. |
| **19** | `19-geo-product-and-platform-roadmap.md` | Roadmap: audit → platform, API, SaaS vision. |
| **06** | `06-ui-and-cache.md` | UI surfaces, caching, env (for builders of experience). |

#### Meta (this folder)

| Doc | File | Role |
|-----|------|------|
| **docs-map** | `docs-map.md` (this file) | Full numbered index + system layers diagram + **documentation map** (this section). |
| **index** | `index.md` | Short entry + recommended reading order; links here for the full map. |

### 3. Recommended reading order

#### New developer

1. **`01-project-overview.md`** — context.
2. **`00-system-overview.md`** — fast architecture (quick + full sections).
3. **`05-pipeline.md`** — one URL end to end.
4. **`03-scoring-system.md`** — scores and blend at a high level.
5. **`02-analysis-system.md`** — extraction and analysis concepts.
6. **`11-system-philosophy-and-architecture-rules.md`** — guardrails (including **§9** invariants).
7. **`06-ui-and-cache.md`** — if touching the app.

#### Product designer

1. **`20-geo-philosophy-and-principles.md`** — vocabulary and principles.
2. **`16-geo-score-interpretation-model.md`** — what numbers mean to users.
3. **`17-geo-report-system.md`** — report structure and narrative.
4. **`15-geo-competitor-comparison-system.md`** — competitive framing.
5. **`00-system-overview.md`** — full flow in one place (umbrella section).
6. **`19-geo-product-and-platform-roadmap.md`** — product direction.

#### GEO researcher

1. **`09-geo-research-policy.md`** — inputs and config role.
2. **`14-axis-importance-and-weight-philosophy.md`** — axis model and evidence.
3. **`10-scoring-issue-philosophy.md`** — issues vs scoring.
4. **`16-geo-score-interpretation-model.md`** — calibration mindset.
5. **`15-geo-competitor-comparison-system.md`** — validation framing.
6. **`11-system-philosophy-and-architecture-rules.md`** — constraints on proposals.

#### Engineer working on scoring

1. **`11-system-philosophy-and-architecture-rules.md`**
2. **`03-scoring-system.md`**
3. **`05-pipeline.md`**
4. **`10-scoring-issue-philosophy.md`**
5. **`12-issue-system-page-type-rules.md`**
6. **`14-axis-importance-and-weight-philosophy.md`** (product alignment)

#### Engineer working on UI / reporting

1. **`20-geo-philosophy-and-principles.md`** (traceability)
2. **`17-geo-report-system.md`**
3. **`16-geo-score-interpretation-model.md`**
4. **`15-geo-competitor-comparison-system.md`**
5. **`04-recommendation-system.md`**
6. **`06-ui-and-cache.md`**
7. **`00-system-overview.md`** (presentation layer — umbrella section)

### 4. Document dependency map

Dependencies are **conceptual** (“read B after A”), not import graphs.

#### Core scoring chain

```text
11 (rules & §9 invariants)
    → 03 Scoring System
        → 14 Axis Importance (why axes exist and tiering)
            → 16 Score Interpretation (what headline + axes mean to humans)
                → 17 Report System (how to package for users)
```

#### Pipeline chain

```text
02 Analysis System → 05 Pipeline → 03 Scoring System → 10 / 12 (issues)
    → 04 Recommendation System → 17 Report System
```

#### Explain / issue chain

```text
10 Scoring & Issue Philosophy → 12 Issue System → 04 Recommendation System
```

#### Comparison and relative context

```text
03 Scoring System → 15 Competitor Comparison (multi-URL aggregation)
15 → 16 (relative interpretation) → 17 Report System
```

#### Configuration and research

```text
09 Research Policy → 03 / 10 (how monthly config meets the engine)
```

#### Platform narrative

```text
00 System Overview → 19 Roadmap
20 Philosophy → 00 → 19
```

**Quick rule:** **Philosophy (`20`)** and **§9 invariants** in **`11`** underpin **scoring (`03`)**; **interpretation (`16`)** and **report (`17`)** sit **after** scores and explain outputs; **comparison (`15`)** enriches **both** interpretation and report.

### 5. GEO system document hierarchy

Conceptual stack (top = most abstract, bottom = delivery):

```text
Philosophy (20, 11)
    ↓
Architecture (00, 11)
    ↓
Engines — Analysis & Scoring (02, 03, 05)
    ↓
Explanation & Issues (10, 12)
    ↓
Strategy — Recommendations (04)
    ↓
Comparison & Interpretation (15, 14, 16)
    ↓
Report (17)
    ↓
Presentation & Product (06, 19)
```

**Research & config (`09`)** runs **parallel** to architecture—it feeds **monthly** behavior, not a single box in the stack.

### 6. Maintenance guidelines

1. **Add numbered docs** in **`docs-map.md`** under the right **section** in **Structure Overview** and keep this file consistent.
2. **Choose one primary responsibility** per file; if a topic grows large, **split** (new number) rather than overloading **`03`** or **`04`**.
3. **Update this documentation map** when adding a **new pillar** (e.g. a new layer or major doc) or when **dependencies** change.
4. **Link backward** from new docs to **`11`** when touching architecture or invariants.
5. **Link to `docs-map.md`** (this section) from **`index.md`** so the map stays discoverable.
6. **Avoid duplicating** full architecture in multiple files—prefer **short summary + link** to **`00-system-overview.md`** or **`03`**.

### 7. Map summary

| Need | Start here |
|------|------------|
| Full file list | **Structure Overview** section above |
| Quick links | `index.md` |
| How docs relate & reading order | **This section** |
| Authoritative rules & invariants | `11-system-philosophy-and-architecture-rules.md` |
| One-stop architecture | `00-system-overview.md` |

Update this map whenever the **documentation set** materially changes.