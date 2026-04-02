# 21 — GEO Documentation Map & Reading Order

The GEO documentation set is **large**, **numbered**, and **layered**. This document is a **map** and **reading guide**: how files **relate**, **depend** on each other, and **in what order** to read them by role.

**Canonical file list:** [`00-index.md`](./00-index.md) (all numbered entries). **Quick links:** [`index.md`](./index.md).

---

## 1. Purpose of this document

- **Orientation** — New readers can find **where to start** without scanning every file.  
- **Consistency** — Teams share a **mental model** of philosophy → architecture → engines → product.  
- **Maintenance** — Contributors know **where new docs belong** and how to avoid duplication.

Use **`21`** (this file) for **navigation**; use **`11`** and **`13`** for **authoritative rules** when architecture conflicts arise.

---

## 2. Documentation layers

Documents are grouped into **conceptual layers**. A file may touch several topics; the layer is its **primary** home.

### Philosophy and principles

| Doc | File | Role |
|-----|------|------|
| **20** | `20-geo-philosophy-and-principles.md` | Core values: what GEO is, scoring vs explain vs strategy, guiding principles. |
| **11** | `11-system-philosophy-and-architecture-rules.md` | Authoritative architecture and product rules (read with Cursor rule). |
| **10** | `10-scoring-issue-philosophy.md` | Monthly config vs branches; layered issues; citation focus vs SEO-only. |

### System architecture

| Doc | File | Role |
|-----|------|------|
| **00** | `00-system-overview.md` | Short entry: layers, flow, where to read next. |
| **18** | `18-geo-system-overview-and-architecture.md` | Full pipeline: comparison, interpretation, report, presentation. |
| **13** | `13-system-invariants.md` | Non-negotiable invariants; what must not change casually. |

### Core engines (analysis, scoring, pipeline)

| Doc | File | Role |
|-----|------|------|
| **02** | `02-analysis-system.md` | Analysis concepts, paragraph logic, citation evaluation, types. |
| **03** | `03-scoring-system.md` | Axis scores, blending, monthly vs fixed, branches (architecture). |
| **05** | `05-pipeline.md` | `runAnalysis`-style end-to-end flow. |
| **12** | `12-issue-system-page-type-rules.md` | Issue system, page types, issue↔axis framing. |

### Explanation and recommendation

| Doc | File | Role |
|-----|------|------|
| **04** | `04-recommendation-system.md` | Recommendation engine, signals, Gemini, fallbacks, schema. |
| **10** | `10-scoring-issue-philosophy.md` | Issues / passed / opportunities philosophy (overlaps philosophy layer). |

### Comparison, interpretation, reporting

| Doc | File | Role |
|-----|------|------|
| **14** | `14-axis-importance-and-weight-philosophy.md` | Axis meanings, importance tiers, weight philosophy. |
| **15** | `15-geo-competitor-comparison-system.md` | Competitive sets, metrics, workflow (vs AI-cited / SERP). |
| **16** | `16-geo-score-interpretation-model.md` | Score bands, categories, absolute vs relative meaning. |
| **17** | `17-geo-report-system.md` | GEO report sections, synthesis, action plan. |

### Research and configuration

| Doc | File | Role |
|-----|------|------|
| **09** | `09-geo-research-policy.md` | Research inputs, monthly config generation, reference sources. |
| **07** | `07-reference.md` | External refs, config pointers. |
| **08** | `08-evaluator-guidelines.md` | Evaluator / quality guidelines (when reviewing outputs). |

### Product, platform, and project context

| Doc | File | Role |
|-----|------|------|
| **01** | `01-project-overview.md` | Project introduction and goals. |
| **19** | `19-geo-product-and-platform-roadmap.md` | Roadmap: audit → platform, API, SaaS vision. |
| **06** | `06-ui-and-cache.md` | UI surfaces, caching, env (for builders of experience). |

### Meta (this folder)

| Doc | File | Role |
|-----|------|------|
| **21** | `21-geo-documentation-map-and-reading-order.md` | Map and reading order (this file). |
| **00-index** | `00-index.md` | Full numbered index + system layers diagram. |
| **index** | `index.md` | Short link hub to key docs. |

---

## 3. Recommended reading order

### New developer

1. **`01-project-overview.md`** — context.  
2. **`00-system-overview.md`** — fast architecture.  
3. **`05-pipeline.md`** — one URL end to end.  
4. **`03-scoring-system.md`** — scores and blend at a high level.  
5. **`02-analysis-system.md`** — extraction and analysis concepts.  
6. **`13-system-invariants.md`** — guardrails.  
7. **`06-ui-and-cache.md`** — if touching the app.

