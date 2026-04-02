# 16 — GEO Score Interpretation Model

This document defines **how GEO scores should be interpreted** in product language—what a number *means* for users, strategists, and stakeholders. It does **not** describe how scores are calculated (see `03-scoring-system.md`, `05-pipeline.md`).

**Related:** axis importance (`14-axis-importance-and-weight-philosophy.md`), competitor comparison (`15-geo-competitor-comparison-system.md`), system overview (`00-system-overview.md`).

---

## 1. Purpose of score interpretation

A **numeric GEO score** (typically 0–100) is not meaningful on its own to most users. Without context, it reads like an arbitrary grade.

Interpretation must translate the headline score into:

- **Likelihood framing** — How plausible it is that an AI system would **select, summarize, or cite** this page as a source for relevant queries.
- **Competitiveness** — Whether the page is positioned to **win** against typical alternatives (peers, SERP results, known AI-cited pages), not only whether it clears a bar in isolation.
- **Optimization priority** — Whether improving this URL should be **high, medium, or low** in a roadmap, given business goals and the cost of change.

The interpretation model is therefore a **semantic layer** on top of the score: same pipeline output, richer meaning for decisions.

---

## 2. Score ranges and meaning

The bands below are **conceptual**, not contractual thresholds in code. They guide **copy, dashboards, and coaching**. They **may be refined** as AI-citation validation datasets and paired experiments accumulate.

| Range | Meaning (conceptual) |
|-------|----------------------|
| **90–100** | **Highly citable / authoritative source** — Strong extractability, structure, and trust signals for the page type; likely to behave like pages AI systems repeatedly cite for the topic. |
| **75–89** | **Strong GEO page, competitive** — Solid citation-oriented profile; may win or tie peers depending on query and niche; worth fine-tuning rather than rebuilding. |
| **60–74** | **Average** — Usable but not standout; may be cited for **niche or long-tail** queries where alternatives are weaker; improvement opportunities are usually clear from axes and issues. |
| **45–59** | **Weak GEO** — Unlikely to be a **default** citation for broad queries; gaps in structure, answerability, trust, or alignment are material. |
| **Below 45** | **Very unlikely to be cited** (for general assistant-style use) — Serious structural, trust, or content-signal gaps; often needs substantive change, not tweaks. |

**Caveats:**

- **Page type** (editorial, commerce, video) shifts what “good” looks like; the same band may imply different **next actions** (see issues and opportunities, not only the number).
- **Trust caps and branch logic** can suppress or boost the headline score in ways the bands summarize at a high level only.
- Bands are **calibration targets**, not guarantees of real-world citation rates.

---

## 3. Relationship between GEO score and AI citation probability

- The GEO score is a **proxy** for **citation likelihood** in AI-mediated answers—not a literal **P(cited)** from a calibrated model.
- **Higher scores should correlate** with **higher observed citation frequency** in validation datasets (same topic, same query class), when samples are large enough and controls are fair.
- **Low scores do not prove** a page will never be cited; **high scores do not guarantee** citation. External factors (brand bias, recency, query-specific intent) are outside the score.
- Product language should avoid **“this page has an X% chance of being cited”** unless a separate, validated calibration step exists. Prefer **“stronger / weaker citation-oriented profile”** and **relative** language when comparing to peers (`15-geo-competitor-comparison-system.md`).

---

## 4. Page strength categories

These categories **map interpretation to strategy**. They overlap with score bands but also invite **context** (vertical, intent, competitor set).

| Category | Typical interpretation |
|----------|-------------------------|
| **Authority page** | Behaves like a **primary reference** for the topic: high trust, structure, and answerability for its type; often in the top bands and competitive vs SERP and AI-cited peers. |
| **Competitive page** | **In the running** for citation against peers; score and axis profile support wins in some query classes; gaps are specific and actionable. |
| **Supporting page** | **Helpful but not central** — may be cited for narrow questions or as a secondary source; mid bands common; optimization is incremental unless scope expands. |
| **Weak page** | **Material gaps** vs citation-oriented norms; low bands or strong axis skew; priority fixes are usually structural, trust, or alignment. |
| **Non-citable page** (for assistant-style citation) | **Not suitable** as a default source: thin content, hostile to extraction, misleading trust, or wrong page type for the promise; often bottom band or dominated by critical issues. |

Categories are **labels for communication**, not extra scores in the engine. The same URL might be “competitive” in one niche and “supporting” when compared to a national authority site.

---

## 5. Relationship to competitor comparison

Interpretation must use **both**:

- **Absolute score** — Where the page sits on the conceptual bands and categories.
- **Relative score** — Deltas vs **AI-cited URLs**, **SERP leaders**, or a **hand-picked peer set**.

A page in the **60–74** band may still be **best-in-set** for a small market; conversely, a **75+** page may **lose** to a stronger competitor on key axes. The interpretation model therefore **defers to comparison** when the user’s question is “are we winning?” rather than “is our number acceptable?”

---

## 6. Future calibration

The numeric **bands** and **category boundaries** should be **recalibrated over time** using:

- **AI-citation validation datasets** — Observed cited URLs and their score distributions by vertical and query type.
- **Paired comparison experiments** — Cited vs non-cited for the same query; distribution of score gaps and axis gaps.
- **Stratified analysis** — By page type and editorial subtype so bands are not overfit to one segment.

Until calibration converges, treat ranges as **stable guidance for communication**, with explicit note that **empirical citation data** may shift thresholds or wording in future doc revisions—without changing the core definition of GEO as **AI citation / recommendation likelihood**, not SEO rank alone.
