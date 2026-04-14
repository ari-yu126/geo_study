# 14 — Axis Importance & Weight Philosophy

This document defines the **GEO axis importance model** and **weight philosophy** used to reason about scoring. It is grounded in **AI-citation validation datasets**, **paired comparison experiments** (cited vs non-cited URLs for the same queries), and aggregate behavior on **real pages observed as AI citations**.

It is a **philosophy and model-definition** document: it explains *why* the scoring system is organized around these axes and tiers. It does **not** specify implementation details, code paths, or numeric formulas.

**Related:** scoring architecture (`03-scoring-system.md`), system invariants (`11-system-philosophy-and-architecture-rules.md` §9), monthly config philosophy (`10-scoring-issue-philosophy.md`).

---

## 1. Purpose of the GEO axis system

GEO scoring exists to estimate how likely a page is to be **selected, summarized, or cited as a source** by AI systems when answering user questions—not to replicate **traditional SEO ranking** or generic relevance.

Accordingly:

- Axes describe **signals that support extractability, attribution, and answer quality** from an AI-system perspective.
- The headline GEO score is a **structured blend** of those signals (via monthly and fixed profiles, page-type branches, and caps), not a single static keyword formula.
- **Importance tiers** (below) guide *how strongly* each signal family should influence differentiation between pages, subject to validation and monthly tuning.

---

## 2. GEO axis list (conceptual meanings)

The following are **conceptual** descriptions only—what each axis is intended to represent in product language. Branch-specific composites (commerce, video) extend this list where noted.

### Core editorial / web axes

| Axis | Conceptual meaning |
|------|---------------------|
| **citation** | How well the page’s content supports **quoting, attribution, and chunk-level “citation-worthiness”**—i.e., whether passages look like something an AI could responsibly cite, not merely whether keywords appear. |
| **paragraph** | **Paragraph-level extractability and quality**—structure of body text into usable units (length, patterns, readability of chunks), not prose style or brand voice for its own sake. |
| **density** | **Information density** in editorial-style content: signal per unit of readable text (facts, numbers, spec-like blocks embedded in prose). Distinct from commerce **data density** (below). |
| **answerability** | Whether the page **answers questions directly**—clear lead, quotable sentences, tables or lists that support short answers, and overall orientation toward resolving user intent. |
| **structure** | **Page-level structure and machine-readable context**: headings hierarchy, metadata, schema, canonical and social signals, navigational clarity—anything that helps systems **orient and slice** the page reliably. |
| **trust** | **Credibility and authority signals**: publisher identity, dates, contact, consistency of claims with trustworthy patterns, and related signals that reduce risk of citing low-trust or misleading content. |
| **questionMatch** | **Alignment between page text and the question set** used in analysis—how well the content matches the specific queries the system evaluates against. |
| **questionCoverage** | **Breadth of coverage** across that question set—whether the page addresses many of the evaluated questions vs. only a narrow slice. |

### Branch-specific (when applicable)

| Signal family | Conceptual meaning |
|---------------|---------------------|
| **Commerce data density** | On commerce-oriented pages, a **composite** reflecting how well **price, specs, product cards, and comparable data** are present and extractable—supporting shopping and comparison use cases. Not interchangeable with editorial **density**. |
| **Video metadata** | For video surfaces (e.g. YouTube), **metadata-oriented quality**: title, description, chapters, and related signals that help AI systems **understand and cite** the video as a source. |

---

## 3. Evidence from AI-citation validation

Validation uses **real URLs observed as citations** in ChatGPT, Perplexity, Google AI Overview, and similar systems, plus **paired rows** (same query: cited URL vs. a chosen non-cited URL). Findings are **evidence for modeling**, not proof of causality.

**Observed patterns on cited pages (aggregate axis means and spot checks):**

- **Structure** scores are often **very high** on pages that real systems cite—consistent with AI systems favoring pages that are easy to segment, attribute, and summarize.
- **Answerability** and **citation** tend to be **consistently strong** among cited examples—pages that answer clearly and offer citable substance rank highly in practice.
- **Question match** matters for **query alignment**: when the evaluated question set aligns with the user’s real query, match and coverage track “this page is about what was asked”; when misaligned, they can diverge from human intuition about “good citations.”
- **Paragraph** (as a distinct axis) is **rarely the main story** in isolation: cited pages vary widely in paragraph scores; **writing style** is less decisive than structure, answerability, and trust context.
- **Density** and **trust** often act as **secondary differentiators**—they move the needle but rarely replace structure, answerability, or citation quality in the overall picture.