### Product designer

1. **`20-geo-philosophy-and-principles.md`** — vocabulary and principles.  
2. **`16-geo-score-interpretation-model.md`** — what numbers mean to users.  
3. **`17-geo-report-system.md`** — report structure and narrative.  
4. **`15-geo-competitor-comparison-system.md`** — competitive framing.  
5. **`18-geo-system-overview-and-architecture.md`** — full flow in one place.  
6. **`19-geo-product-and-platform-roadmap.md`** — product direction.

### GEO researcher

1. **`09-geo-research-policy.md`** — inputs and config role.  
2. **`14-axis-importance-and-weight-philosophy.md`** — axis model and evidence.  
3. **`10-scoring-issue-philosophy.md`** — issues vs scoring.  
4. **`16-geo-score-interpretation-model.md`** — calibration mindset.  
5. **`15-geo-competitor-comparison-system.md`** — validation framing.  
6. **`11-system-philosophy-and-architecture-rules.md`** — constraints on proposals.

### Engineer working on scoring

1. **`11-system-philosophy-and-architecture-rules.md`**  
2. **`13-system-invariants.md`**  
3. **`03-scoring-system.md`**  
4. **`05-pipeline.md`**  
5. **`10-scoring-issue-philosophy.md`**  
6. **`12-issue-system-page-type-rules.md`**  
7. **`14-axis-importance-and-weight-philosophy.md`** (product alignment)

### Engineer working on UI / reporting

1. **`20-geo-philosophy-and-principles.md`** (traceability)  
2. **`17-geo-report-system.md`**  
3. **`16-geo-score-interpretation-model.md`**  
4. **`15-geo-competitor-comparison-system.md`**  
5. **`04-recommendation-system.md`**  
6. **`06-ui-and-cache.md`**  
7. **`18-geo-system-overview-and-architecture.md`** (presentation layer)

---

## 4. Document dependency map

Dependencies are **conceptual** (“read B after A”), not import graphs.

### Core scoring chain

```text
11 / 13 (rules & invariants)
    → 03 Scoring System
        → 14 Axis Importance (why axes exist and tiering)
            → 16 Score Interpretation (what headline + axes mean to humans)
                → 17 Report System (how to package for users)
```

### Pipeline chain

```text
02 Analysis System → 05 Pipeline → 03 Scoring System → 10 / 12 (issues)
    → 04 Recommendation System → 17 Report System
```

### Explain / issue chain

```text
10 Scoring & Issue Philosophy → 12 Issue System → 04 Recommendation System
```

### Comparison and relative context

```text
03 Scoring System → 15 Competitor Comparison (multi-URL aggregation)
15 → 16 (relative interpretation) → 17 Report System
```

### Configuration and research

```text
09 Research Policy → 03 / 10 (how monthly config meets the engine)
```

### Platform narrative

```text
18 System Overview → 19 Roadmap
20 Philosophy → 18 → 19
```

**Quick rule:** **Philosophy (`20`)** and **invariants (`13`)** underpin **scoring (`03`)**; **interpretation (`16`)** and **report (`17`)** sit **after** scores and explain outputs; **comparison (`15`)** enriches **both** interpretation and report.

---

## 5. GEO system document hierarchy

Conceptual stack (top = most abstract, bottom = delivery):

```text
Philosophy (20, 11)
    ↓
Architecture (00, 18, 13)
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

---

## 6. Maintenance guidelines

1. **Add numbered docs** in **`00-index.md`** under the right **section** and bump the **Structure Overview** list consistently.  
2. **Choose one primary responsibility** per file; if a topic grows large, **split** (new number) rather than overloading **`03`** or **`04`**.  
3. **Update this map (`21`)** when adding a **new pillar** (e.g. a new layer or major doc) or when **dependencies** change.  
4. **Link backward** from new docs to **`11` / `13`** when touching architecture or invariants.  
5. **Link to `21`** from **`index.md`** so the map stays discoverable.  
6. **Avoid duplicating** full architecture in multiple files—prefer **short summary + link** to **`18`** or **`03`**.

---

## Summary

| Need | Start here |
|------|------------|
| Full file list | `00-index.md` |
| Quick links | `index.md` |
| How docs relate & reading order | **`21`** (this document) |
| Authoritative rules | `11`, `13` |
| One-stop architecture | `18` |

This document should be updated whenever the **documentation map** materially changes.
