# 17 — GEO Report / Audit Report System

This document describes the **GEO report** (audit report): the **structured, user-facing output** that combines **scoring**, **explanation**, **recommendations**, and **competitor comparison** into one coherent narrative.

It covers **report structure and product logic**—what belongs in each section and why—not UI layout, component names, or code.

**Related:** score interpretation (`16-geo-score-interpretation-model.md`), competitor comparison (`15-geo-competitor-comparison-system.md`), scoring & issue philosophy (`10-scoring-issue-philosophy.md`), system overview (`00-system-overview.md`).

---

## 1. Purpose of the GEO report

The GEO Analyzer produces many intermediate artifacts: signals, axis scores, blended GEO score, issues, passed rules, opportunities, and optional comparison metrics. **Users do not consume these raw layers directly.**

The **GEO report** is the **final packaged output**: it translates analysis into **actionable insights and strategy**—what matters for **AI citation and recommendation**, how strong this page is **in absolute and relative terms**, and **what to do next**.

Without a report layer, the numeric score is easy to misread; with it, the product delivers **auditable, decision-ready** guidance aligned with the interpretation model (`16-geo-score-interpretation-model.md`).

---

## 2. Report structure overview

A full GEO report is organized so readers can move from **executive summary** → **evidence** → **priorities** → **execution**. Major sections typically include:

| Section | Role |
|---------|------|
| **Summary** | One-screen (or one-page) verdict: strength, priorities, and competitive context. |
| **GEO score and interpretation** | Headline score plus **band / category** language—not raw numbers alone. |
| **Competitor comparison** | Where the subject stands vs **AI-cited** and/or **SERP** peers (when enabled). |
| **Axis score breakdown** | Per-axis scores and how they explain the headline result. |
| **Issues** | Gaps, risks, and weak signals that block or weaken citation. |
| **Strengths (passed)** | Positive signals and rules already satisfied—credibility and “what to preserve.” |
| **Opportunities** | Structured improvement areas (often tied to axes and rules). |
| **Recommendations** | Narrative strategy (LLM- or template-assisted) grounded in opportunities and signals. |
| **Action plan** | Concrete, ordered steps derived from recommendations (content, structure, schema, etc.). |

Not every deployment must show every section in the same order; **information architecture** should preserve this **logical sequence** (summary first, evidence next, actions last).

---

## 3. Summary section

The **summary** answers three questions in plain language:

1. **What is this page’s GEO posture?** — e.g. strength category (`16-geo-score-interpretation-model.md`), one-line interpretation of citation likelihood.
2. **What are the main improvement priorities?** — 3–5 bullets tied to **axes or issue themes**, not a dump of every finding.
3. **How does it compare?** (if comparison ran) — e.g. “behind on structure vs the AI-cited URL,” “ahead on trust vs two SERP results.”

The summary should **not** duplicate raw tables; it should **orient** the reader before they scroll into detail.

---

## 4. Axis and score section

This section presents **headline GEO score** and **axis scores** in a way that supports **interpretation**, not just display.

- **Headline score** — Shown with **conceptual band** or short label (e.g. “strong / competitive”) per `16-geo-score-interpretation-model.md`.
- **Axis breakdown** — Each axis (citation, answerability, structure, trust, question match/coverage, density, paragraph, plus branch-specific signals where applicable) with **short plain-language hints** for what a low or high value implies for **citation**.
- **Ordering** — Axes may be ordered by **importance tier** (`14-axis-importance-and-weight-philosophy.md`) or by **largest gaps** vs competitors when comparison data exists.
- **Avoid** — Presenting axes as isolated numbers without tying them to **why the headline score looks the way it does** or **what to fix first**.

---

## 5. Issues, strengths, and opportunities sections

These three layers come from the **Explain** system (`10-scoring-issue-philosophy.md`); the report **groups and presents** them for scanability.

**Issues**

- Group by **theme** (e.g. structure, trust, answerability, question alignment) or by **severity**, depending on audience.
- Lead with **impact on citation**, not generic SEO jargon.
- Avoid long ungrouped lists; use **clusters** so stakeholders see patterns.

**Strengths (passed)**

- Highlight **what already works**—reduces “only negative feedback” fatigue and protects good content from accidental removal.
- Connect strengths to **axes** where helpful (“strong schema supports structure score”).

**Opportunities**

- Frame as **open improvement vectors**, often bridging issues and future recommendations.
- Should read as **prioritized possibilities**, not duplicate issues verbatim.

Together, these sections should answer: **what’s wrong**, **what’s right**, and **where upside lives**.

---

## 6. Competitor comparison section

When competitor or SERP comparison is in scope (`15-geo-competitor-comparison-system.md`), the report should make **relative position** explicit:

- **Subject vs each competitor** — headline GEO delta and/or rank; optional **axis-level** “win / tie / lose.”
- **Benchmarks** — e.g. gap vs a **known AI-cited** URL for the same query, or vs **top organic** results.
- **Narrative** — One short paragraph: where the subject is **weaker** (likely to lose citation) and **stronger** (defensible advantages).

This section **grounds** absolute scores: a “good” number may still be **second best** in the set.

---

## 7. Recommendations and action plan

**Recommendations** translate opportunities and signals into **strategy**—priorities, sequencing, and rationale (often narrative, with template or LLM support per product policy).

The **action plan** turns recommendations into **concrete, verifiable work items**, for example:

- Add or clarify **H2 / section structure** for extractability.
- Add **FAQ** or **summary blocks** that answer real questions directly.
- Improve **schema** (type, coverage, consistency with visible content).
- Adjust **content structure** (lead paragraph, lists, tables) for answerability.
- **Trust** surface improvements (dates, authorship, policy links) where relevant.

Actions should be **specific enough to assign** (owner, rough effort) and **traceable** back to issues or axis gaps—not vague “improve SEO.”

---

## 8. Relationship to GEO system architecture

The GEO report sits **at the end of the pipeline**, after all upstream layers have produced their outputs:

```text
Extraction → Signals → Axis scores → Score blending → Explain (issues, passed, opportunities)
    → Recommendations → [Optional] Competitor comparison aggregation
    → GEO report (structured synthesis + interpretation + action plan)
```

- **Analysis and scoring** compute facts; **explanation** attaches meaning; **comparison** adds relative context; the **report** **unifies** them for humans.
- The report is a **presentation and synthesis layer**, not a replacement for `runAnalysis`-style logic or monthly config.

For a concise layer diagram, see **`00-system-overview.md`**; for comparison semantics, **`15-geo-competitor-comparison-system.md`**; for how to phrase scores, **`16-geo-score-interpretation-model.md`**.

---

## Summary

| Aspect | Role |
|--------|------|
| **Purpose** | Final, actionable output: insights + strategy, not raw engine output. |
| **Structure** | Summary → score & axes → comparison (if any) → issues / strengths / opportunities → recommendations → action plan. |
| **Architecture** | Last layer after analysis, scoring, explanation, optional comparison. |