**Caveats:** Paired experiments are sensitive to **control URL choice**, **fetch failures**, and **small n**. The importance ranking below is an **initial working model** to be refined as datasets grow.

---

## 4. Initial axis importance ranking

This table is a **working hierarchy** for reasoning about weights and product priorities. It does **not** fix numeric weights in code or config; monthly profiles still implement the actual numbers.

| Rank | Axis | Importance | Reason (model definition) |
|------|------|------------|-----------------------------|
| 1 | **structure** | Very high | AI systems favor pages that are easy to parse, segment, and attribute; structure is consistently high on cited pages. |
| 2 | **answerability** | Very high | Direct, extractable answers map to how assistants quote and summarize. |
| 3 | **citation** | High | Core “citation-worthiness” of chunks; central to GEO’s purpose. |
| 4 | **questionMatch** | High | Query alignment when the question set reflects real user intent. |
| 5 | **questionCoverage** | Medium | Breadth helps but can over-penalize narrow authoritative pages if questions are broad. |
| 6 | **trust** | Medium | Authority and safety; often a tie-breaker and cap-relevant, not always the top mover. |
| 7 | **density** | Low | Useful refinement; should not dominate over answerability and structure. |
| 8 | **paragraph** | Very low | Extractability matters, but **style-level** paragraph scoring is a weaker lever than structure and answerability for citation outcomes. |

**Branch notes (conceptual):** On commerce pages, **commerce data density** should be treated as **high** within that branch (comparable to structure/trust there). On video pages, **video metadata** should be treated as **high** within the video pipeline. These sit alongside—not instead of—the core editorial semantics above.

---

## 5. Weight philosophy (not exact numbers)

Weights—whether in monthly profiles or the fixed engine—should **follow** the importance tiers:

- **Very high** axes (**structure**, **answerability**) deserve the **largest share** of influence in blends where they participate, so the headline score reflects “can an AI use this page as a source?” first.
- **High** axes (**citation**, **questionMatch**) provide **strong differentiation** between otherwise similar pages.
- **Medium** axes (**questionCoverage**, **trust**) **refine** scores and catch authority or breadth gaps without swamping the core.
- **Low / very low** axes (**density**, **paragraph**) should **shape** nuance and explainability; they **must not dominate** the final score or drown out structure and answerability.

Philosophically:

- **No single axis should routinely override** structure + answerability without a deliberate product reason (e.g. commerce or video branch rules).
- **Monthly tuning** adjusts *how* tiers are expressed numerically, not *whether* structure and answerability are central.
- **Low-importance axes** remain valuable for **issues and recommendations**, even when their weight in the headline blend is restrained.

---

## 6. Relationship to monthly GEO config

The active **`geo_scoring_config`** in Supabase may adjust **per-axis weights**, **blend alpha**, **page-type profiles**, and **commerce/video** emphasis month over month.

Principles:

- Monthly configs **optimize within** the **global importance hierarchy**—they should not permanently invert tiers (e.g. paragraph over structure) without an explicit redesign.
- **Large shifts** to low-tier axes should be justified by **validation evidence** or clear product scope changes (e.g. new page type).
- **Trust caps and branch overrides** remain aligned with the idea that **credibility and branch-specific signals** modulate the headline score without negating the core editorial story.

---

## 7. Future validation

The importance ranking and weight philosophy will be **updated over time** using:

- **Larger AI-citation datasets** (more cited URLs, diverse domains and intents).
- **Paired citation datasets** (cited vs non-cited for the same query), with reliable control URLs and sufficient **n** for stable means and correlations.
- **Stratified analysis** by **page type** and **editorial subtype**, so axes are not over-interpreted from a single segment.
- **Question-set audits** when **questionMatch** / **questionCoverage** behave unexpectedly relative to real user queries.

Until then, this document states the **default mental model** for axis importance and weighting philosophy; implementation continues to follow **`03-scoring-system.md`**, **`11-system-philosophy-and-architecture-rules.md`** (§9 invariants), and the active monthly configuration.
