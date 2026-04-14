# 15 — GEO Competitor & SERP Comparison System

This document describes the **competitor and SERP comparison** capability in the GEO Analyzer product model: how a **subject page** is evaluated **relative to other pages** that AI systems might cite or that users see in search results.

It is **system design documentation**—purpose, comparison types, metrics, workflow, and outputs. It does **not** specify APIs, UI components, or implementation code.

**Related:** pipeline and layers (`00-system-overview.md`, `05-pipeline.md`), scoring (`03-scoring-system.md`), explain layer (`10-scoring-issue-philosophy.md`), axis importance (`14-axis-importance-and-weight-philosophy.md`).

---

## 1. Purpose

A **standalone GEO score** answers: “How strong is this page on citation-oriented signals?” It does **not** fully answer: “**Compared to what?**”

In practice, AI systems choose among **many** candidate pages. A page may score well in isolation yet still **lose** to competitors that are more extractable, better aligned to the query, or more trusted in context. Conversely, a modest absolute score may be **competitive** if peers are weaker on the same axes.

The **competitor and SERP comparison system** therefore:

- Places the subject URL **in a competitive set** (AI-cited references, top organic results, manually chosen peers, or a mixed set).
- Surfaces **relative** strengths and gaps—not only absolute scores.
- Aligns with GEO’s mission: **optimization for AI citation and recommendation**, not a single static leaderboard.

---

## 2. Comparison types

The system can support multiple **comparison frames**. Each frame defines *who* the subject page is measured against.

| Type | Description |
|------|-------------|
| **Single page vs AI-cited page** | Subject is compared to one or more URLs **observed as citations** in ChatGPT, Perplexity, Google AI Overview, etc. (often paired with the same user query). Highlights gaps vs pages AI systems already trust. |
| **Single page vs top search results** | Subject is compared to URLs from the **SERP** for a target query (e.g. top 5–10 organic results). Highlights gaps vs what search surfaces as relevant. |
| **Multiple pages comparison** | Three or more URLs (e.g. subject + several competitors) analyzed in one batch; rankings and pairwise deltas can be derived. Useful for category or brand benchmarking. |
| **Axis-level comparison** | Same competitive set, but the report emphasizes **per-axis** deltas (citation, answerability, structure, trust, question match/coverage, etc.) rather than only headline GEO score. |
| **Issue / opportunity comparison** | Same analyses, but the report emphasizes **issues** (gaps), **passed** (strengths), and **opportunities** **across pages**—where the subject is behind on rules and where competitors trigger different explain outputs. |

These types can be **combined** (e.g. SERP top results *plus* a known AI-cited URL for the same query).

---

## 3. Comparison metrics

Once each URL has been run through the same **analysis pipeline** (extraction → axis scores → blend → explain), comparisons use:

| Metric family | What is compared |
|---------------|------------------|
| **GEO score difference** | Delta (and optionally rank) of **final GEO score** between the subject and each competitor. Shows overall relative position. |
| **Axis score differences** | Per-axis deltas (e.g. subject minus competitor, or vs cohort average). Shows **where** the gap comes from (structure vs trust vs questions, etc.). |
| **Issue differences** | Which **issue rules** fire on the subject vs competitors; severity and category. Surfaces “what is broken” relatively. |
| **Passed (strengths) differences** | Which **passed rules** or strength signals appear on each page. Surfaces **relative credibility** of positive signals. |
| **Opportunity differences** | **Opportunity** items generated per page: where competitors have opportunities the subject lacks, or vice versa. Supports **action prioritization** relative to peers. |

Philosophy: **headline score** gives a single ordering; **axis and explain deltas** explain *why* and *what to change* in a competitive context.

---

## 4. Typical workflow

Conceptual end-to-end flow:

1. **User enters a URL** (subject page) and optionally a **query**, **market**, or **comparison mode** (SERP vs AI-cited vs custom list).
2. **System collects competitor URLs** — e.g. from SERP APIs, curated AI-citation datasets, or user-pasted links — and deduplicates / normalizes them.
3. **Analyze all URLs** through the same GEO pipeline so scores and explain outputs are **comparable**.
4. **Generate a comparison report** — deltas, rankings, axis breakdowns, and issue/passed/opportunity contrasts.
5. **Present where the subject is weaker or stronger** — relative to each competitor and, where useful, vs the **cohort average** or **best-in-set** benchmark.

The subject page is always interpreted **in context**; the competitive set is first-class input, not an afterthought.

---

## 5. Output examples (conceptual)

A comparison report should make **relative performance** obvious without requiring users to open each URL’s full audit separately. Conceptually it may include:

- **Summary strip** — Subject final score vs min / max / mean of competitors; simple rank (“3rd of 6”).
- **Axis comparison table or chart** — For each axis: subject value vs competitor columns or vs cohort; **largest gaps** highlighted.
- **“Win / tie / lose” lens** — Per competitor or per axis: whether the subject is ahead, tied, or behind (with thresholds as a product choice).
- **Issue comparison** — Competitors’ top issues the subject does **not** have (they fixed something you didn’t) vs issues **only** on the subject.
- **Strengths (passed) comparison** — Where competitors earn passed rules the subject misses.
- **Opportunity comparison** — Prioritized opportunities **unique** to the subject or **shared** with weaker peers.
- **Narrative takeaway** — Short text: “You lag on structure and question match vs the AI-cited page; you lead on trust vs two SERP results.”

Exact layout and components are **implementation**; the **information architecture** above is the design target.

---

## 6. Relationship to GEO Analyzer architecture

The comparison system **does not replace** scoring or explain logic. It **sits after** them in the product story:

```text
Per URL: URL → Extraction → Axis scores → Blend → finalScore → Explain (issues, passed, opportunities) → Recommendations

Comparison layer:  multiple such results → align metrics → deltas, rankings, contrast views → comparison report
```

- **Scoring and explain layers** remain the **source of truth** per URL (`11-system-philosophy-and-architecture-rules.md` §9).
- **Comparison** is a **meta-layer**: it aggregates and contrasts **already computed** `AnalysisResult`-style outputs.
- **Monthly GEO config** still governs how each URL is scored; comparison only **aggregates** outcomes.

Future UI or batch jobs may implement this as a **multi-URL orchestration** plus **report generation**—but the **contract** is: same pipeline for every URL in the set, then **relative** metrics on top.

---

## Summary

| Aspect | Role |
|--------|------|
| **Purpose** | Evaluate pages **relative to competitors** AI might cite or SERPs might show—not absolute score alone. |
| **Types** | AI-cited, SERP, multi-URL, axis-focused, explain-focused. |
| **Metrics** | Score deltas, axis deltas, issue/passed/opportunity differences. |
| **Workflow** | Collect set → analyze all → report relative gaps. |
| **Architecture** | After per-URL scoring and explain; aggregation and presentation only. |
